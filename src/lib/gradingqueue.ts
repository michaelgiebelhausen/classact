/**
 * Grading runs on its own now — a server tick starts it at the deadline and
 * keeps scoring late work as it arrives — so two questions need answers the
 * professor's click used to paper over:
 *
 *  - Which unscored submissions should the next chunk try? A file the AI
 *    can't read (the 17 MB screenshot that froze NB02 at 48 of 49) used to be
 *    retried forever, and because the scoring phase only ends when nothing is
 *    pending, one bad file held the whole class. Failures now back off and,
 *    after the last attempt, are set aside for the professor to grade by hand.
 *
 *  - Where does a late arrival go in a list the professor already ordered?
 *    It takes the position its score earns among the rows already placed, so
 *    it lands where the AI would have put it without undoing any drag.
 */

export const MAX_SCORE_ATTEMPTS = 4;

/** Per-submission record of failed scoring attempts (analysis.failures). */
export interface ScoreFailure {
  attempts: number;
  /** The latest reason, in words the professor can act on. */
  error: string;
  lastAt: string;
}

/** 2, 4, 6 minutes: long enough to ride out a provider hiccup or rate limit. */
export function retryDelayMs(attempts: number): number {
  return attempts * 2 * 60_000;
}

export function recordFailure(
  prev: ScoreFailure | undefined,
  error: string,
  now: Date
): ScoreFailure {
  return {
    attempts: (prev?.attempts ?? 0) + 1,
    error,
    lastAt: now.toISOString(),
  };
}

export function isGivenUp(failure: ScoreFailure | undefined): boolean {
  return (failure?.attempts ?? 0) >= MAX_SCORE_ATTEMPTS;
}

export interface UnscoredQueue {
  /** Try these now. */
  ready: string[];
  /** Failed recently; retried once their backoff passes. */
  waiting: string[];
  /** Out of attempts — the professor grades these by hand. */
  givenUp: string[];
}

export function classifyUnscored(input: {
  submissionIds: string[];
  scoredIds: Set<string>;
  failures: Record<string, ScoreFailure>;
  now: Date;
}): UnscoredQueue {
  const queue: UnscoredQueue = { ready: [], waiting: [], givenUp: [] };
  for (const id of input.submissionIds) {
    if (input.scoredIds.has(id)) continue;
    const failure = input.failures[id];
    if (!failure) {
      queue.ready.push(id);
    } else if (isGivenUp(failure)) {
      queue.givenUp.push(id);
    } else if (
      input.now.getTime() - new Date(failure.lastAt).getTime() >=
      retryDelayMs(failure.attempts)
    ) {
      queue.ready.push(id);
    } else {
      queue.waiting.push(id);
    }
  }
  return queue;
}

interface Placeable {
  submission_id: string;
  bt_score: number;
  final_rank: number | null;
}

/**
 * The professor's order with any newly scored rows slotted in, best first.
 * Null when nothing is materialized yet — the model's draft still owns the
 * list, and the rank column already places every row.
 */
export function slotIntoOrder<T extends Placeable>(rows: T[]): T[] | null {
  const placed = rows
    .filter((r) => r.final_rank !== null)
    .sort((a, b) => (a.final_rank as number) - (b.final_rank as number));
  if (placed.length === 0) return null;
  const newcomers = rows
    .filter((r) => r.final_rank === null)
    .sort((a, b) => Number(b.bt_score) - Number(a.bt_score));
  const order = [...placed];
  for (const row of newcomers) {
    const above = order.filter((r) => Number(r.bt_score) > Number(row.bt_score)).length;
    order.splice(above, 0, row);
  }
  return order;
}
