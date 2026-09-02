import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LECTURE_LIVE_EVENT,
  lectureLiveTopic,
  type LectureLiveState,
} from "@/lib/lecturesync";

/**
 * Push the lecture's live state to every follower over Realtime broadcast —
 * one HTTP POST from the server, delivered by Realtime to every subscriber
 * without touching Postgres. See lectureLiveTopic for why this replaced
 * postgres_changes on the lectures table.
 *
 * Fire after the row is written, never instead of it: the row is the truth
 * followers re-read on subscribe, on wake, and on their safety interval, so
 * a lost broadcast costs seconds of staleness, not correctness. Failures are
 * logged and swallowed — the professor's action already succeeded, and
 * surfacing "couldn't notify students" as an error would make them retry a
 * write that doesn't need retrying.
 */
export async function broadcastLectureState(
  lectureId: string,
  state: LectureLiveState
): Promise<boolean> {
  const admin = createAdminClient();
  const channel = admin.channel(lectureLiveTopic(lectureId));
  try {
    await channel.httpSend(LECTURE_LIVE_EVENT, state, { timeout: 4000 });
    return true;
  } catch (err) {
    console.warn(
      "[lecture-broadcast]",
      JSON.stringify({
        lectureId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}
