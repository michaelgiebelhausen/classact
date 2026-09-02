/**
 * Same-browser sync between the presenter window and the projector stage
 * window (BroadcastChannel). Cross-device sync rides Supabase Realtime; this
 * channel just makes same-machine clicks feel instant.
 */

import type { PollResults, PollStage } from "@/types/db";

/** Everything the projector needs to render the current poll state. */
export interface PollBroadcast {
  roundId: string;
  prompt: string;
  options: string[];
  stage: PollStage;
  results: PollResults | null;
  correctIndices: number[] | null;
}

export type LectureSyncMessage =
  | { type: "page"; page: number }
  | { type: "poll"; poll: PollBroadcast | null }
  | { type: "pause"; paused: boolean }
  /** The projector closed the poll itself (Esc); tell the presenter to catch up. */
  | { type: "poll-closed"; roundId: string }
  | { type: "ended" };

export function lectureChannelName(lectureId: string): string {
  return `classact-lecture-${lectureId}`;
}

/**
 * The Supabase Realtime BROADCAST topic every follower of a lecture joins
 * (students, the projector), and the one the professor's server actions
 * publish slide/pause/end state to.
 *
 * Broadcast, not postgres_changes, on purpose: a postgres_changes UPDATE is
 * fanned out by re-running the table's RLS policy once per subscriber, inside
 * the database, per change — three hundred policy evaluations for one slide
 * advance, on the same database the check-in room is hammering. A broadcast
 * never touches Postgres. The lectures row stays the source of truth: every
 * (re)subscribe and every wake re-reads it, and a slow safety re-read covers
 * a message that was never delivered.
 */
export function lectureLiveTopic(lectureId: string): string {
  return `lecture-live:${lectureId}`;
}

/** The slice of a lectures row that followers need, as broadcast. */
export interface LectureLiveState {
  current_page: number;
  ended_at: string | null;
  pauses: Array<{ start: string; end: string | null }> | null;
}

/** The broadcast event name carrying a {@link LectureLiveState}. */
export const LECTURE_LIVE_EVENT = "state";

/** Route of the chrome-free projector view for a course. */
export function stagePath(courseId: string): string {
  return `/course/${courseId}/follow/stage`;
}
