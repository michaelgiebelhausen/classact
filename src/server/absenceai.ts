import "server-only";
import { env } from "@/lib/env";
import {
  categoryLabel,
  validateAssessment,
  type AbsenceAssessment,
  type AttendancePolicy,
} from "@/lib/absences";
import type { AbsenceCategory } from "@/types/db";

/**
 * The absence judge. Given the professor's policy and a student's report —
 * and optionally a document, held in memory only — return a verdict the
 * student sees immediately and a score the professor can trust.
 *
 * Same OpenRouter pattern as questiongen/tastyai: raw fetch, prompt-
 * instructed JSON, fence-stripped, then hand-validated and clamped in
 * lib/absences so a confused model can't write garbage into the table.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 60_000;

export interface AbsenceAiInput {
  courseName: string;
  policy: AttendancePolicy;
  category: AbsenceCategory;
  explanation: string;
  /** "YYYY-MM-DD" in the course zone, plus a human label like "Mon Aug 24, 9:30 AM". */
  absenceDate: string;
  meetingLabel: string | null;
  /** Hours of notice; negative = after class began; null = no schedule. */
  advanceHours: number | null;
  /** How many absences this student has already reported this term, by verdict. */
  priorExcused: number;
  priorUnexcused: number;
  /** They already checked into another ClassAct class on this date. */
  attendedElsewhere: boolean;
  document: { mimeType: string; base64: string } | null;
}

export type AbsenceAiResult =
  | { ok: true; assessment: AbsenceAssessment }
  | { ok: false; error: string };

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

const SYSTEM_PROMPT = `You are the attendance assistant for a university course. A student has reported that they will miss (or missed) a class. Your job is to apply the professor's attendance policy fairly and consistently, the way a thoughtful teaching assistant would, and explain the outcome to the student in one or two plain sentences.

You will receive the policy, the student's report, how much notice they gave, how many absences they've already reported this term, and sometimes a document.

Judge the REPORT:
- Does the category fit the explanation? Is the explanation specific enough to be credible, or vague boilerplate?
- Was the notice reasonable for this kind of absence? Planned events (athletics, interviews, university trips, weddings, religious observance) should come in advance. Illness and bereavement cannot be planned; treat same-day notice before class as normal for them, and notice after class started as a mark against unless there is a good reason.
- Repeated absences of the same kind deserve more scrutiny, not automatic denial.
- If the student already checked into another ClassAct class on the same day, weigh it: an away game is still plausible (the other class was earlier), but "too sick to come" is much less plausible.
- Be humane about bereavement and illness. Do not demand detail; judge plausibility and consistency.

If a DOCUMENT is attached, assess it — do not transcribe it:
- docKind: what kind of document it appears to be, in a few words ("clinic visit summary", "team travel itinerary", "interview confirmation email", "funeral program", "event ticket"). Type only. NEVER include names, dates, diagnoses, providers, or any other content from the document.
- docAuthenticity 0-100: how genuine and relevant it appears. Signs it is real: consistent formatting, plausible letterhead or email headers, matches the explanation. Signs against: it doesn't match the stated reason, looks edited or screenshot-of-a-screenshot, generic template text, obviously unrelated.
- A document that does not support the stated reason should LOWER the legitimacy of the report, and you should raise the doc_mismatch flag.

Decide:
- verdict: "excused" or "unexcused" under THIS professor's policy. If the policy is silent on the situation, use the categories the professor marked as excused and ordinary academic norms.
- legitimacy 0-100: your confidence the report is true and the absence is what it claims. This is for the professor; the student never sees the number.
- summary: one neutral line for the professor's table, under 140 characters, e.g. "Away game at Georgia Tech; travel itinerary attached". No judgment words.
- reason: 1-2 sentences addressed to the student, explaining the verdict under the policy. Warm, plain, not preachy. If unexcused, say what would have changed it (earlier notice, documentation, a clearer explanation) and that they can appeal to the professor.
- flags: zero or more of "vague", "contradicts_policy", "late_notice", "doc_mismatch", "doc_looks_edited", "repeat_pattern", "no_doc_required_doc" (they attached a document the policy didn't require — neutral, informational).

Reply with ONLY a JSON object, no markdown fences, no commentary:
{"verdict":"excused"|"unexcused","legitimacy":0-100,"summary":"...","reason":"...","docKind":"..."|null,"docAuthenticity":0-100|null,"flags":[...]}`;

function buildUserText(input: AbsenceAiInput): string {
  const p = input.policy;
  const lines = [
    `COURSE: ${input.courseName}`,
    ``,
    `PROFESSOR'S ATTENDANCE POLICY:`,
    p.text,
    ``,
    `Policy settings:`,
    `- Categories the professor treats as excusable: ${
      p.excusedCategories.length
        ? p.excusedCategories.map(categoryLabel).join("; ")
        : "none marked"
    }`,
    `- Expected notice for planned absences: ${p.advanceNoticeHours} hours`,
    `- Categories that require documentation: ${
      p.docsRequiredFor.length ? p.docsRequiredFor.map(categoryLabel).join("; ") : "none"
    }`,
    `- Unexcused absences allowed before it matters: ${p.freeUnexcused}`,
    ``,
    `STUDENT'S REPORT:`,
    `- Class date: ${input.absenceDate}${input.meetingLabel ? ` (${input.meetingLabel})` : ""}`,
    `- Category: ${categoryLabel(input.category)}`,
    `- Explanation: ${input.explanation}`,
    `- Notice given: ${
      input.advanceHours === null
        ? "unknown (course has no schedule)"
        : input.advanceHours >= 0
          ? `${input.advanceHours} hours before class`
          : `${Math.abs(input.advanceHours)} hours AFTER class began`
    }`,
    `- Absences already reported this term: ${input.priorExcused} excused, ${input.priorUnexcused} unexcused`,
    `- Checked into another ClassAct class on this date: ${input.attendedElsewhere ? "YES" : "no"}`,
    `- Document attached: ${input.document ? "yes (see attachment)" : "no"}`,
  ];
  return lines.join("\n");
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function docPart(doc: { mimeType: string; base64: string }): ContentPart {
  if (doc.mimeType === "application/pdf") {
    return {
      type: "file",
      file: {
        filename: "documentation.pdf",
        file_data: `data:application/pdf;base64,${doc.base64}`,
      },
    };
  }
  return {
    type: "image_url",
    image_url: { url: `data:${doc.mimeType};base64,${doc.base64}` },
  };
}

export async function assessAbsence(
  input: AbsenceAiInput,
  creds: { apiKey: string; model: string }
): Promise<AbsenceAiResult> {
  const content: ContentPart[] = [{ type: "text", text: buildUserText(input) }];
  if (input.document) content.push(docPart(input.document));

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.siteUrl,
        "X-Title": "ClassAct",
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        temperature: 0.2,
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the assessment service — check your connection and try again.",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[absenceai] OpenRouter ${response.status}: ${detail.slice(0, 500)}`);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "The assessment service rejected the API key." };
    }
    if (response.status === 400 || response.status === 404) {
      return {
        ok: false,
        error: input.document
          ? `The model "${creds.model}" didn't accept the request — it may not support attachments. Try again without the document.`
          : `The model "${creds.model}" didn't accept the request. Try again in a moment.`,
      };
    }
    return { ok: false, error: `Assessment service error (${response.status}) — try again in a moment.` };
  }

  let text = "";
  let rawPayload = "";
  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawPayload = JSON.stringify(payload);
    text = payload.choices?.[0]?.message?.content ?? "";
  } catch {
    console.error("[absenceai] response body was not JSON.");
    return { ok: false, error: "The assessment service returned an unreadable response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error(`[absenceai] model reply wasn't JSON. Payload: ${rawPayload.slice(0, 500)}`);
    return { ok: false, error: "The assessment didn't come back in a usable form — try again." };
  }

  const assessment = validateAssessment(parsed, input.document !== null);
  if (!assessment) {
    console.error(`[absenceai] model JSON failed validation. Reply: ${text.slice(0, 500)}`);
    return { ok: false, error: "The assessment didn't come back in a usable form — try again." };
  }
  return { ok: true, assessment };
}
