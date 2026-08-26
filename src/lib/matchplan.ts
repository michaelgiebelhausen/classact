/**
 * Which row survives when a student's own account is matched to their Canvas
 * roster row.
 *
 * The instinct is to keep the Canvas row — it has the real name and the ID
 * photo — and that is right only when the student has no attendance of their
 * own. All six matches made by hand were the other way round: the student had
 * checked in under the personal-email row, and keeping the tidier Canvas row
 * would have destroyed six students' attendance, because twenty-two tables
 * cascade-delete off `enrollments`.
 *
 * So the rule is: **the row holding the history survives**, and the Canvas
 * identity — address, name, photo, phonetic spelling — moves onto it. The
 * Canvas row wins ties only because it is the one carrying a face.
 */

export interface MatchFacts {
  personalCheckIns: number;
  canvasCheckIns: number;
  /** Some account already owns the Canvas row. */
  canvasHasProfile: boolean;
}

export type MatchPlan =
  | { allowed: true; keep: "canvas" | "personal" }
  | { allowed: false; reason: string };

export function planCanvasMatch(facts: MatchFacts): MatchPlan {
  if (facts.canvasHasProfile) {
    return {
      allowed: false,
      reason:
        "That Canvas row already belongs to an account. Two real logins can't be merged automatically — work out which one the student uses first.",
    };
  }
  if (facts.personalCheckIns > 0 && facts.canvasCheckIns > 0) {
    // Both have attendance: merging means discarding one row's record, or
    // colliding on the unique (session_id, enrollment_id). Neither is a
    // decision to make silently on someone's attendance.
    return {
      allowed: false,
      reason:
        "Both rows have check-ins, so one set would have to be discarded. This one needs doing by hand.",
    };
  }
  return { allowed: true, keep: facts.personalCheckIns > 0 ? "personal" : "canvas" };
}
