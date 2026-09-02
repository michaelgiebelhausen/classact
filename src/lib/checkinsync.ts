import type { CheckInRow } from "@/lib/checkinpoll";

/**
 * The Realtime BROADCAST topic every open seat map for a session joins, and
 * the one the check-in server actions publish changes to.
 *
 * Broadcast, not postgres_changes, for the same reason as the lecture feed
 * (see lectureLiveTopic): a postgres_changes event is delivered by re-running
 * the check_ins RLS policy once per subscriber, inside Postgres, per change.
 * During arrival that is (students checking in) × (maps open) policy
 * evaluations — ninety thousand for a 300-seat room — on the database the
 * room is already leaning on. A broadcast never touches Postgres.
 *
 * The table stays the source of truth: every map re-reads it on (re)subscribe,
 * on wake, and on a slow safety interval, which also covers the rare writers
 * that don't go through the check-in actions.
 */
export function checkInsLiveTopic(sessionId: string): string {
  return `checkins-live:${sessionId}`;
}

/** The broadcast event name carrying a {@link CheckInChange}. */
export const CHECKINS_LIVE_EVENT = "change";

/**
 * One mutation's effect on the session's check-ins, as the server read it
 * back AFTER the row triggers ran — so a verification's `verified` flip and a
 * denial's `denied_count` arrive as the row now stands, not as the action
 * wrote it.
 */
export interface CheckInChange {
  upsert: CheckInRow[];
  /** check_ins ids that no longer exist (a freed seat, the swapped-out half). */
  delete: string[];
  /**
   * Name and face for each upserted enrollment, from the server's cached
   * course directory. A tab whose page loaded before a late activator joined
   * has no entry for them; without this it had to re-render the whole page
   * to learn one name — and every tab in the room did so at the same instant.
   */
  entries?: Record<string, CheckInDirectoryEntry>;
}

export interface CheckInDirectoryEntry {
  name: string;
  firstName: string;
  photoUrl: string | null;
}
