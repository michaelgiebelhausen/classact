import "server-only";
import { env } from "@/lib/env";
import type { TasteCriterion, ThemeProvenance } from "@/types/db";

/**
 * Tasty Grading's AI layer (OpenRouter, same account/model as question
 * generation): default taste files, grounded-theory rubric emergence,
 * one-shot baselines, and per-submission scoring. Every function returns
 * validated, clamped data or a typed error — model output is never trusted
 * raw. Spec: docs/tasty-grading-plan.md.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function pdfPart(filename: string, base64: string) {
  return {
    type: "file" as const,
    file: { filename, file_data: `data:application/pdf;base64,${base64}` },
  };
}

async function callModel(
  messages: unknown[],
  timeoutMs: number,
  label: string
): Promise<AiResult<string>> {
  const apiKey = env.openrouterApiKey;
  if (!apiKey) {
    console.error(`[tastyai:${label}] OPENROUTER_API_KEY is not set.`);
    return {
      ok: false,
      error:
        "AI grading isn't configured yet — add OPENROUTER_API_KEY to .env.local and restart the app.",
    };
  }
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.siteUrl,
        "X-Title": "ClassAct",
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        messages,
        temperature: 0.3,
      }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach OpenRouter — try again." };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[tastyai:${label}] OpenRouter ${response.status}: ${detail.slice(0, 400)}`);
    return { ok: false, error: `AI call failed (${response.status}) — try again.` };
  }
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { ok: true, data: payload.choices?.[0]?.message?.content ?? "" };
  } catch {
    return { ok: false, error: "AI returned an unreadable response." };
  }
}

function parseJson<T>(text: string, label: string): T | null {
  try {
    return JSON.parse(extractJson(text)) as T;
  } catch {
    console.error(`[tastyai:${label}] reply wasn't valid JSON: ${text.slice(0, 300)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Default taste file (on assignment publish)
// ---------------------------------------------------------------------------

export interface TasteDraft {
  criteria: TasteCriterion[];
  barStatement: string;
}

function cleanCriteria(raw: unknown, max = 10): TasteCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: TasteCriterion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 80) : "";
    const standard =
      typeof c.standard === "string" ? c.standard.trim().slice(0, 500) : "";
    if (name && standard) out.push({ name, standard });
    if (out.length >= max) break;
  }
  return out;
}

/** AI-drafted starting taste file — the student's to sharpen, not to keep. */
export async function generateDefaultTaste(input: {
  assignmentTitle: string;
  briefPdfBase64: string | null;
}): Promise<AiResult<TasteDraft>> {
  const system = [
    "You draft a starting 'taste file' for a college assignment: the standards a student will hold their own work to.",
    "Write 5-7 criteria. Each: a short name and 1-2 sentences describing what EXCELLENT looks like for this specific assignment — concrete and checkable, not platitudes.",
    "Also write a one-sentence 'bar statement' in first person (the student's personal bar).",
    "Keep it deliberately solid-but-generic: students are scored on how far they push BEYOND this default.",
    'Reply with ONLY JSON: {"criteria":[{"name":string,"standard":string}],"barStatement":string}',
  ].join("\n");
  const content: unknown[] = [
    { type: "text", text: `Assignment: "${input.assignmentTitle}". Draft the default taste file.` },
  ];
  if (input.briefPdfBase64) content.push(pdfPart("assignment.pdf", input.briefPdfBase64));
  const result = await callModel(
    [
      { role: "system", content: system },
      { role: "user", content },
    ],
    90_000,
    "tastegen"
  );
  if (!result.ok) return result;
  const parsed = parseJson<{ criteria?: unknown; barStatement?: unknown }>(
    result.data,
    "tastegen"
  );
  const criteria = cleanCriteria(parsed?.criteria);
  if (criteria.length === 0) {
    return { ok: false, error: "Couldn't draft the taste file — try again." };
  }
  return {
    ok: true,
    data: {
      criteria,
      barStatement:
        typeof parsed?.barStatement === "string"
          ? parsed.barStatement.trim().slice(0, 300)
          : "",
    },
  };
}

// ---------------------------------------------------------------------------
// Rubric emergence (grounded theory over the locked taste files)
// ---------------------------------------------------------------------------

export interface EmergentTheme {
  name: string;
  description: string;
  provenance: ThemeProvenance;
  items: Array<{ quote: string; enrollment_id: string | null }>;
}

export async function emergeRubric(input: {
  assignmentTitle: string;
  /** enrollmentId null = the professor's benchmark materials. */
  tasteFiles: Array<{
    enrollmentId: string | null;
    criteria: TasteCriterion[];
    barStatement: string;
  }>;
}): Promise<AiResult<EmergentTheme[]>> {
  const corpus = input.tasteFiles
    .map((tf, i) => {
      const who = tf.enrollmentId === null ? "PROFESSOR" : `S${i}`;
      const lines = tf.criteria
        .map((c) => `- ${c.name}: ${c.standard}`)
        .join("\n");
      return `[${who}]\n${lines}${tf.barStatement ? `\nBar: ${tf.barStatement}` : ""}`;
    })
    .join("\n\n");
  const idByTag = new Map<string, string | null>();
  input.tasteFiles.forEach((tf, i) => {
    idByTag.set(tf.enrollmentId === null ? "PROFESSOR" : `S${i}`, tf.enrollmentId);
  });

  const system = [
    "You are performing a grounded-theory analysis of a class's 'taste files' — each student's own criteria for excellent work on the same assignment.",
    "Extract 4-8 emergent THEMES (latent constructs, like scales in psychometrics). Each theme is evidenced by ITEMS: near-verbatim quotes of the best sentences students actually wrote, each tagged with its author tag (S3, PROFESSOR, ...).",
    "Prefer themes several voices support. If a PROFESSOR taste file is present, its themes are seeds that must survive (provenance 'professor', or 'both' when the class echoes them). Themes only the class raised get provenance 'class'.",
    "Theme names: short and vivid. Descriptions: 1-2 sentences defining the construct.",
    'Reply with ONLY JSON: {"themes":[{"name":string,"description":string,"provenance":"professor"|"class"|"both","items":[{"quote":string,"author":string}]}]}',
  ].join("\n");

  const result = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `Assignment: "${input.assignmentTitle}".\n\nTaste files:\n\n${corpus.slice(0, 120_000)}`,
      },
    ],
    150_000,
    "rubricgen"
  );
  if (!result.ok) return result;
  const parsed = parseJson<{ themes?: unknown }>(result.data, "rubricgen");
  if (!parsed || !Array.isArray(parsed.themes)) {
    return { ok: false, error: "Rubric analysis failed — try again." };
  }
  const themes: EmergentTheme[] = [];
  for (const raw of parsed.themes) {
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const name = typeof t.name === "string" ? t.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const provenance: ThemeProvenance =
      t.provenance === "professor" || t.provenance === "both" ? t.provenance : "class";
    const items: EmergentTheme["items"] = [];
    if (Array.isArray(t.items)) {
      for (const rawItem of t.items.slice(0, 12)) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const item = rawItem as Record<string, unknown>;
        const quote =
          typeof item.quote === "string" ? item.quote.trim().slice(0, 400) : "";
        if (!quote) continue;
        const tag = typeof item.author === "string" ? item.author : "";
        items.push({ quote, enrollment_id: idByTag.get(tag) ?? null });
      }
    }
    if (items.length === 0) continue;
    themes.push({
      name,
      description:
        typeof t.description === "string" ? t.description.trim().slice(0, 400) : "",
      provenance,
      items,
    });
    if (themes.length >= 8) break;
  }
  if (themes.length === 0) {
    return { ok: false, error: "No usable themes emerged — try again." };
  }
  return { ok: true, data: themes };
}

// ---------------------------------------------------------------------------
// One-shot baselines (the generic attractor)
// ---------------------------------------------------------------------------

/** What a lazy prompt-paste would produce — the reference for "generic". */
export async function generateBaselines(input: {
  assignmentTitle: string;
  briefPdfBase64: string | null;
}): Promise<AiResult<string[]>> {
  const content: unknown[] = [
    {
      type: "text",
      text: `Complete this assignment: "${input.assignmentTitle}". Give a competent, complete answer.`,
    },
  ];
  if (input.briefPdfBase64) content.push(pdfPart("assignment.pdf", input.briefPdfBase64));
  const results = await Promise.all(
    [0, 1, 2].map(() =>
      callModel([{ role: "user", content }], 120_000, "baseline")
    )
  );
  const texts = results
    .filter((r): r is { ok: true; data: string } => r.ok)
    .map((r) => r.data.slice(0, 6000));
  if (texts.length === 0) {
    return { ok: false, error: "Couldn't generate baselines." };
  }
  return { ok: true, data: texts };
}

// ---------------------------------------------------------------------------
// Per-submission scoring
// ---------------------------------------------------------------------------

export interface SubmissionScore {
  themeScores: Array<{ themeId: string; score: number; evidence: string }>;
  overall: number;
  ownBar: number;
  distinctiveness: number;
  summary: string;
  /** Plain text of the submission, extracted by the model for shingling. */
  extractedText: string;
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
}

export async function scoreSubmission(input: {
  assignmentTitle: string;
  submissionPdfBase64: string;
  themes: Array<{ id: string; name: string; description: string; itemQuotes: string[] }>;
  ownTaste: { criteria: TasteCriterion[]; barStatement: string } | null;
  baselines: string[];
}): Promise<AiResult<SubmissionScore>> {
  const rubric = input.themes
    .map(
      (t, i) =>
        `${i + 1}. ${t.name} [id:${t.id}] — ${t.description}\n   Items: ${t.itemQuotes.slice(0, 4).join(" | ")}`
    )
    .join("\n");
  const ownTasteText = input.ownTaste
    ? input.ownTaste.criteria.map((c) => `- ${c.name}: ${c.standard}`).join("\n") +
      (input.ownTaste.barStatement ? `\nBar: ${input.ownTaste.barStatement}` : "")
    : "(none submitted)";
  const baselineText = input.baselines
    .map((b, i) => `--- Generic answer ${i + 1} ---\n${b.slice(0, 3000)}`)
    .join("\n\n");

  const system = [
    "You are grading one student submission (PDF attached) for a college assignment, against the class's emergent rubric.",
    "Score each theme 0-10, anchored: 5 = solid/typical, 8 = clearly strong, 10 = exceptional. For each theme give one short evidence quote FROM THE SUBMISSION.",
    "overall: 0-10 holistic quality.",
    "ownBar: 0-10 — did the work meet the STUDENT'S OWN taste file (provided)?",
    "distinctiveness: 0-10 — how far does this go beyond the attached GENERIC one-shot answers? 10 = unmistakably its author's own thinking/voice/examples; 2-3 = reads like light edits of the generic answer. Judge convergence, not tool use.",
    "summary: 2-3 sentences of feedback for the student — specific, constructive, referencing the rubric.",
    "extractedText: the submission's plain text (up to ~2000 words), for similarity analysis.",
    'Reply with ONLY JSON: {"themeScores":[{"themeId":string,"score":number,"evidence":string}],"overall":number,"ownBar":number,"distinctiveness":number,"summary":string,"extractedText":string}',
  ].join("\n");

  const result = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Assignment: "${input.assignmentTitle}".\n\nRubric:\n${rubric}\n\nThe student's own taste file:\n${ownTasteText}\n\nGeneric one-shot answers for distinctiveness reference:\n${baselineText}`,
          },
          pdfPart("submission.pdf", input.submissionPdfBase64),
        ],
      },
    ],
    150_000,
    "scoregen"
  );
  if (!result.ok) return result;
  const parsed = parseJson<Record<string, unknown>>(result.data, "scoregen");
  if (!parsed) return { ok: false, error: "Scoring failed — try again." };

  const themeScores: SubmissionScore["themeScores"] = [];
  const validThemeIds = new Set(input.themes.map((t) => t.id));
  if (Array.isArray(parsed.themeScores)) {
    for (const raw of parsed.themeScores) {
      if (typeof raw !== "object" || raw === null) continue;
      const ts = raw as Record<string, unknown>;
      const themeId = typeof ts.themeId === "string" ? ts.themeId : "";
      if (!validThemeIds.has(themeId)) continue;
      themeScores.push({
        themeId,
        score: clampScore(ts.score),
        evidence:
          typeof ts.evidence === "string" ? ts.evidence.trim().slice(0, 400) : "",
      });
    }
  }
  if (themeScores.length === 0) {
    return { ok: false, error: "Scoring returned no theme scores — try again." };
  }
  return {
    ok: true,
    data: {
      themeScores,
      overall: clampScore(parsed.overall),
      ownBar: clampScore(parsed.ownBar),
      distinctiveness: clampScore(parsed.distinctiveness),
      summary:
        typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1500) : "",
      extractedText:
        typeof parsed.extractedText === "string"
          ? parsed.extractedText.slice(0, 20_000)
          : "",
    },
  };
}
