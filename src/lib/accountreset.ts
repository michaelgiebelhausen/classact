/**
 * Clearing a stuck account so the student can register again from scratch.
 *
 * The gentler remedy is a set-password link, and away from a classroom it is
 * the right one. In the room it is the wrong one: it is an email round trip,
 * and a student standing at the front refreshing their inbox while forty
 * people wait is the friction this is meant to remove.
 *
 * With email confirmation off, re-registering is instant — password plus join
 * code and they are in the seat map, with nothing waiting on a mail provider.
 * So the fastest fix a professor can apply is to get the dead account out of
 * the way.
 *
 * What survives, checked against the schema rather than assumed:
 * - the enrollment row (`profile_id` is ON DELETE SET NULL, not CASCADE)
 * - every check-in, so **attendance is not lost**
 * - `roster_photo_path`, so a Canvas photo still shows on the seat map
 *
 * What does not: the auth user, the profile row, and any photos the student
 * uploaded themselves.
 */

export interface AccountResetFacts {
  hasAccount: boolean;
  everSignedIn: boolean;
}

export type AccountResetVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Only ever an account nobody has successfully used.
 *
 * `everSignedIn` is checked first and independently of `hasAccount`: the two
 * come from different lookups and a disagreement must fail closed. Deleting a
 * working login is the one outcome there is no undo for.
 */
export function canResetAccount(
  facts: AccountResetFacts
): AccountResetVerdict {
  if (facts.everSignedIn) {
    return {
      allowed: false,
      reason:
        "This student has signed in before, so their account works. They're not enrolled in this class yet — send them the join code instead.",
    };
  }
  if (!facts.hasAccount) {
    return {
      allowed: false,
      reason:
        "There's no account for that address to reset. They can sign up with the join code right now.",
    };
  }
  return { allowed: true };
}
