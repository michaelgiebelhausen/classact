"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_BUCKET } from "@/lib/storage";
import { DEFAULT_TEAM_CONTRACT } from "@/lib/projects";
import { generateProjectTasks } from "@/server/projectgen";
import type { ActionResult } from "@/server/actions/auth";

/** Anthropic-class models cap PDF requests around 32MB — leave headroom. */
const MAX_AI_PDF_BYTES = 28 * 1024 * 1024;
const MAX_MINUTES = 6000;

/** Resolve the caller's professor-ship of a course, or fail. */
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

/** "" -> null; otherwise must be a plausible YYYY-MM-DD date. */
function parseDueDate(input: string | undefined): string | null | "invalid" {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    return "invalid";
  }
  return raw;
}

function validateTaskFields(input: {
  title: string;
  estimatedMinutes: number;
}): string | null {
  if (!input.title.trim()) return "Give the task a title.";
  if (input.title.trim().length > 200) return "That title is too long.";
  if (
    !Number.isInteger(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > MAX_MINUTES
  ) {
    return "Estimated minutes must be between 1 and 6000.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * Professor: register a project. The browser has already uploaded the
 * assignment PDF to `{courseId}/{uuid}.pdf` in the project-docs bucket
 * (storage RLS limits that to the course professor); this records the row,
 * seeded with the default team contract.
 */
export async function createProject(input: {
  courseId: string;
  title: string;
  storagePath: string;
  pageCount?: number;
  dueDate?: string;
  targetTeamSize?: number;
}): Promise<ActionResult<{ projectId: string }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the project a title." };
  if (!input.storagePath.startsWith(`${input.courseId}/`)) {
    return { ok: false, error: "Upload didn't complete — try again." };
  }
  const dueDate = parseDueDate(input.dueDate);
  if (dueDate === "invalid") {
    return { ok: false, error: "That due date doesn't look right." };
  }
  const teamSize = input.targetTeamSize ?? null;
  if (
    teamSize !== null &&
    (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 20)
  ) {
    return { ok: false, error: "Team size should be between 1 and 20." };
  }

  const { data: created, error: insertError } = await supabase
    .from("projects")
    .insert({
      course_id: input.courseId,
      title,
      storage_path: input.storagePath,
      page_count: input.pageCount ?? null,
      due_date: dueDate,
      target_team_size: teamSize,
      contract_text: DEFAULT_TEAM_CONTRACT,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    return { ok: false, error: "Couldn't save the project. Try again." };
  }
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true, data: { projectId: created.id } };
}

/** Professor: edit title, due date, team-size guidance, or the contract. */
export async function updateProject(input: {
  courseId: string;
  projectId: string;
  title: string;
  dueDate?: string;
  targetTeamSize?: number | null;
  contractText: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the project a title." };
  const dueDate = parseDueDate(input.dueDate);
  if (dueDate === "invalid") {
    return { ok: false, error: "That due date doesn't look right." };
  }
  const teamSize = input.targetTeamSize ?? null;
  if (
    teamSize !== null &&
    (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 20)
  ) {
    return { ok: false, error: "Team size should be between 1 and 20." };
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      title,
      due_date: dueDate,
      target_team_size: teamSize,
      contract_text: input.contractText.slice(0, 20_000),
    })
    .eq("id", input.projectId)
    .eq("course_id", input.courseId);
  if (updateError) return { ok: false, error: "Couldn't save the changes." };
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true };
}

/** Professor: open a project to students (or pull it back to draft). */
export async function setProjectOpen(
  courseId: string,
  projectId: string,
  open: boolean
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: open ? "open" : "draft" })
    .eq("id", projectId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't update the project." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/** Professor: delete a project (and its stored PDF). */
export async function deleteProject(
  courseId: string,
  projectId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: project } = await supabase
    .from("projects")
    .select("id, storage_path")
    .eq("id", projectId)
    .eq("course_id", courseId)
    .single();
  if (!project) return { ok: false, error: "Project not found." };

  if (project.storage_path) {
    await supabase.storage.from(PROJECT_BUCKET).remove([project.storage_path]);
  }
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);
  if (deleteError) return { ok: false, error: "Couldn't delete the project." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Task template (the AI-parsed starting list teams copy)
// ---------------------------------------------------------------------------

/**
 * Professor: have AI break the assignment PDF into the task template. Adds to
 * whatever is already there (so a re-run after deleting misfires is additive);
 * the professor edits or deletes tasks from the list.
 */
export async function generateTasksFromPdf(
  courseId: string,
  projectId: string
): Promise<ActionResult<{ count: number }>> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, storage_path, page_count")
    .eq("id", projectId)
    .eq("course_id", courseId)
    .single();
  if (!project) return { ok: false, error: "Project not found." };
  if (!project.storage_path) {
    return { ok: false, error: "This project has no PDF to read." };
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(PROJECT_BUCKET)
    .download(project.storage_path);
  if (downloadError || !file) {
    return { ok: false, error: "Couldn't read the project PDF." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_AI_PDF_BYTES) {
    return {
      ok: false,
      error:
        "The PDF is too large for AI generation (28MB max) — compress it.",
    };
  }

  const result = await generateProjectTasks({
    projectTitle: project.title,
    pageCount: project.page_count,
    pdfBase64: buffer.toString("base64"),
  });
  if (!result.ok) return { ok: false, error: result.error };

  // New tasks slot in after any existing ones.
  const { data: last } = await supabase
    .from("project_tasks")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = (last?.position ?? 0) + 1;

  const rows = result.tasks.map((t, i) => ({
    project_id: projectId,
    course_id: courseId,
    title: t.title,
    description: t.description || null,
    estimated_minutes: t.estimatedMinutes,
    position: base + i,
    source: "ai" as const,
  }));
  const { error: insertError } = await supabase
    .from("project_tasks")
    .insert(rows);
  if (insertError) {
    return { ok: false, error: "Couldn't save the generated tasks." };
  }
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true, data: { count: rows.length } };
}

/** Professor: add a task to the template by hand. */
export async function createProjectTask(input: {
  courseId: string;
  projectId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
}): Promise<ActionResult<{ taskId: string }>> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };
  const invalid = validateTaskFields(input);
  if (invalid) return { ok: false, error: invalid };

  const { data: last } = await supabase
    .from("project_tasks")
    .select("position")
    .eq("project_id", input.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error: insertError } = await supabase
    .from("project_tasks")
    .insert({
      project_id: input.projectId,
      course_id: input.courseId,
      title: input.title.trim(),
      description: input.description.trim().slice(0, 2000) || null,
      estimated_minutes: input.estimatedMinutes,
      position: (last?.position ?? 0) + 1,
      source: "professor",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    return { ok: false, error: "Couldn't save the task." };
  }
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true, data: { taskId: created.id } };
}

/** Professor: edit a template task — most often its time estimate. */
export async function updateProjectTask(input: {
  courseId: string;
  taskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
}): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(input.courseId);
  if (error) return { ok: false, error };
  const invalid = validateTaskFields(input);
  if (invalid) return { ok: false, error: invalid };

  const { error: updateError } = await supabase
    .from("project_tasks")
    .update({
      title: input.title.trim(),
      description: input.description.trim().slice(0, 2000) || null,
      estimated_minutes: input.estimatedMinutes,
    })
    .eq("id", input.taskId)
    .eq("course_id", input.courseId);
  if (updateError) return { ok: false, error: "Couldn't save the changes." };
  revalidatePath(`/course/${input.courseId}/projects`);
  return { ok: true };
}

/** Professor: delete a template task. */
export async function deleteProjectTask(
  courseId: string,
  taskId: string
): Promise<ActionResult> {
  const { supabase, error } = await requireProfessor(courseId);
  if (error) return { ok: false, error };
  const { error: deleteError } = await supabase
    .from("project_tasks")
    .delete()
    .eq("id", taskId)
    .eq("course_id", courseId);
  if (deleteError) return { ok: false, error: "Couldn't delete the task." };
  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}
