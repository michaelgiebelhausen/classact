"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assignGroups, type GroupingParticipant } from "@/lib/participate";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Small-group exercises (one-minute papers). The professor poses a prompt and
 * the system assigns students to seat-based groups from the latest class
 * session's check-ins — who they're sitting around — then each group prepares
 * one shared written response. A second Participate activity type alongside
 * think-pair-share; groups are ephemeral and assigned, not chosen.
 */

const MAX_PROMPT_CHARS = 2000;
const MAX_RESPONSE_CHARS = 5000;
const DEFAULT_GROUP_SIZE = 4;

async function requireProfessor(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Sign in first." as string, user: null };
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return {
      supabase,
      error: "Only the course owner can do that." as string,
      user: null,
    };
  }
  return { supabase, error: null, user };
}

/**
 * Professor: launch a one-minute paper. Reads the latest class session's
 * check-ins for seat positions, clusters students into groups of ~targetSize,
 * and opens the round. Any previously open exercise is closed first.
 */
export async function startExercise(input: {
  courseId: string;
  prompt: string;
  targetSize?: number;
}): Promise<ActionResult<{ roundId: string; groupCount: number }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };

  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (prompt.length < 3) {
    return { ok: false, error: "Give the exercise a prompt." };
  }
  const targetSize = Math.min(
    8,
    Math.max(2, Math.round(input.targetSize ?? DEFAULT_GROUP_SIZE))
  );

  // Latest class session, and who checked in (with their seats).
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("course_id", input.courseId)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    return {
      ok: false,
      error:
        "Open a class session and have students check in first — groups come from who's in the room.",
    };
  }

  const { data: checkIns } = await supabase
    .from("check_ins")
    .select("enrollment_id, seats(row_index, col_index)")
    .eq("session_id", session.id);
  const participants: GroupingParticipant[] = (checkIns ?? []).map((c) => {
    const seat = c.seats as unknown as {
      row_index: number;
      col_index: number;
    } | null;
    return {
      enrollmentId: c.enrollment_id,
      seat: seat ? { row: seat.row_index, col: seat.col_index } : undefined,
    };
  });
  if (participants.length < 2) {
    return {
      ok: false,
      error: "Need at least two checked-in students to make groups.",
    };
  }

  // Close any exercise still open (the partial unique index allows only one).
  await supabase
    .from("exercise_rounds")
    .update({ stage: "closed", closed_at: new Date().toISOString() })
    .eq("course_id", input.courseId)
    .eq("stage", "open");

  const { data: round, error: roundError } = await supabase
    .from("exercise_rounds")
    .insert({
      course_id: input.courseId,
      session_id: session.id,
      prompt,
    })
    .select("id")
    .single();
  if (roundError || !round) {
    return { ok: false, error: "Couldn't start the exercise. Try again." };
  }

  const grouped = assignGroups(participants, targetSize);
  for (let i = 0; i < grouped.length; i++) {
    const { data: group, error: groupError } = await supabase
      .from("exercise_groups")
      .insert({
        round_id: round.id,
        course_id: input.courseId,
        label: `Group ${i + 1}`,
      })
      .select("id")
      .single();
    if (groupError || !group) continue;

    await supabase.from("exercise_group_members").insert(
      grouped[i].map((enrollmentId) => ({
        group_id: group.id,
        course_id: input.courseId,
        enrollment_id: enrollmentId,
      }))
    );
    await supabase.from("exercise_responses").insert({
      group_id: group.id,
      round_id: round.id,
      course_id: input.courseId,
      content: "",
    });
  }

  revalidatePath(`/course/${input.courseId}/participate`);
  return { ok: true, data: { roundId: round.id, groupCount: grouped.length } };
}

/** Student: save the group's shared response (any member can scribe). */
export async function saveExerciseResponse(
  courseId: string,
  groupId: string,
  content: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "You're not on this course's active roster." };
  }

  // RLS already limits writes to the caller's own group; confirm the round is
  // still open so a closed exercise can't be edited.
  const { data: group } = await supabase
    .from("exercise_groups")
    .select("id, round_id, exercise_rounds(stage)")
    .eq("id", groupId)
    .eq("course_id", courseId)
    .single();
  if (!group) return { ok: false, error: "Group not found." };
  const stage = (group.exercise_rounds as unknown as { stage: string } | null)
    ?.stage;
  if (stage !== "open") {
    return { ok: false, error: "This exercise is closed." };
  }

  const { error: updateError } = await supabase
    .from("exercise_responses")
    .update({
      content: content.slice(0, MAX_RESPONSE_CHARS),
      updated_by_enrollment_id: enrollment.id,
      updated_at: new Date().toISOString(),
    })
    .eq("group_id", groupId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't save. Try again." };

  return { ok: true };
}

/** Professor: close the exercise (responses freeze, groups stay for the record). */
export async function closeExercise(
  courseId: string,
  roundId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: updateError } = await supabase
    .from("exercise_rounds")
    .update({ stage: "closed", closed_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't close the exercise." };
  revalidatePath(`/course/${courseId}/participate`);
  return { ok: true };
}
