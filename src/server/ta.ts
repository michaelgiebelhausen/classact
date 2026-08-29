import "server-only";
import { env } from "@/lib/env";

/**
 * Ask-the-TA model calls (OpenRouter, BYOK — resolveCourseAi(courseId, "ta"
 * | "extract") decides whose key pays; there is no platform subsidy for
 * either). Corpus assembly and the system prompt live in lib/tacorpus.ts
 * where they're testable; this file is just the wire.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface TaCreds {
  apiKey: string;
  model: string;
}

type TaResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callOpenRouter(
  body: Record<string, unknown>,
  timeoutMs: number,
  label: string,
  apiKey: string
): Promise<TaResult<string>> {
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
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the AI — try again." };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[ta:${label}] OpenRouter ${response.status}: ${detail.slice(0, 400)}`
    );
    return { ok: false, error: `AI call failed (${response.status}) — try again.` };
  }
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      return { ok: false, error: "The AI returned an empty answer — try again." };
    }
    return { ok: true, data: content };
  } catch {
    return { ok: false, error: "The AI returned an unreadable response." };
  }
}

/**
 * Index one PDF into corpus text: the model transcribes it to plain
 * markdown-ish text. Slides keep their page numbers as `## Slide N` so TA
 * citations can point at a slide.
 */
export async function extractPdfText(
  base64: string,
  filename: string,
  kind: "slides" | "reading" | "syllabus",
  creds: TaCreds
): Promise<TaResult<string>> {
  const instruction =
    kind === "slides"
      ? "Transcribe this slide deck to text. Head each slide with '## Slide N' (N = its position in the file). Include all visible text; describe meaningful figures in one line each; skip decorative elements. Output only the transcription."
      : `Transcribe this ${kind} document to plain text, preserving its structure with simple headings. Include all body text. Output only the transcription.`;
  return callOpenRouter(
    {
      model: creds.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            {
              type: "file",
              file: {
                filename,
                file_data: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
    },
    150_000,
    `extract:${kind}`,
    creds.apiKey
  );
}

export interface TaTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Answer one question over the assembled corpus. The corpus rides in the
 * system message with an Anthropic cache_control breakpoint — OpenRouter
 * passes it through, so consecutive questions (any student, same course,
 * same model) reuse the cached prefix and cost cents. Non-Anthropic models
 * ignore the field harmlessly.
 */
export async function answerTa(
  systemPrompt: string,
  corpusText: string,
  history: TaTurn[],
  question: string,
  creds: TaCreds
): Promise<TaResult<string>> {
  return callOpenRouter(
    {
      model: creds.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: `${systemPrompt}\n\n${corpusText}`,
              cache_control: { type: "ephemeral" },
            },
          ],
        },
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: question },
      ],
    },
    90_000,
    "ask",
    creds.apiKey
  );
}
