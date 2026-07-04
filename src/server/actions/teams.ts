"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Student-side team actions for Projects. Teams are per-project and
 * self-organized: anyone can create one or join one (the database enforces
 * one team per student per project). Forming a team copies the professor's
 * task template onto the team's own board, and every member gets a
 * "review & sign the team contract" card.
 */

const CONTRACT_TASK_TITLE = "Review & sign the team contract";
const CONTRACT_TASK_MINUTES = 10;

/** Resolve the caller's active enrollment in a course, or fail. */
async function requireEnrollment(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { supabase, error: "Sign in first." as string, enrollmentId: null };
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
      error: "You're not on this course's active roster." as string,
      enrollmentId: null,
    };
  }
  return { supabase, error: null, enrollmentId: enrollment.id };
}

/** Every member gets their own contract card on the team board. */
async function addContractCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  team: { id: string; project_id: string; course_id: string },
  enrollmentId: string
) {
  await supabase.from("team_tasks").insert({
    team_id: team.id,
    project_id: team.project_id,
    course_id: team.course_id,
    title: CONTRACT_TASK_TITLE,
    description:
      "Read the team contract, suggest edits if something's off, then sign it.",
    estimated_minutes: CONTRACT_TASK_MINUTES,
    status: "assigned",
    assigned_enrollment_id: enrollmentId,
    position: 0,
    source: "team",
  });
}

/**
 * Student: create a team on an open project. The creator becomes the lead,
 * the project's task template is copied onto the team's board, and the
 * team's contract starts as the project default.
 */
export async function createTeam(
  courseId: string,
  projectId: string,
  name: string
): Promise<ActionResult<{ teamId: string }>> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const teamName = name.trim().slice(0, 80);
  if (teamName.length < 2) return { ok: false, error: "Give the team a name." };

  // Students can only read open projects (RLS), so this doubles as the gate.
  const { data: project } = await supabase
    .from("projects")
    .select("id, contract_text")
    .eq("id", projectId)
    .eq("course_id", courseId)
    .single();
  if (!project) return { ok: false, error: "Project not found." };

  const { data: team, error: teamError } = await supabase
    .from("project_teams")
    .insert({
      project_id: projectId,
      course_id: courseId,
      name: teamName,
      contract_text: project.contract_text,
    })
    .select("id, project_id, course_id")
    .single();
  if (teamError || !team) {
    return { ok: false, error: "Couldn't create the team. Try again." };
  }

  const { error: memberError } = await supabase
    .from("project_team_members")
    .insert({
      team_id: team.id,
      project_id: projectId,
      enrollment_id: enrollmentId,
      role: "lead",
    });
  if (memberError) {
    // Most likely: already on a team for this project (DB unique constraint).
    await supabase.from("project_teams").delete().eq("id", team.id);
    return {
      ok: false,
      error: "You're already on a team for this project — leave it first.",
    };
  }

  // Copy the professor's template onto the team's own board.
  const { data: template } = await supabase
    .from("project_tasks")
    .select("id, title, description, estimated_minutes, position, source")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (template && template.length > 0) {
    await supabase.from("team_tasks").insert(
      template.map((t) => ({
        team_id: team.id,
        project_id: projectId,
        course_id: courseId,
        source_task_id: t.id,
        title: t.title,
        description: t.description,
        estimated_minutes: t.estimated_minutes,
        status: "unassigned" as const,
        position: t.position,
        source: t.source,
      }))
    );
  }
  await addContractCard(supabase, team, enrollmentId);

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true, data: { teamId: team.id } };
}

/** Student: join an existing team (one team per project, DB-enforced). */
export async function joinTeam(
  courseId: string,
  teamId: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const { data: team } = await supabase
    .from("project_teams")
    .select("id, project_id, course_id")
    .eq("id", teamId)
    .eq("course_id", courseId)
    .single();
  if (!team) return { ok: false, error: "Team not found." };

  const { error: memberError } = await supabase
    .from("project_team_members")
    .insert({
      team_id: team.id,
      project_id: team.project_id,
      enrollment_id: enrollmentId,
      role: "member",
    });
  if (memberError) {
    return {
      ok: false,
      error: "You're already on a team for this project — leave it first.",
    };
  }
  await addContractCard(supabase, team, enrollmentId);

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/**
 * Student: leave a team. Your unfinished cards go back to Unassigned (done
 * work stays credited to you); your unsigned contract card is removed.
 */
export async function leaveTeam(
  courseId: string,
  teamId: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  // While still a member (RLS), tidy the board...
  await supabase
    .from("team_tasks")
    .delete()
    .eq("team_id", teamId)
    .eq("assigned_enrollment_id", enrollmentId)
    .eq("title", CONTRACT_TASK_TITLE)
    .neq("status", "done");
  await supabase
    .from("team_tasks")
    .update({ status: "unassigned", assigned_enrollment_id: null })
    .eq("team_id", teamId)
    .eq("assigned_enrollment_id", enrollmentId)
    .neq("status", "done");

  // ...then step off the roster.
  const { error: deleteError } = await supabase
    .from("project_team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("enrollment_id", enrollmentId);
  if (deleteError) return { ok: false, error: "Couldn't leave the team." };

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/** Student: sign the team contract — also completes your contract card. */
export async function signContract(
  courseId: string,
  teamId: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const { error: signError } = await supabase
    .from("team_contract_signatures")
    .insert({ team_id: teamId, enrollment_id: enrollmentId });
  if (signError) {
    return { ok: false, error: "You've already signed this contract." };
  }

  await supabase
    .from("team_tasks")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      actual_minutes: CONTRACT_TASK_MINUTES,
    })
    .eq("team_id", teamId)
    .eq("assigned_enrollment_id", enrollmentId)
    .eq("title", CONTRACT_TASK_TITLE)
    .neq("status", "done");

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/**
 * Team member: edit the team's own copy of the contract. Existing signatures
 * are cleared — everyone re-signs what actually got agreed to.
 */
export async function updateTeamContract(
  courseId: string,
  teamId: string,
  contractText: string
): Promise<ActionResult> {
  const { supabase, error, enrollmentId } = await requireEnrollment(courseId);
  if (error || !enrollmentId)
    return { ok: false, error: error ?? "No enrollment." };

  const text = contractText.trim().slice(0, 20_000);
  if (!text) return { ok: false, error: "The contract can't be empty." };

  const { error: updateError } = await supabase
    .from("project_teams")
    .update({ contract_text: text })
    .eq("id", teamId)
    .eq("course_id", courseId);
  if (updateError) {
    return { ok: false, error: "Couldn't save the contract." };
  }

  // A changed contract needs fresh signatures; give members their card back.
  await supabase
    .from("team_contract_signatures")
    .delete()
    .eq("team_id", teamId);
  await supabase
    .from("team_tasks")
    .update({ status: "assigned", done_at: null, actual_minutes: null })
    .eq("team_id", teamId)
    .eq("title", CONTRACT_TASK_TITLE);

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}
