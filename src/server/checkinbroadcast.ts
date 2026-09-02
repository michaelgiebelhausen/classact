import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCourseDirectory } from "@/lib/coursedirectory";
import type { CheckInRow } from "@/lib/checkinpoll";
import {
  CHECKINS_LIVE_EVENT,
  checkInsLiveTopic,
  type CheckInChange,
} from "@/lib/checkinsync";

const ROW_COLUMNS =
  "id, enrollment_id, seat_id, verified, denied_count, professor_confirmed_at";

/**
 * The session's current check-in rows for these students, read with the
 * admin client after the caller's write (and any row trigger) has landed.
 * Callers have already authorized the mutation this describes.
 */
export async function readCheckInRows(
  sessionId: string,
  enrollmentIds: string[]
): Promise<CheckInRow[]> {
  if (enrollmentIds.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("check_ins")
    .select(ROW_COLUMNS)
    .eq("session_id", sessionId)
    .in("enrollment_id", enrollmentIds);
  return data ?? [];
}

/**
 * Tell every open seat map what just changed. One HTTP POST from the server;
 * Realtime fans it out without touching Postgres (see checkInsLiveTopic).
 *
 * Reads the affected students' rows back first, so what goes out is the row
 * as it stands after triggers — never the pre-trigger values the action
 * wrote. Fire after the write, never instead of it: the table is the truth
 * every map re-reads on subscribe, wake and its safety interval, so a lost
 * message costs seconds of staleness, not correctness. Failures are logged
 * and swallowed; the professor's or student's action already succeeded.
 */
export async function broadcastCheckInChange(
  sessionId: string,
  change: { enrollmentIds?: string[]; deletedIds?: string[] }
): Promise<boolean> {
  const admin = createAdminClient();
  const upsert = await readCheckInRows(sessionId, change.enrollmentIds ?? []);
  const payload: CheckInChange = {
    upsert,
    delete: change.deletedIds ?? [],
  };
  if (payload.upsert.length === 0 && payload.delete.length === 0) return true;

  // Names and faces ride along so no tab needs a page render to learn a
  // newcomer. The directory is cached per course (60 s, in-flight deduped),
  // so this is one cheap read; a miss must never block the broadcast.
  if (upsert.length > 0) {
    try {
      const { data: session } = await admin
        .from("class_sessions")
        .select("course_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (session) {
        const directory = await getCourseDirectory(admin, session.course_id);
        const entries: NonNullable<CheckInChange["entries"]> = {};
        for (const row of upsert) {
          const e = directory[row.enrollment_id];
          if (e) {
            entries[row.enrollment_id] = {
              name: e.name,
              firstName: e.firstName,
              photoUrl: e.photoUrl,
            };
          }
        }
        payload.entries = entries;
      }
    } catch {
      // Broadcast without names; the map's safety re-read still catches up.
    }
  }

  const channel = admin.channel(checkInsLiveTopic(sessionId));
  try {
    await channel.httpSend(CHECKINS_LIVE_EVENT, payload, { timeout: 4000 });
    return true;
  } catch (err) {
    console.warn(
      "[checkin-broadcast]",
      JSON.stringify({
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}
