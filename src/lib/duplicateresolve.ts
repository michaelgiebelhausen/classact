/**
 * Removing the shadow row when a student appears on a roster twice.
 *
 * Every duplicate resolved by hand had the same shape: the student signed in
 * with their university Google account, which created a second auth user and a
 * second enrolment; later they got into their real Clemson account and did all
 * their actual work there. The shadow carried a few icebreaker answers and
 * nothing else.
 *
 * "Nothing else" is the part that has to be checked rather than assumed. Twenty-
 * two tables cascade-delete off `enrollments`, so the one duplicate that *did*
 * hold check-ins would lose them silently — and that is the row where the
 * student did their attending.
 */

export interface DuplicateFacts {
  /** Another row for the same student survives in this course. */
  hasTwin: boolean;
  /** Check-ins recorded against the row being removed. */
  shadowCheckIns: number;
}

export type DuplicateVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

export function canResolveDuplicate(
  facts: DuplicateFacts
): DuplicateVerdict {
  // Checked first: without a surviving twin this isn't a duplicate at all,
  // it's the student's only enrolment, and "resolving" it would remove them
  // from the class.
  if (!facts.hasTwin) {
    return {
      allowed: false,
      reason:
        "There's no other row for this student in this course, so this is their only enrolment — removing it would take them out of the class.",
    };
  }
  if (facts.shadowCheckIns > 0) {
    return {
      allowed: false,
      reason: `This row holds ${facts.shadowCheckIns} check-in${
        facts.shadowCheckIns === 1 ? "" : "s"
      }. Removing it would delete that attendance, so this one needs doing by hand.`,
    };
  }
  return { allowed: true };
}
