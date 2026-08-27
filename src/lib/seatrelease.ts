/**
 * A professor freeing a seat someone shouldn't be in.
 *
 * Deliberately not a reassignment. Moving a student to another seat means
 * deciding what happens to whoever is already there, which needs a swap, which
 * needs atomicity against a non-deferrable unique constraint. Releasing needs
 * none of that: the seat empties, and the student checks themselves back in
 * wherever they actually are.
 *
 * Worth being clear about the cost, because it is real: releasing deletes the
 * check-in, so the student has no attendance for the session until they check
 * in again. For "they aren't here" that is the correct outcome. For "wrong
 * seat" it resolves the moment they re-check-in.
 */

export interface ReleaseFacts {
  sessionOpen: boolean;
  occupied: boolean;
}

export type ReleaseVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

export function canReleaseSeat(facts: ReleaseFacts): ReleaseVerdict {
  // Checked first: after class, attendance is a record rather than a live
  // seating chart, and quietly deleting one is not a seat correction.
  if (!facts.sessionOpen) {
    return {
      allowed: false,
      reason: "Class has ended — attendance for it is a record now.",
    };
  }
  if (!facts.occupied) {
    return { allowed: false, reason: "Nobody's in that seat." };
  }
  return { allowed: true };
}
