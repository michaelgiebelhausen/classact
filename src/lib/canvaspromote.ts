/**
 * Confirming a student against Canvas after the fact.
 *
 * Students turn up to the first class and join with the course code before the
 * professor has imported anything. If they used their official address, a
 * later Canvas sync finds them — but the sync only recorded the match and
 * moved on, so the row kept the `invited` status /auth/join gave it. The
 * student was on the Canvas roster, had an account, was sitting in the room,
 * and still read as an off-roster joiner on every later sync.
 *
 * Being listed by Canvas AND having claimed the row is exactly what "confirmed
 * from Canvas" means, so the sync should say so.
 */
export interface MatchedRowFacts {
  status: string;
  profileId: string | null;
}

export function shouldConfirmFromCanvas(row: MatchedRowFacts): boolean {
  // `dropped` is deliberately excluded: returning students go through the
  // reactivation path, which also clears `dropped_at`. Flipping the status
  // here would bypass that and leave a live student marked as having left.
  return row.status === "invited" && Boolean(row.profileId);
}
