import "server-only";
import { env } from "@/lib/env";
import type { ThemeProvenance } from "@/types/db";
import { MAX_CRITERIA, proposedWeights } from "@/lib/rubric";

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
  /** Set when this theme IS one of the professor's seed criteria. */
  seedId?: string;
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
    /** The professor's rubric grid, when they built one before the deadline.
     *  Fixed: every seed comes back exactly as written (the class can only
     *  add evidence to it), and the class's own themes join beside them. */
    seeds?: Array<{ id: string; name: string; description: string }>;
  },
  creds: AiCallCreds
): Promise<AiResult<EmergentTheme[]>> {
  const seeds = input.seeds ?? [];
  const seedByTag = new Map(seeds.map((s, i) => [`P${i + 1}`, s]));
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
    ...(seeds.length > 0
      ? [
          'The PROFESSOR has already fixed some rubric criteria, tagged P1, P2, ... below. Return EVERY one of them exactly once with "seed" set to its tag, and attach as items any class quotes that evidence it (items may be empty). Do not rename, merge, or split them.',
          'Then add the themes ONLY the class raised that no seed already covers, without a "seed" field.',
        ]
      : []),
    'Reply with ONLY JSON: {"themes":[{"name":string,"description":string,"provenance":"professor"|"class"|"both","seed"?:string,"items":[{"quote":string,"author":string}]}]}',
  ].join("\n");
  const seedText =
    seeds.length > 0
      ? `\n\nThe professor's fixed criteria:\n${seeds
          .map((sd, i) => `[P${i + 1}] ${sd.name} — ${sd.description}`)
          .join("\n")}`
      : "";

  const result = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `Assignment: "${input.assignmentTitle}".${seedText}\n\nTaste files:\n\n${corpus.slice(0, 120_000)}`,
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
  const seedThemes = new Map<string, EmergentTheme>();
  for (const raw of parsed.themes) {
    if (typeof raw !== "object" || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const seed = typeof t.seed === "string" ? seedByTag.get(t.seed) : undefined;
    const name = typeof t.name === "string" ? t.name.trim().slice(0, 80) : "";
    if (!name && !seed) continue;
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
    if (seed) {
      // The professor's words stand; the class only adds evidence. A seed the
      // model returned twice keeps the first.
      if (seedThemes.has(seed.id)) continue;
      seedThemes.set(seed.id, {
        name: seed.name,
        description: seed.description,
        provenance: items.some((i) => i.enrollment_id !== null) ? "both" : "professor",
        items,
        seedId: seed.id,
      });
      continue;
    }
    if (items.length === 0 || themes.length >= 8) continue;
    themes.push({
      name,
      description:
        typeof t.description === "string" ? t.description.trim().slice(0, 400) : "",
      provenance,
      items,
    });
  }
  // Seeds always survive — one the model dropped comes back with no quotes.
  const seeded: EmergentTheme[] = seeds.map(
    (sd) =>
      seedThemes.get(sd.id) ?? {
        name: sd.name,
        description: sd.description,
        provenance: "professor",
        items: [],
        seedId: sd.id,
      }
  );
  // A class theme that merely repeats a seed's name would be a duplicate row.
  const seedNames = new Set(seeds.map((sd) => sd.name.trim().toLowerCase()));
  const all = [
    ...seeded,
    ...themes.filter((t) => !seedNames.has(t.name.trim().toLowerCase())),
  ].slice(0, Math.max(MAX_CRITERIA, seeds.length));
  if (all.length === 0) {
    return { ok: false, error: "No usable themes emerged — try again." };
  }
  return { ok: true, data: all };
}

// ---------------------------------------------------------------------------
// Taste file → rubric grid (the professor's own, while the assignment is open)
// ---------------------------------------------------------------------------

export interface DraftCriterion {
  name: string;
  description: string;
  /** A percentage share; the set sums to roughly 100. */
  weight: number;
}

/**
 * Turn the professor's prose taste file into a rubric grid they can edit:
 * criteria with what excellent looks like and a proposed weight. A faithful
 * restructuring of THEIR standard — nothing they didn't say gets invented.
 */
export async function rubricFromTaste(
  input: { assignmentTitle: string; instructions: string; tasteText: string },
  creds: AiCallCreds
): Promise<AiResult<DraftCriterion[]>> {
  const system = [
    "You turn a professor's free-form 'taste file' — their own prose about what makes work on an assignment good — into a rubric grid they will edit.",
    "Extract 3-8 CRITERIA. Each: a short name (2-4 words), a description of what EXCELLENT work looks like on it (1-2 concrete, checkable sentences), and a weight: the percentage of the grade it deserves, judging by how much the professor emphasizes it. Weights sum to 100.",
    "Stay faithful: every criterion must come from what the professor actually wrote. Do not add generic criteria (grammar, formatting, citations) unless they asked for them. Keep their own phrasing where you can.",
    "If the taste file is really one instruction (e.g. 'count the questions marked correct'), one or two criteria is the right answer.",
    'Reply with ONLY JSON: {"criteria":[{"name":string,"description":string,"weight":number}]}',
  ].join("\n");
  const instructions = input.instructions.trim();
  const result = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `Assignment: "${input.assignmentTitle}".${
          instructions
            ? `\n\nInstructions given to students:\n${instructions.slice(0, 8000)}`
            : ""
        }\n\nThe professor's taste file:\n${input.tasteText.slice(0, 20_000)}`,
      },
    ],
    90_000,
    "rubricdraft",
    creds
  );
  if (!result.ok) return result;
  const parsed = parseJson<{ criteria?: unknown }>(result.data, "rubricdraft");
  if (!parsed || !Array.isArray(parsed.criteria)) {
    return { ok: false, error: "Couldn't turn the taste file into a rubric — try again." };
  }
  const rows: Array<{ name: string; description: string; weight: unknown }> = [];
  const seen = new Set<string>();
  for (const raw of parsed.criteria) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 80) : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    rows.push({
      name,
      description:
        typeof c.description === "string" ? c.description.trim().slice(0, 600) : "",
      weight: c.weight,
    });
    if (rows.length >= MAX_CRITERIA) break;
  }
  if (rows.length === 0) {
    return { ok: false, error: "Couldn't turn the taste file into a rubric — try again." };
  }
  const weights = proposedWeights(rows.map((r) => r.weight));
  return {
    ok: true,
    data: rows.map((r, i) => ({
      name: r.name,
      description: r.description,
      weight: weights[i],
    })),
  };
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

// ---------------------------------------------------------------------------
// Standards comparison (student's taste vs the instructor's)
// ---------------------------------------------------------------------------

export interface StandardsComparison {
  /** 0–10; 5 = the student's bar matches the instructor's, >5 higher. */
  bar: number;
  /** One sentence to the student on where their bar sits. */
  note: string;
}

/**
 * How high a bar did the student set for THEMSELVES, relative to the
 * instructor's? Judges the two taste files against each other — the standard,
 * not the work (scoreSubmission's ownBar is the work). It's the counterweight
 * to gaming ownBar with a deliberately low standard: a soft or gameable student
 * taste scores low here.
 */
export async function compareStandards(
  input: {
    assignmentTitle: string;
    instructorTaste: string;
    studentTaste: string;
  },
  creds: AiCallCreds
): Promise<AiResult<StandardsComparison>> {
  const system = [
    "You are comparing two 'taste files' for a college assignment — each is a person's own written standard for what makes work on it good. One is the INSTRUCTOR's, one a STUDENT's.",
    "Judge ONLY how high and rigorous the STUDENT's standard is relative to the INSTRUCTOR's — the bar the student holds THEMSELVES to. Judge the standard itself, not the prose quality, length, or writing polish.",
    "bar: 0-10, anchored — 5 = the student's bar matches the instructor's; 8 = clearly more demanding than the instructor's; 2 = clearly softer, vaguer, or lower than the instructor's. A vague, low-commitment, or easily-gamed student taste scores LOW.",
    "note: ONE sentence, addressed to the student, on where their bar sits versus the course's.",
    'Reply with ONLY JSON: {"bar":number,"note":string}',
  ].join("\n");

  const result = await callModel(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `Assignment: "${input.assignmentTitle}".\n\nINSTRUCTOR's standard:\n${input.instructorTaste.slice(0, 8000)}\n\nSTUDENT's standard:\n${input.studentTaste.slice(0, 8000)}`,
      },
    ],
    90_000,
    "standards",
    creds
  );
  if (!result.ok) return result;
  const parsed = parseJson<{ bar?: unknown; note?: unknown }>(result.data, "standards");
  if (!parsed) return { ok: false, error: "Standards comparison failed — try again." };
  return {
    ok: true,
    data: {
      bar: clampScore(parsed.bar),
      note:
        typeof parsed.note === "string" ? parsed.note.trim().slice(0, 400) : "",
    },
  };
}
