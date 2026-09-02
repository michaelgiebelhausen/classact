import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LECTURE_EXERCISE_EVENT,
  LECTURE_LIVE_EVENT,
  LECTURE_POLL_EVENT,
  lectureLiveTopic,
  type LectureExerciseState,
  type LectureLiveState,
  type LecturePollState,
} from "@/lib/lecturesync";
import type { PollStage } from "@/types/db";

/**
 * Push a poll round's current state — and, from the pair stage on, every
 * student's partners — to the lecture's followers. Read back with the admin
 * client after the action's write so triggers and defaults are reflected.
 * See LECTURE_POLL_EVENT for why this replaced two postgres_changes feeds
 * and a per-student partner query.
 */
export async function broadcastPollState(roundId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: round } = await admin
    .from("poll_rounds")
    .select("id, lecture_id, prompt, options, stage, results, correct_indices")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) return false;

  const state: LecturePollState = {
    round: {
      id: round.id,
      prompt: round.prompt,
      options: round.options,
      stage: round.stage as PollStage,
      results: round.results,
      correct_indices: round.correct_indices,
    },
  };
  if (round.stage === "pair" || round.stage === "revote") {
    const { data: pairs } = await admin
      .from("poll_pairs")
      .select("member_ids")
      .eq("round_id", roundId);
    const partners: Record<string, string[]> = {};
    for (const p of pairs ?? []) {
      const ids = (p.member_ids as string[]) ?? [];
      for (const id of ids) partners[id] = ids.filter((other) => other !== id);
    }
    state.partners = partners;
  }

  const channel = admin.channel(lectureLiveTopic(round.lecture_id));
  try {
    await channel.httpSend(LECTURE_POLL_EVENT, state, { timeout: 4000 });
    return true;
  } catch (err) {
    console.warn(
      "[poll-broadcast]",
      JSON.stringify({
        roundId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}

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
/**
 * Tell the course's live lecture (if any) whether a group exercise is open.
 * Exercises are course-scoped, so the lecture is looked up; with no lecture
 * live there is nobody on the topic and nothing is sent.
 */
export async function broadcastExerciseState(courseId: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data: lecture }, { data: open }] = await Promise.all([
    admin
      .from("lectures")
      .select("id")
      .eq("course_id", courseId)
      .is("ended_at", null)
      .maybeSingle(),
    admin
      .from("exercise_rounds")
      .select("prompt")
      .eq("course_id", courseId)
      .eq("stage", "open")
      .maybeSingle(),
  ]);
  if (!lecture) return true;
  const state: LectureExerciseState = { prompt: open?.prompt ?? null };
  const channel = admin.channel(lectureLiveTopic(lecture.id));
  try {
    await channel.httpSend(LECTURE_EXERCISE_EVENT, state, { timeout: 4000 });
    return true;
  } catch (err) {
    console.warn(
      "[exercise-broadcast]",
      JSON.stringify({
        courseId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}

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
