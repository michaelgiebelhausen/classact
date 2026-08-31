import "server-only";
import { env } from "@/lib/env";
import type { ThemeProvenance } from "@/types/db";

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

/** A submission/brief document: PDF, Markdown, or an image (screenshots). */
export type DocKind = "pdf" | "md" | "png" | "jpeg";
export interface DocInput {
  base64: string;
  kind: DocKind;
}

export function docKindFromPath(path: string): DocKind {
  const p = path.toLowerCase();
  if (p.endsWith(".md")) return "md";
  if (p.endsWith(".png")) return "png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "jpeg";
  return "pdf";
}

function pdfPart(filename: string, base64: string) {
  return {
    type: "file" as const,
    file: { filename, file_data: `data:application/pdf;base64,${base64}` },
  };
}

/**
 * Attach a document to a message: PDFs ride as file parts; Markdown is
 * decoded and inlined as text (cheaper, and exact for similarity checks).
 */
function docPart(name: string, doc: DocInput): unknown {
  if (doc.kind === "pdf") return pdfPart(`${name}.pdf`, doc.base64);
  if (doc.kind === "png" || doc.kind === "jpeg") {
    return {
      type: "image_url" as const,
      image_url: { url: `data:image/${doc.kind};base64,${doc.base64}` },
    };
  }
  const text = Buffer.from(doc.base64, "base64")
    .toString("utf8")
    .slice(0, 120_000);
  return {
    type: "text" as const,
    text: `--- ${name}.md (Markdown submission, verbatim) ---\n${text}\n--- end of ${name}.md ---`,
  };
}

/** BYOK: every call carries the paying professor's key + chosen model. */
export interface AiCallCreds {
  apiKey: string;
  model: string;
}

async function callModel(
  messages: unknown[],
  timeoutMs: number,
  label: string,
  creds: AiCallCreds
): Promise<AiResult<string>> {
  const apiKey = creds.apiKey;
  if (!apiKey) {
    console.error(`[tastyai:${label}] called without credentials.`);
    return {
      ok: false,
      error: "AI grading needs an OpenRouter key — connect yours in AI Settings.",
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
        model: creds.model,
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

/**
 * The drafted seed. `body` is the prose a student edits; the older
 * `criteria`/`barStatement` shape still turns up in assignments opened before
 * taste files became free-flowing, and draftBody() reads both.
 */
export interface TasteDraft {
  body: string;
}

/** AI-drafted starting taste file — the student's to sharpen, not to keep. */
export async function generateDefaultTaste(
  input: {
    assignmentTitle: string;
    brief: DocInput | null;
    /** 0033 — the typed brief. An assignment may carry this instead of a
     *  PDF; without it a text-only assignment drafted from the title alone
     *  and every student started from a near-empty taste file. */
    instructions?: string;
  },
  creds: AiCallCreds
): Promise<AiResult<TasteDraft>> {
  const system = [
    "You draft a starting 'taste file' for a college assignment: what a student thinks makes work on it genuinely good.",
    "Write 150-250 words of FLOWING PROSE in the student's first-person voice — not a list, not headings, not a rubric grid. Short paragraphs are fine.",
    "Name 4-6 concrete, checkable qualities for THIS specific assignment (not platitudes), and end with one sentence stating the personal bar: what would make them proud to hand it in.",
    "Keep it deliberately solid-but-generic: students are scored on how far they push BEYOND this default, and it should read like an invitation to argue with it.",
    'Reply with ONLY JSON: {"seed":string}',
  ].join("\n");
  const instructions = (input.instructions ?? "").trim();
  const content: unknown[] = [
    {
      type: "text",
      text: instructions
        ? `Assignment: "${input.assignmentTitle}".

Instructions given to students:
${instructions}

Draft the default taste file.`
        : `Assignment: "${input.assignmentTitle}". Draft the default taste file.`,
    },
  ];
  if (input.brief) content.push(docPart("assignment", input.brief));
  const result = await callModel(
    [
      { role: "system", content: system },
      { role: "user", content },
    ],
    90_000,
    "tastegen",
    creds
  );
  if (!result.ok) return result;
  const parsed = parseJson<{ seed?: unknown }>(result.data, "tastegen");
  const body =
    typeof parsed?.seed === "string" ? parsed.seed.trim().slice(0, 4000) : "";
  if (!body) {
    return { ok: false, error: "Couldn't draft the taste file — try again." };
  }
  return { ok: true, data: { body } };
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

export async function emergeRubric(
  input: {
    assignmentTitle: string;
    /** enrollmentId null = the professor's benchmark materials. */
    tasteFiles: Array<{
      enrollmentId: string | null;
      /** The taste file as prose — free-flowing text, or a legacy grid
       *  rendered as prose by tasteProse(). */
      text: string;
    }>;
  },
  creds: AiCallCreds
): Promise<AiResult<EmergentTheme[]>> {
  const corpus = input.tasteFiles
    .map((tf, i) => {
      const who = tf.enrollmentId === null ? "PROFESSOR" : `S${i}`;
      return `[${who}]\n${tf.text}`;
    })
    .join("\n\n");
  const idByTag = new Map<string, string | null>();
  input.tasteFiles.forEach((tf, i) => {
    idByTag.set(tf.enrollmentId === null ? "PROFESSOR" : `S${i}`, tf.enrollmentId);
  });

  const system = [
    "You are performing a grounded-theory analysis of a class's 'taste files' — each person's own free-form writing about what makes work on this assignment good.",
    "They wrote in prose, in their own voice and at their own length; read for what they MEAN, not for structure, and treat a rambling entry as seriously as a tidy one.",
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
    "rubricgen",
    creds
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
export async function generateBaselines(
  input: {
    assignmentTitle: string;
    brief: DocInput | null;
  },
  creds: AiCallCreds
): Promise<AiResult<string[]>> {
  const content: unknown[] = [
    {
      type: "text",
      text: `Complete this assignment: "${input.assignmentTitle}". Give a competent, complete answer.`,
    },
  ];
  if (input.brief) content.push(docPart("assignment", input.brief));
  const results = await Promise.all(
    [0, 1, 2].map(() =>
      callModel([{ role: "user", content }], 120_000, "baseline", creds)
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

export async function scoreSubmission(
  input: {
    assignmentTitle: string;
    submission: DocInput;
    themes: Array<{ id: string; name: string; description: string; itemQuotes: string[] }>;
    /** The student's own taste file as prose. */
    ownTaste: { text: string } | null;
    baselines: string[];
  },
  creds: AiCallCreds
): Promise<AiResult<SubmissionScore>> {
  const rubric = input.themes
    .map(
      (t, i) =>
        `${i + 1}. ${t.name} [id:${t.id}] — ${t.description}\n   Items: ${t.itemQuotes.slice(0, 4).join(" | ")}`
    )
    .join("\n");
  const ownTasteText = input.ownTaste?.text.trim() || "(none submitted)";
  const baselineText = input.baselines
    .map((b, i) => `--- Generic answer ${i + 1} ---\n${b.slice(0, 3000)}`)
    .join("\n\n");

  const isImage =
    input.submission.kind === "png" || input.submission.kind === "jpeg";
  const system = [
    isImage
      ? "You are grading one student submission that is an IMAGE (typically a screenshot) for a college assignment, against the class's emergent rubric. Assess it VISUALLY: read what is actually visible — interface elements, counts, numbers, labels, and any scores shown. When the rubric or the student's criteria name a specific visible fact (e.g. the number of sources shown, or whether a quiz score is out of 10), verify it from the image itself; never assume anything that isn't visible in the image."
      : "You are grading one student submission (attached as a PDF file or inlined Markdown) for a college assignment, against the class's emergent rubric.",
    "Score each theme 0-10, anchored: 5 = solid/typical, 8 = clearly strong, 10 = exceptional. For each theme give one short evidence quote FROM THE SUBMISSION.",
    "overall: 0-10 holistic quality.",
    "ownBar: 0-10 — did the work meet the STUDENT'S OWN taste file (provided)?",
    "distinctiveness: 0-10 — how far does this go beyond the attached GENERIC one-shot answers? 10 = unmistakably its author's own thinking/voice/examples; 2-3 = reads like light edits of the generic answer. Judge convergence, not tool use.",
    "summary: 2-3 sentences of feedback for the student — specific, constructive, referencing the rubric.",
    isImage
      ? "extractedText: transcribe the readable text visible in the image — labels, numbers, headings — up to ~500 words, for similarity analysis."
      : "extractedText: the submission's plain text (up to ~2000 words), for similarity analysis.",
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
          docPart("submission", input.submission),
        ],
      },
    ],
    150_000,
    "scoregen",
    creds
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
