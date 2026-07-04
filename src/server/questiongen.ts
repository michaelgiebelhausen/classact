import "server-only";
import { env } from "@/lib/env";

/**
 * AI think-pair-share question generation via OpenRouter (Mike's existing
 * account). The slide deck — and the optional Reading/Reference PDF — are sent
 * as native PDF attachments so the model sees figures, not just text.
 *
 * The prompt encodes Peer Instruction question design (Crouch & Mazur 2001):
 * conceptual questions with misconception-based distractors, pitched so
 * 35–70% of students answer correctly before discussion, and spaced through
 * the deck so the class never goes ~15 minutes without an activity.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GENERATION_TIMEOUT_MS = 180_000;

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  correctIndices: number[];
  rationale: string;
  positionAfterPage: number;
}

export interface QuestionGenInput {
  deckTitle: string;
  pageCount: number | null;
  deckPdfBase64: string;
  readingPdfBase64?: string | null;
  readingTitle?: string | null;
}

type GenResult =
  | { ok: true; questions: GeneratedQuestion[] }
  | { ok: false; error: string };

function buildSystemPrompt(pageCount: number | null): string {
  const target = pageCount
    ? Math.min(8, Math.max(2, Math.round(pageCount / 10)))
    : 4;
  return [
    "You are an expert in Peer Instruction (Eric Mazur's method) writing ConcepTest questions for a college lecture.",
    "You will receive the professor's slide deck as a PDF, and possibly an assigned reading as a second PDF.",
    `Write exactly ${target} multiple-choice think-pair-share questions.`,
    "",
    "Question design rules (from ten years of Peer Instruction research):",
    "- Test CONCEPTS and reasoning, never recall, definitions, or cleverness.",
    "- Every wrong option must be a plausible answer a real student would give — base distractors on common misconceptions about the material.",
    "- Pitch difficulty so roughly 35-70% of students would answer correctly before discussing: hard enough to argue about, not so hard discussion is hopeless.",
    "- Questions must reference the actual material on the slides. When a reading is provided, draw on it where it connects to the slides.",
    "- 3 to 5 options per question. Usually one correct answer; more than one only when genuinely warranted.",
    "",
    "Placement rules (student attention spans — a class should never go more than ~15 minutes without an activity):",
    "- positionAfterPage means the question interrupts the lecture right after that slide.",
    "- Place a question where the relevant concept has just been presented.",
    pageCount
      ? `- The deck has ${pageCount} slides. Spread questions so no stretch of more than ~10 slides goes without one, none before slide 3, and none on the final slide.`
      : "- Spread questions evenly through the deck, none in the first two slides.",
    "",
    'Reply with ONLY a JSON object, no markdown fences, in this exact shape: {"questions": [{"prompt": string, "options": string[], "correctIndices": number[], "rationale": string, "positionAfterPage": number}]}',
    "rationale: one or two sentences for the professor — which misconception the distractors target and why this slide position.",
    "correctIndices: zero-based indexes into options.",
  ].join("\n");
}

function pdfPart(filename: string, base64: string) {
  return {
    type: "file" as const,
    file: { filename, file_data: `data:application/pdf;base64,${base64}` },
  };
}

/** Tolerate models that wrap JSON in markdown fences despite instructions. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function validateQuestions(
  raw: unknown,
  pageCount: number | null
): GeneratedQuestion[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(list)) return [];
  const maxPage = pageCount ?? 2000;
  const out: GeneratedQuestion[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const q = item as Record<string, unknown>;
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    const options = Array.isArray(q.options)
      ? q.options.filter(
          (o): o is string => typeof o === "string" && o.trim().length > 0
        )
      : [];
    const correct = Array.isArray(q.correctIndices)
      ? q.correctIndices.filter(
          (i): i is number => Number.isInteger(i) && i >= 0 && i < options.length
        )
      : [];
    const position =
      typeof q.positionAfterPage === "number" &&
      Number.isFinite(q.positionAfterPage)
        ? Math.min(maxPage, Math.max(1, Math.round(q.positionAfterPage)))
        : 1;
    if (!prompt || options.length < 2 || correct.length === 0) continue;
    out.push({
      prompt: prompt.slice(0, 2000),
      options: options.slice(0, 6).map((o) => o.slice(0, 500)),
      correctIndices: correct,
      rationale:
        typeof q.rationale === "string" ? q.rationale.slice(0, 2000) : "",
      positionAfterPage: position,
    });
  }
  return out;
}

export async function generateTpsQuestions(
  input: QuestionGenInput
): Promise<GenResult> {
  const apiKey = env.openrouterApiKey;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI generation isn't configured yet — add OPENROUTER_API_KEY to .env.local and restart the app.",
    };
  }

  const userContent: unknown[] = [
    {
      type: "text",
      text: input.readingPdfBase64
        ? `Slide deck: "${input.deckTitle}". The second PDF is the assigned reading${input.readingTitle ? ` ("${input.readingTitle}")` : ""}. Generate the think-pair-share questions.`
        : `Slide deck: "${input.deckTitle}". Generate the think-pair-share questions.`,
    },
    pdfPart("slides.pdf", input.deckPdfBase64),
  ];
  if (input.readingPdfBase64) {
    userContent.push(pdfPart("reading.pdf", input.readingPdfBase64));
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
          { role: "system", content: buildSystemPrompt(input.pageCount) },
          { role: "user", content: userContent },
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
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    text = payload.choices?.[0]?.message?.content ?? "";
  } catch {
    return { ok: false, error: "OpenRouter returned an unreadable response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return {
      ok: false,
      error: "The model didn't return valid questions — try again.",
    };
  }

  const questions = validateQuestions(parsed, input.pageCount);
  if (questions.length === 0) {
    return {
      ok: false,
      error: "The model didn't return usable questions — try again.",
    };
  }
  return { ok: true, questions };
}
