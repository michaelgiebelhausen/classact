/**
 * Approving a student who joined with the course code.
 *
 * `/auth/join` creates a **pending** row for anyone who isn't on the imported
 * roster — profile linked, `status = 'invited'` — for the professor to
 * approve. Nothing ever surfaced that approval, and `checkIn` requires
 * `status = 'active'`, so these students signed up, joined, walked into class
 * and were told they weren't on the roster.
 *
 * That is the trap's second-order damage: students locked out of their
 * university address signed up with a personal one instead, and the workaround
 * left them half-enrolled and confident.
 */
export interface JoinerFacts {
  status: string;
  /** Someone's account owns this row — i.e. a real person joined. */
  hasProfile: boolean;
}

export function canApproveJoiner(facts: JoinerFacts): boolean {
  // Never activate an unclaimed row. A Canvas import with nobody behind it
  // would become an enrolled student who does not exist, counted present in
  // every roster total and absent from every class.
  if (!facts.hasProfile) return false;
  // Reactivating a dropped student is its own path, which also clears
  // `dropped_at`; flipping status here would leave that stale.
  return facts.status === "invited";
}
