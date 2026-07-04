/**
 * Pure helpers for Follow Along focus tracking. A student's focus_events form
 * an away/back sequence; these fold that stream into per-student summaries.
 */

export interface FocusEventInput {
  enrollment_id: string;
  event_type: "away" | "back";
  occurred_at: string; // ISO timestamp
}

export interface FocusSummary {
  /** Completed + ongoing away spells. */
  awayCount: number;
  /** Total ms spent away (ongoing spell counted up to `now`). */
  awayMs: number;
  /** Currently away (last event was 'away'). */
  isAway: boolean;
}

/**
 * Fold one student's events (any order) into a summary. Duplicate 'away' or
 * 'back' events (e.g. blur + visibilitychange both firing) collapse into one.
 */
export function summarizeFocus(
  events: FocusEventInput[],
  now: Date = new Date()
): FocusSummary {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
  );
  let awayCount = 0;
  let awayMs = 0;
  let awaySince: number | null = null;

  for (const e of sorted) {
    const t = Date.parse(e.occurred_at);
    if (e.event_type === "away") {
      if (awaySince === null) {
        awaySince = t;
        awayCount += 1;
      }
    } else if (awaySince !== null) {
      awayMs += Math.max(0, t - awaySince);
      awaySince = null;
    }
  }
  if (awaySince !== null) {
    awayMs += Math.max(0, now.getTime() - awaySince);
  }
  return { awayCount, awayMs, isAway: awaySince !== null };
}

/** Group a lecture's events by enrollment and summarize each student. */
export function summarizeFocusByEnrollment(
  events: FocusEventInput[],
  now: Date = new Date()
): Map<string, FocusSummary> {
  const byEnrollment = new Map<string, FocusEventInput[]>();
  for (const e of events) {
    const list = byEnrollment.get(e.enrollment_id) ?? [];
    list.push(e);
    byEnrollment.set(e.enrollment_id, list);
  }
  const result = new Map<string, FocusSummary>();
  for (const [id, list] of byEnrollment) {
    result.set(id, summarizeFocus(list, now));
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
