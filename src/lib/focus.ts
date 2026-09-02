/**
 * Pure helpers for Follow Along focus tracking. A student's focus_events form
 * an away/back sequence; these fold that stream into per-student summaries.
 */

export interface FocusEventInput {
  enrollment_id: string;
  event_type: "away" | "back";
  occurred_at: string; // ISO timestamp
}

/**
 * Client heartbeat cadence while following a live lecture. 60 s: two beats
 * can still go missing inside PRESENCE_DISCONNECT_MS, and halving the rate
 * halves the sustained auth + upsert load of a 300-seat room.
 */
export const PRESENCE_HEARTBEAT_MS = 60_000;
/**
 * A tab-away shorter than this is a glance, not drift: it is neither sent
 * to the server nor tallied, so a room that flinches at a notification
 * doesn't produce 300 away/back pairs in the same second.
 */
export const FOCUS_GRACE_MS = 3_000;
/**
 * No heartbeat for this long = the machine went silent (sleep, shutdown,
 * network drop) — treat the student as disconnected, not away. Generous
 * because hidden-tab timers throttle to ~1/min, worse on battery saver.
 */
export const PRESENCE_DISCONNECT_MS = 150_000;

export interface FocusSummary {
  /** Completed + ongoing away spells (spells fully inside a pause don't count). */
  awayCount: number;
  /** Total ms spent away (ongoing spell counted up to `now`), minus paused time. */
  awayMs: number;
  /** Currently away (last event was 'away'). */
  isAway: boolean;
}

/** A professor-declared pause window; an open pause has end null. */
export interface PauseInterval {
  start: string; // ISO timestamp
  end: string | null;
}

/** Is the lecture paused right now (last pause still open)? */
export function isLecturePaused(pauses: PauseInterval[]): boolean {
  const last = pauses[pauses.length - 1];
  return Boolean(last && last.end === null);
}

/**
 * Away ms between startMs and endMs with paused time removed. Pauses come
 * from one professor toggling one button, so intervals never overlap.
 */
export function effectiveAwayMs(
  startMs: number,
  endMs: number,
  pauses: PauseInterval[],
  nowMs: number = endMs
): number {
  let overlap = 0;
  for (const p of pauses) {
    const ps = Date.parse(p.start);
    const pe = p.end ? Date.parse(p.end) : nowMs;
    overlap += Math.max(0, Math.min(endMs, pe) - Math.max(startMs, ps));
  }
  return Math.max(0, endMs - startMs - overlap);
}

/**
 * Fold one student's events (any order) into a summary. Duplicate 'away' or
 * 'back' events (e.g. blur + visibilitychange both firing) collapse into one.
 *
 * `lastSeenAtMs` is the student's presence heartbeat (lecture_presence row).
 * When provided, an unmatched trailing 'away' only accrues while heartbeats
 * continued — a machine that went silent (sleep/shutdown) stops the clock at
 * its last beat instead of charging the rest of the lecture. Omit it for
 * pre-heartbeat lectures to keep their historical scores unchanged; `null`
 * (heartbeats exist but this student has no row) charges nothing. Matched
 * spells are untouched: a sleep-then-return gap is handled at write time by
 * backdating the 'back' event, not here.
 */
export function summarizeFocus(
  events: FocusEventInput[],
  now: Date = new Date(),
  pauses: PauseInterval[] = [],
  lastSeenAtMs?: number | null
): FocusSummary {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
  );
  const spells: Array<{ start: number; end: number }> = [];
  let awaySince: number | null = null;

  for (const e of sorted) {
    const t = Date.parse(e.occurred_at);
    if (e.event_type === "away") {
      if (awaySince === null) awaySince = t;
    } else if (awaySince !== null) {
      spells.push({ start: awaySince, end: Math.max(awaySince, t) });
      awaySince = null;
    }
  }
  const nowMs = now.getTime();
  if (awaySince !== null) {
    let end = Math.max(awaySince, nowMs);
    if (lastSeenAtMs !== undefined) {
      end = Math.min(end, Math.max(awaySince, lastSeenAtMs ?? awaySince));
    }
    spells.push({ start: awaySince, end });
  }

  let awayCount = 0;
  let awayMs = 0;
  for (const s of spells) {
    const effective = effectiveAwayMs(s.start, s.end, pauses, nowMs);
    // Only spells with effective time count as drift: a spell the pause
    // fully covers was sanctioned browsing, and a zero-length spell is a
    // sleep the truncation/backdating collapsed — the design says silence
    // scores like absence, so it must not add a drift either.
    if (effective > 0) awayCount += 1;
    awayMs += effective;
  }
  return { awayCount, awayMs, isAway: awaySince !== null };
}

/** Group a lecture's events by enrollment and summarize each student. */
export function summarizeFocusByEnrollment(
  events: FocusEventInput[],
  now: Date = new Date(),
  pauses: PauseInterval[] = [],
  lastSeenByEnrollment?: Map<string, number>
): Map<string, FocusSummary> {
  const byEnrollment = new Map<string, FocusEventInput[]>();
  for (const e of events) {
    const list = byEnrollment.get(e.enrollment_id) ?? [];
    list.push(e);
    byEnrollment.set(e.enrollment_id, list);
  }
  const result = new Map<string, FocusSummary>();
  for (const [id, list] of byEnrollment) {
    result.set(id, summarizeFocus(list, now, pauses, lastSeenByEnrollment?.get(id)));
  }
  return result;
}

/** "3m 12s" style duration for the UI. */
export function formatAwayDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
