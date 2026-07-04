/**
 * One-time backfill: generate AI pronunciation defaults for enrollments that
 * were added BEFORE the auto-pronunciation feature existed (roster_name_phonetic
 * is null). New students get this automatically at import/sync; this catches the
 * existing roster.
 *
 * Usage (requires .env.local with NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, and OPENROUTER_API_KEY):
 *   npx tsx --env-file=.env.local scripts/backfill-phonetics.ts
 *
 * Safe to re-run: it only touches rows where roster_name_phonetic is still null.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH_SIZE = 60;

const SYSTEM_PROMPT = [
  "You write short pronunciation respellings of people's names so classmates can say them correctly.",
  "Style: plain-English respelling, syllables joined by hyphens, the stressed syllable in CAPS.",
  'Examples: "Siobhan Murphy" -> "shiv-AWN MUR-fee"; "Xochitl Alvarez" -> "SOH-cheel AL-vah-rez"; "John Smith" -> "jon smith".',
  "Give your best guess for every name, even unusual ones. Keep each under 60 characters.",
  "Use each name exactly as given so it can be matched back.",
  'Reply with ONLY a JSON object, no markdown fences: {"pronunciations": [{"name": string, "say": string}]}.',
].join("\n");

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : text.trim();
}

async function generateBatch(names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-Title": "ClassAct",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Names:\n${names.map((n) => `- ${n}`).join("\n")}` },
      ],
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    console.warn(`[backfill] OpenRouter ${response.status} — skipping this batch.`);
    return out;
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.warn("[backfill] Model reply wasn't valid JSON — skipping batch.");
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

async function main() {
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY — nothing to generate with.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await supabase
    .from("enrollments")
    .select("id, roster_name")
    .is("roster_name_phonetic", null);
  if (error) {
    console.error("Failed to read enrollments:", error.message);
    process.exit(1);
  }
  const enrollments = (rows ?? []).filter((r) => (r.roster_name ?? "").trim());
  console.log(`Enrollments needing a pronunciation: ${enrollments.length}`);
  if (enrollments.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Generate once per unique name.
  const uniqueNames = Array.from(
    new Set(enrollments.map((r) => r.roster_name.trim()))
  );
  const sayByName = new Map<string, string>();
  for (let i = 0; i < uniqueNames.length; i += BATCH_SIZE) {
    const batch = uniqueNames.slice(i, i + BATCH_SIZE);
    console.log(
      `  Generating batch ${i / BATCH_SIZE + 1} (${batch.length} names)…`
    );
    const map = await generateBatch(batch);
    for (const [k, v] of map) sayByName.set(k, v);
  }
  console.log(`Generated ${sayByName.size}/${uniqueNames.length} pronunciations.`);

  // Write them back.
  let updated = 0;
  for (const r of enrollments) {
    const say = sayByName.get(r.roster_name.trim());
    if (!say) continue;
    const { error: upErr } = await supabase
      .from("enrollments")
      .update({ roster_name_phonetic: say })
      .eq("id", r.id);
    if (upErr) {
      console.warn(`  Failed to update ${r.roster_name}: ${upErr.message}`);
    } else {
      updated++;
    }
  }
  console.log(`Done. Updated ${updated} enrollment(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
