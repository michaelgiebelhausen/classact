/**
 * A student's standing on one assignment, at a glance.
 *
 * The assignments list used to show only the assignment's lifecycle state
 * ("Open for submissions", "Peer grading"), which says nothing about whether
 * *this* student has handed anything in. Students scanning the list could
 * not tell submitted from not-yet-submitted from missed, and had to open
 * each one to find out. This classifies the three cases so the list can
 * color them: green (turned in), yellow (still due), red (past due, nothing
 * in).
 *
 * A late submission is still a submission — it counts as `submitted`, with
 * `late: true` so the row can say so. Red is reserved for the case that
 * needs action: the deadline passed and nothing was turned in.
 */

export type SubmissionStatusKind = "submitted" | "due" | "missing";

export interface SubmissionStatus {
  kind: SubmissionStatusKind;
  /** Only meaningful when kind === "submitted": handed in after the deadline. */
  late: boolean;
  /** ISO timestamp of the submission, when there is one. */
  submittedAt: string | null;
}

export function submissionStatus(input: {
  deadline: string;
  submittedAt: string | null | undefined;
  now: Date;
}): SubmissionStatus {
  const deadline = new Date(input.deadline);
  if (input.submittedAt) {
    const submitted = new Date(input.submittedAt);
    return {
      kind: "submitted",
      late: submitted.getTime() > deadline.getTime(),
      submittedAt: input.submittedAt,
    };
  }
  return {
    kind: deadline.getTime() < input.now.getTime() ? "missing" : "due",
    late: false,
    submittedAt: null,
  };
}

/** Tailwind classes for the row border, keyed by status. */
export const STATUS_ROW_CLASS: Record<SubmissionStatusKind, string> = {
  submitted: "border-green-500/60 border-l-4 border-l-green-600 bg-green-50/40 dark:bg-green-950/20",
  due: "border-amber-500/60 border-l-4 border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20",
  missing: "border-red-500/60 border-l-4 border-l-red-600 bg-red-50/40 dark:bg-red-950/20",
};
