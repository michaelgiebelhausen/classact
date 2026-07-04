/**
 * Same-browser sync between the presenter window and the projector stage
 * window (BroadcastChannel). Cross-device sync rides Supabase Realtime; this
 * channel just makes same-machine clicks feel instant.
 */

export type LectureSyncMessage =
  | { type: "page"; page: number }
  | { type: "ended" };

export function lectureChannelName(lectureId: string): string {
  return `classact-lecture-${lectureId}`;
}

/** Route of the chrome-free projector view for a course. */
export function stagePath(courseId: string): string {
  return `/course/${courseId}/follow/stage`;
}
