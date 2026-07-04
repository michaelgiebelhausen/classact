"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_TASK_TITLE } from "@/lib/projects";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Team board actions. Any team member can distribute cards (tap-to-assign),
 * mark them done (logging actual minutes — the number contribution scoring
 * prefers over the estimate), and manage the team's own task cards. The
 * course professor has the same powers on every board.
 *
 * Contract cards are protected: they complete by signing the contract
 * (see teams.ts), never by hand.
 */

const MAX_MINUTES = 6000;

/**
 * Resolve the caller's access to a team's board: the course professor, or a
 * member of the team. Returns the caller's enrollment id (null for the
 * professor — assigned_by stays null when the professor distributes).
 */
async function requireTeamAccess(courseId: string, teamId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      error: "Sign in first." as string | null,
      enrollmentId: null as string | null,
    };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (course && course.professor_id === user.id) {
    return { supabase, error: null, enrollmentId: null };
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return {
      supabase,
      error: "You're not on this course's active roster." as string | null,
      enrollmentId: null,
    };
  }
  const { data: membership } = await supabase
    .from("project_team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("enrollment_id", enrollment.id)
    .maybeSingle();
  if (!membership) {
    return {
      supabase,
      error: "Only the team (or the professor) can work this board." as
        | string
        | null,
      enrollmentId: null,
    };
  }
  return { supabase, error: null, enrollmentId: enrollment.id };
}

/** Fetch a board card and confirm it belongs to this course. */
async function getCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  taskId: string
) {
  const { data: task } = await supabase
    .from("team_tasks")
    .select(
      "id, team_id, title, status, assigned_enrollment_id, estimated_minutes"
    )
    .eq("id", taskId)
    .eq("course_id", courseId)
    .single();
  return task;
}

/**
 * Move a card to a member's column (enrollmentId) or back to Unassigned
 * (null). Records who distributed it — a leadership signal for metrics.
 */
export async function assignTask(
  courseId: string,
  taskId: string,
  assigneeEnrollmentId: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const task = await getCard(supabase, courseId, taskId);
  if (!task) return { ok: false, error: "Task not found." };

  const { error, enrollmentId } = await requireTeamAccess(
    courseId,
    task.team_id
  );
  if (error) return { ok: false, error };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards stay with their owner." };
  }
  if (task.status === "done") {
    return { ok: false, error: "Reopen the task before moving it." };
  }

  const { error: updateError } = await supabase
    .from("team_tasks")
    .update({
      status: assigneeEnrollmentId ? "assigned" : "unassigned",
      assigned_enrollment_id: assigneeEnrollmentId,
      assigned_by_enrollment_id: assigneeEnrollmentId ? enrollmentId : null,
    })
    .eq("id", taskId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't move the task." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/**
 * Mark an assigned card done, logging the actual minutes it took. Credit
 * goes to the assignee, so unassigned cards must be assigned first.
 */
export async function completeTask(
  courseId: string,
  taskId: string,
  actualMinutes: number
): Promise<ActionResult> {
  const supabase = await createClient();
  const task = await getCard(supabase, courseId, taskId);
  if (!task) return { ok: false, error: "Task not found." };

  const { error } = await requireTeamAccess(courseId, task.team_id);
  if (error) return { ok: false, error };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards complete when you sign." };
  }
  if (!task.assigned_enrollment_id) {
    return {
      ok: false,
      error: "Assign the task first — done work needs a name on it.",
    };
  }
  if (
    !Number.isInteger(actualMinutes) ||
    actualMinutes < 1 ||
    actualMinutes > MAX_MINUTES
  ) {
    return { ok: false, error: "Log the actual minutes (1–6000)." };
  }

  const { error: updateError } = await supabase
    .from("team_tasks")
    .update({
      status: "done",
      actual_minutes: actualMinutes,
      done_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't complete the task." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/** Send a done card back to its assignee's column. */
export async function reopenTask(
  courseId: string,
  taskId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const task = await getCard(supabase, courseId, taskId);
  if (!task) return { ok: false, error: "Task not found." };

  const { error } = await requireTeamAccess(courseId, task.team_id);
  if (error) return { ok: false, error };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards reopen when the contract changes." };
  }
  if (task.status !== "done") {
    return { ok: false, error: "That task isn't done." };
  }

  const { error: updateError } = await supabase
    .from("team_tasks")
    .update({
      status: task.assigned_enrollment_id ? "assigned" : "unassigned",
      actual_minutes: null,
      done_at: null,
    })
    .eq("id", taskId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't reopen the task." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/** Add a card to the team's board (teams own their boards). */
export async function createTeamTask(input: {
  courseId: string;
  teamId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
}): Promise<ActionResult> {
  const { supabase, error } = await requireTeamAccess(
    input.courseId,
    input.teamId
  );
  if (error) return { ok: false, error };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the task a title." };
  if (title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "That name is reserved for contract cards." };
  }
  if (
    !Number.isInteger(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > MAX_MINUTES
  ) {
    return { ok: false, error: "Estimated minutes must be between 1 and 6000." };
  }

  const { data: team } = await supabase
    .from("project_teams")
    .select("id, project_id, course_id")
    .eq("id", input.teamId)
    .eq("course_id", input.courseId)
    .single();
  if (!team) return { ok: false, error: "Team not found." };

  const { data: last } = await supabase
    .from("team_tasks")
    .select("position")
    .eq("team_id", input.teamId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: insertError } = await supabase.from("team_tasks").insert({
    team_id: team.id,
    project_id: team.project_id,
    course_id: team.course_id,
    title,
    description: input.description.trim().slice(0, 2000) || null,
    estimated_minutes: input.estimatedMinutes,
    status: "unassigned",
    position: (last?.position ?? 0) + 1,
    source: "team",
  });
  if (insertError) return { ok: false, error: "Couldn't add the task." };
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true };
}

/** Edit a card's title, description, or estimate (not done, not contract). */
export async function updateTeamTask(input: {
  courseId: string;
  taskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const task = await getCard(supabase, input.courseId, input.taskId);
  if (!task) return { ok: false, error: "Task not found." };

  const { error } = await requireTeamAccess(input.courseId, task.team_id);
  if (error) return { ok: false, error };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards can't be edited." };
  }
  if (task.status === "done") {
    return { ok: false, error: "Reopen the task before editing it." };
  }

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the task a title." };
  if (
    !Number.isInteger(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > MAX_MINUTES
  ) {
    return { ok: false, error: "Estimated minutes must be between 1 and 6000." };
  }

  const { error: updateError } = await supabase
    .from("team_tasks")
    .update({
      title,
      description: input.description.trim().slice(0, 2000) || null,
      estimated_minutes: input.estimatedMinutes,
    })
    .eq("id", input.taskId)
    .eq("course_id", input.courseId);
  if (updateError) return { ok: false, error: "Couldn't save the changes." };
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true };
}

/** Delete a card (not done — reopen first so credit removal is deliberate). */
export async function deleteTeamTask(
  courseId: string,
  taskId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const task = await getCard(supabase, courseId, taskId);
  if (!task) return { ok: false, error: "Task not found." };

  const { error } = await requireTeamAccess(courseId, task.team_id);
  if (error) return { ok: false, error };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards can't be deleted." };
  }
  if (task.status === "done") {
    return { ok: false, error: "Reopen the task before deleting it." };
  }

  const { error: deleteError } = await supabase
    .from("team_tasks")
    .delete()
    .eq("id", taskId)
    .eq("course_id", courseId);
  if (deleteError) return { ok: false, error: "Couldn't delete the task." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}
