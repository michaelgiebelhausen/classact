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
  | { type: "ended" };

export function lectureChannelName(lectureId: string): string {
  return `classact-lecture-${lectureId}`;
}

/** Route of the chrome-free projector view for a course. */
export function stagePath(courseId: string): string {
  return `/course/${courseId}/follow/stage`;
}
