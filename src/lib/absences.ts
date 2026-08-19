/**
 * Self-reported absences: the pure parts. Category catalog, the professor's
 * attendance policy (stored as loose jsonb, parsed here with defaults so a
 * professor who never opens the tab still gets sane verdicts), the labels the
 * UI shows, and the validator that turns the model's JSON into something we
 * trust enough to store.
 */
import type { AbsenceCategory, AbsenceVerdict } from "@/types/db";

export interface AbsenceCategoryInfo {
  key: AbsenceCategory;
  label: string;
  /** One line of guidance under the radio in the student form. */
  hint: string;
}

export const ABSENCE_CATEGORIES: AbsenceCategoryInfo[] = [
  {
    key: "athletics",
    label: "Athletics travel or competition",
    hint: "Team travel, a game, a meet — usually with a schedule from the program.",
  },
  {
    key: "interview",
    label: "Job or grad-school interview",
    hint: "On-site or virtual. A confirmation email makes this easy to excuse.",
  },
  {
    key: "university_event",
    label: "University-sponsored trip or event",
    hint: "Conference, case competition, field trip, required program event.",
  },
  {
    key: "religious",
    label: "Religious observance",
    hint: "A holy day or observance that conflicts with class.",
  },
  {
    key: "family",
    label: "Family event or obligation",
    hint: "A wedding, a graduation, a family commitment planned in advance.",
  },
  {
    key: "illness",
    label: "Illness",
    hint: "Not well enough to come. Say what's going on in a sentence.",
  },
  {
    key: "bereavement",
    label: "Bereavement",
    hint: "A death in the family. We're sorry — the system will be gentle here.",
  },
  {
    key: "other",
    label: "Something else",
    hint: "Anything not covered above. Be specific — vague reasons score poorly.",
  },
];

export const ABSENCE_CATEGORY_KEYS = ABSENCE_CATEGORIES.map((c) => c.key);

export function categoryLabel(key: string): string {
  return ABSENCE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function isAbsenceCategory(value: unknown): value is AbsenceCategory {
  return (
    typeof value === "string" &&
    (ABSENCE_CATEGORY_KEYS as string[]).includes(value)
  );
}

/* ---------------- Policy ---------------- */

export interface AttendancePolicy {
  /** What the syllabus says, in the professor's words. Shown to the AI. */
  text: string;
  /** Categories the professor treats as excusable. */
  excusedCategories: AbsenceCategory[];
  /** Expected notice for planned absences. */
  advanceNoticeHours: number;
  /** Categories that need documentation to be excused. */
  docsRequiredFor: AbsenceCategory[];
  /** Unexcused absences allowed before it affects anything. */
  freeUnexcused: number;
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  text:
    "Excused absences are university-sponsored travel and events, athletics " +
    "competition and travel, job or graduate-school interviews, religious " +
    "observances, documented illness, and family emergencies or bereavement. " +
    "Planned absences should be reported at least 48 hours in advance. " +
    "Illness reported before class begins is generally excused; repeated " +
    "illness may require documentation.",
  excusedCategories: [
    "athletics",
    "interview",
    "university_event",
    "religious",
    "illness",
    "bereavement",
    "family",
  ],
  advanceNoticeHours: 48,
  docsRequiredFor: [],
  freeUnexcused: 2,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function categoryList(value: unknown): AbsenceCategory[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isAbsenceCategory);
}

/** Lenient parse of courses.attendance_policy; anything missing → default. */
export function parseAttendancePolicy(raw: unknown): AttendancePolicy {
  const d = DEFAULT_ATTENDANCE_POLICY;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const text =
    typeof r.text === "string" && r.text.trim() ? r.text.trim().slice(0, 4000) : d.text;
  return {
    text,
    excusedCategories: categoryList(r.excusedCategories) ?? d.excusedCategories,
    advanceNoticeHours: clampInt(r.advanceNoticeHours, 0, 24 * 30, d.advanceNoticeHours),
    docsRequiredFor: categoryList(r.docsRequiredFor) ?? d.docsRequiredFor,
    freeUnexcused: clampInt(r.freeUnexcused, 0, 30, d.freeUnexcused),
  };
}

/* ---------------- Notice ---------------- */

/** "3 days ahead", "2 h ahead", "40 min after class began", "no schedule". */
export function noticeLabel(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "no schedule to measure";
  const abs = Math.abs(hours);
  let span: string;
  if (abs < 1) span = `${Math.max(1, Math.round(abs * 60))} min`;
  else if (abs < 48) span = `${Math.round(abs)} h`;
  else span = `${Math.round(abs / 24)} days`;
  if (hours >= 0) return `${span} ahead`;
  return `${span} after class began`;
}

/** Hours between submission and the meeting start; negative = after. */
export function advanceHours(submittedAt: Date, meetingStart: Date | null): number | null {
  if (!meetingStart) return null;
  const h = (meetingStart.getTime() - submittedAt.getTime()) / 3_600_000;
  return Math.round(h * 10) / 10;
}

/* ---------------- Verdicts ---------------- */

export const AI_FLAGS = [
  "vague",
  "contradicts_policy",
  "late_notice",
  "doc_mismatch",
  "doc_looks_edited",
  "repeat_pattern",
  "no_doc_required_doc",
] as const;
export type AiFlag = (typeof AI_FLAGS)[number];

export interface AbsenceAssessment {
  verdict: AbsenceVerdict;
  legitimacy: number;
  summary: string;
  reason: string;
  docKind: string | null;
  docAuthenticity: number | null;
  flags: AiFlag[];
}

export function isVerdict(value: unknown): value is AbsenceVerdict {
  return value === "excused" || value === "unexcused";
}

/**
 * Turn whatever the model returned into an assessment we're willing to
 * store, or null if it's unusable. Scores are clamped; strings trimmed and
 * capped; unknown flags dropped. `hadDoc` lets us refuse a doc score when
 * no document was sent (the model shouldn't invent one).
 */
export function validateAssessment(
  raw: unknown,
  hadDoc: boolean
): AbsenceAssessment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isVerdict(r.verdict)) return null;
  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, 140) : "";
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 400) : "";
  if (!summary || !reason) return null;
  const flags = Array.isArray(r.flags)
    ? (r.flags.filter((f): f is AiFlag =>
        (AI_FLAGS as readonly string[]).includes(String(f))
      ) as AiFlag[])
    : [];
  const docKind =
    hadDoc && typeof r.docKind === "string" && r.docKind.trim()
      ? r.docKind.trim().slice(0, 80)
      : null;
  return {
    verdict: r.verdict,
    legitimacy: clampInt(r.legitimacy, 0, 100, 50),
    summary,
    reason,
    docKind,
    docAuthenticity: hadDoc ? clampInt(r.docAuthenticity, 0, 100, 50) : null,
    flags: Array.from(new Set(flags)),
  };
}

/** The verdict that counts: the professor's if they ruled, else the AI's. */
export function finalVerdict(row: {
  ai_verdict: AbsenceVerdict;
  professor_verdict: AbsenceVerdict | null;
}): AbsenceVerdict {
  return row.professor_verdict ?? row.ai_verdict;
}

/**
 * Policy facts that don't need a model. Returns an override verdict with a
 * student-facing reason, or null to let the AI decide.
 */
export function policyOverride(
  policy: AttendancePolicy,
  input: { category: AbsenceCategory; hasDocumentation: boolean }
): { verdict: AbsenceVerdict; reason: string; summary: string } | null {
  if (policy.docsRequiredFor.includes(input.category) && !input.hasDocumentation) {
    return {
      verdict: "unexcused",
      summary: `${categoryLabel(input.category)} — no documentation attached`,
      reason:
        `Your professor's policy requires documentation for ${categoryLabel(
          input.category
        ).toLowerCase()}. This is recorded as unexcused for now — you can ` +
        `appeal once you have something to attach.`,
    };
  }
  return null;
}

export const MAX_DOC_BASE64_CHARS = 8_000_000; // ≈ 6 MB, same cap as room photos
export const ALLOWED_DOC_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
