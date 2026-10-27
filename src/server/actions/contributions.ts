"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/server/actions/auth";

/** Uses the caller's session, never the service role. SQL rechecks every scope. */
export async function contributionCommand(
  courseId: string, projectId: string, teamId: string,
  action: string, data: Record<string, unknown>
): Promise<ActionResult> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!["propose", "confirm", "checkpoint", "reopen", "save"].includes(action)) {
    return { ok: false, error: "Unknown contribution action." };
  }
  const { data: team } = await db.from("project_teams").select("id")
    .eq("id", teamId).eq("course_id", courseId).eq("project_id", projectId).maybeSingle();
  if (!team) return { ok: false, error: "Team not found in this project." };
  const { error } = await db.rpc("contribution_command", { p_team: teamId, p_action: action, p_data: data });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "Couldn't save. Refresh and try again." };
  revalidatePath(`/course/${courseId}/projects`);
  revalidatePath(`/course/${courseId}/projects/${projectId}`);
  return { ok: true };
}
