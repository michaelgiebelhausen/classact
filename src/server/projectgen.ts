import "server-only";
import { env } from "@/lib/env";

/**
 * AI project-task extraction via OpenRouter. The assignment/project PDF is
 * sent as a native PDF attachment so the model sees rubrics, tables, and
 * figures — not just text.
 *
 * The output is a task TEMPLATE: a starting to-do list teams copy and then
 * own. Estimated minutes are deliberately rough — students correct them with
 * actual minutes as they complete work.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GENERATION_TIMEOUT_MS = 180_000;

export interface GeneratedTask {
  title: string;
  description: string;
  estimatedMinutes: number;
}

export interface TaskGenInput {
  projectTitle: string;
  pageCount: number | null;
  pdfBase64: string;
}

type GenResult =
  | { ok: true; tasks: GeneratedTask[] }
  | { ok: false; error: string };

const SYSTEM_PROMPT = [
  "You are an experienced project manager breaking a college group assignment into a task list for a student team.",
  "You will receive the professor's assignment brief as a PDF.",
  "",
  "Task design rules:",
  "- Break the assignment into 6-16 concrete, self-contained tasks a single student could pick up and finish.",
  "- Every deliverable, section, and graded component in the brief must be covered by at least one task.",
  "- Include the unglamorous work students forget: scheduling meetings, merging/editing the final document, rehearsing the presentation, submitting.",
  "- Titles are short imperatives ('Draft the literature review'), max 80 characters.",
  "- Descriptions are 1-3 sentences saying what done looks like, referencing the brief's specifics (page counts, rubric items, formats).",
  "- estimatedMinutes: your honest estimate of focused working minutes for one student (15-600). Rough is fine — teams adjust them.",
  "- Order tasks in the sequence a team would naturally do them.",
  "- Do NOT include a 'review the team contract' task — the app adds that automatically.",
  "",
  'Reply with ONLY a JSON object, no markdown fences, in this exact shape: {"tasks": [{"title": string, "description": string, "estimatedMinutes": number}]}',
].join("\n");

/** Tolerate models that wrap JSON in markdown fences despite instructions. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function validateTasks(raw: unknown): GeneratedTask[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(list)) return [];
  const out: GeneratedTask[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    const title = typeof t.title === "string" ? t.title.trim() : "";
    const description =
      typeof t.description === "string" ? t.description.trim() : "";
    const minutes =
      typeof t.estimatedMinutes === "number" &&
      Number.isFinite(t.estimatedMinutes)
        ? Math.min(6000, Math.max(1, Math.round(t.estimatedMinutes)))
        : 30;
    if (!title) continue;
    out.push({
      title: title.slice(0, 200),
      description: description.slice(0, 2000),
      estimatedMinutes: minutes,
    });
  }
  return out.slice(0, 40);
}

export async function generateProjectTasks(
  input: TaskGenInput
): Promise<GenResult> {
  const apiKey = env.openrouterApiKey;
  if (!apiKey) {
    console.error(
      "[projectgen] OPENROUTER_API_KEY is not set in this server process — restart the dev server after editing .env.local."
    );
    return {
      ok: false,
      error:
        "AI generation isn't configured yet — add OPENROUTER_API_KEY to .env.local and restart the app.",
    };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
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
            content: [
              {
                type: "text",
                text: `Assignment brief: "${input.projectTitle}"${input.pageCount ? ` (${input.pageCount} pages)` : ""}. Break it into the task list.`,
              },
              {
                type: "file",
                file: {
                  filename: "assignment.pdf",
                  file_data: `data:application/pdf;base64,${input.pdfBase64}`,
                },
              },
            ],
          },
        ],
        temperature: 0.4,
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Couldn't reach OpenRouter — check your connection and try again.",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[projectgen] OpenRouter ${response.status}: ${detail.slice(0, 500)}`
    );
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: "OpenRouter rejected the API key — check OPENROUTER_API_KEY.",
      };
    }
    if (response.status === 400 || response.status === 404) {
      return {
        ok: false,
        error: `OpenRouter didn't accept the request (model "${env.openrouterModel}"). Set OPENROUTER_MODEL in .env.local to a model your account can use.`,
      };
    }
    return {
      ok: false,
      error: `OpenRouter error (${response.status}) — try again in a moment.`,
    };
  }

  let text: string;
  let rawPayload = "";
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawPayload = JSON.stringify(payload);
    text = payload.choices?.[0]?.message?.content ?? "";
  } catch {
    console.error("[projectgen] OpenRouter response body was not JSON.");
    return { ok: false, error: "OpenRouter returned an unreadable response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error(
      `[projectgen] Model reply wasn't valid JSON. Payload: ${rawPayload.slice(0, 500)}`
    );
    return {
      ok: false,
      error: "The model didn't return valid tasks — try again.",
    };
  }

  const tasks = validateTasks(parsed);
  if (tasks.length === 0) {
    console.error(
      `[projectgen] Model JSON had no usable tasks. Reply: ${text.slice(0, 500)}`
    );
    return {
      ok: false,
      error: "The model didn't return usable tasks — try again.",
    };
  }
  return { ok: true, tasks };
}
