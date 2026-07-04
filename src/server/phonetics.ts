import "server-only";
import { env } from "@/lib/env";

/**
 * Best-effort AI pronunciation respellings for roster names, via OpenRouter
 * (Mike's existing account — same provider as question generation).
 *
 * Generated when a student is added (CSV import or Canvas sync) and stored as a
 * DEFAULT on the enrollment. It's deliberately fail-open: if AI isn't configured
 * or the call errors, this returns an empty map and never throws, so adding
 * students is never blocked by pronunciation. The value is only a suggestion —
 * a student's own onboarding entry always wins, and the onboarding field is
 * pre-filled with this so they can confirm or fix it.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 60_000;
// Keep each request's output small and reliable; a class usually fits in one.
const BATCH_SIZE = 60;

const SYSTEM_PROMPT = [
  "You write short pronunciation respellings of people's names so classmates can say them correctly.",
  "Style: plain-English respelling, syllables joined by hyphens, the stressed syllable in CAPS.",
  'Examples: "Siobhan Murphy" -> "shiv-AWN MUR-fee"; "Xochitl Alvarez" -> "SOH-cheel AL-vah-rez"; "John Smith" -> "jon smith".',
  "Give your best guess for every name, even unusual ones. Keep each under 60 characters.",
  "Use each name exactly as given so it can be matched back.",
  'Reply with ONLY a JSON object, no markdown fences: {"pronunciations": [{"name": string, "say": string}]}.',
].join("\n");

/** Tolerate models that wrap JSON in markdown fences despite instructions. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

async function generateBatch(
  names: string[],
  apiKey: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.siteUrl,
        "X-Title": "ClassAct",
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Names:\n${names.map((n) => `- ${n}`).join("\n")}`,
          },
        ],
        temperature: 0.2,
      }),
    });
  } catch {
    console.warn("[phonetics] Couldn't reach OpenRouter — skipping this batch.");
    return out;
  }

  if (!response.ok) {
    console.warn(
      `[phonetics] OpenRouter ${response.status} — skipping this batch.`
    );
    return out;
  }

  let text = "";
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    text = payload.choices?.[0]?.message?.content ?? "";
  } catch {
    return out;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.warn("[phonetics] Model reply wasn't valid JSON — skipping batch.");
    return out;
  }

  const list = (parsed as { pronunciations?: unknown })?.pronunciations;
  if (!Array.isArray(list)) return out;
  const wanted = new Set(names);
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const say = typeof rec.say === "string" ? rec.say.trim().slice(0, 100) : "";
    if (name && say && wanted.has(name)) out.set(name, say);
  }
  return out;
}

/**
 * Returns pronunciation respellings keyed by the exact (trimmed) name string.
 * Empty map when AI is unconfigured or every batch fails — never throws.
 */
export async function phoneticsForNames(
  names: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const apiKey = env.openrouterApiKey;
  if (!apiKey) {
    console.warn(
      "[phonetics] OPENROUTER_API_KEY not set — skipping auto-pronunciations."
    );
    return result;
  }

  const unique = Array.from(
    new Set(names.map((n) => n.trim()).filter(Boolean))
  );
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const map = await generateBatch(batch, apiKey);
    for (const [k, v] of map) result.set(k, v);
  }
  return result;
}
