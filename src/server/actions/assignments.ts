"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { resolveSettings } from "@/lib/tastegrading";
import { generateDefaultTaste, type TasteDraft } from "@/server/tastyai";
import type { ActionResult } from "@/server/actions/auth";
import type { TasteCriterion } from "@/types/db";

/**
 * Tasty Grading — assignment lifecycle actions (professor create, student
 * taste file + submission). One deadline locks both the PDF and the taste
 * file; edit timestamps feed the timeliness statistic (last edit wins).
 * Spec: docs/tasty-grading-plan.md.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";
const MAX_CRITERIA = 15;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function myEnrollment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  profileId: string
) {
  const { data } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Professor: publish an assignment. Title + deadline are the only required
 * inputs (zero-extra-effort principle); the AI drafts the default taste
 * file from the brief PDF (already uploaded by the browser) right here.
 */
export async function createAssignment(input: {
  courseId: string;
  title: string;
  storagePath: string | null;
  /** ISO datetime. */
  deadline: string;
  /** ISO datetime; defaults to deadline + peerWindowDays. */
  peerCloseAt?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the assignment a title." };
  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() < Date.now()) {
    return { ok: false, error: "Pick a deadline in the future." };
  }
  if (input.storagePath && !input.storagePath.startsWith(`${input.courseId}/brief/`)) {
    return { ok: false, error: "Upload didn't complete — try again." };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id, grading_defaults")
    .eq("id", input.courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can create assignments." };
  }

  const settings = resolveSettings(course.grading_defaults, null);
  let peerClose = input.peerCloseAt ? new Date(input.peerCloseAt) : null;
  if (!peerClose || Number.isNaN(peerClose.getTime()) || peerClose <= deadline) {
    peerClose = new Date(
      deadline.getTime() + settings.peerWindowDays * 24 * 60 * 60 * 1000
    );
  }

  // Draft the default taste file from the brief (best-effort: an assignment
  // without AI still works — students just start from a blank taste file).
  let defaultTaste: TasteDraft | null = null;
  let briefBase64: string | null = null;
  if (input.storagePath && isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: blob } = await admin.storage
      .from(ASSIGNMENT_BUCKET)
      .download(input.storagePath);
    if (blob) {
      briefBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    }
  }
  const draft = await generateDefaultTaste({
    assignmentTitle: title,
    briefPdfBase64: briefBase64,
  });
  if (draft.ok) defaultTaste = draft.data;

  const { data: created, error } = await supabase
    .from("assignments")
    .insert({
      course_id: input.courseId,
      title,
      storage_path: input.storagePath,
      deadline: deadline.toISOString(),
      peer_close_at: peerClose.toISOString(),
      settings: defaultTaste ? { defaultTaste } : {},
    })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, error: "Couldn't create the assignment. Try again." };
  }
  revalidatePath(`/course/${input.courseId}/assignments`);
  return { ok: true, data: { id: created.id } };
}

function cleanCriteria(raw: TasteCriterion[]): TasteCriterion[] {
  return raw
    .map((c) => ({
      name: String(c.name ?? "").trim().slice(0, 80),
      standard: String(c.standard ?? "").trim().slice(0, 500),
    }))
    .filter((c) => c.name && c.standard)
    .slice(0, MAX_CRITERIA);
}

/**
 * Student: save the taste file (creates it on first save). Locked at the
 * deadline; is_default_untouched flips once the content differs from the
 * AI default.
 */
export async function saveTasteFile(
  assignmentId: string,
  criteria: TasteCriterion[],
  barStatement: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, course_id, deadline, settings")
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { ok: false, error: "Assignment not found." };
  if (new Date(assignment.deadline).getTime() < Date.now()) {
    return { ok: false, error: "The deadline has passed — your taste file is locked." };
  }
  const enrollmentId = await myEnrollment(supabase, assignment.course_id, user.id);
  if (!enrollmentId) return { ok: false, error: "You're not on this course's roster." };

  const cleaned = cleanCriteria(criteria);
  if (cleaned.length === 0) {
    return { ok: false, error: "Keep at least one criterion — it's your standard." };
  }
  const bar = barStatement.trim().slice(0, 300);

  const defaultTaste =
    (assignment.settings as { defaultTaste?: TasteDraft }).defaultTaste ?? null;
  const untouched =
    defaultTaste !== null &&
    JSON.stringify({ c: cleaned, b: bar }) ===
      JSON.stringify({ c: defaultTaste.criteria, b: defaultTaste.barStatement });

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("taste_files")
    .select("id, first_edit_at")
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("taste_files")
      .update({
        criteria: cleaned,
        bar_statement: bar,
        is_default_untouched: untouched,
        first_edit_at: existing.first_edit_at ?? now,
        last_edit_at: now,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Couldn't save — try again." };
  } else {
    const { error } = await supabase.from("taste_files").insert({
      assignment_id: assignmentId,
      course_id: assignment.course_id,
      enrollment_id: enrollmentId,
      criteria: cleaned,
      bar_statement: bar,
      is_default_untouched: untouched,
      first_edit_at: now,
      last_edit_at: now,
    });
    if (error) return { ok: false, error: "Couldn't save — try again." };
  }
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/**
 * Student: record the submitted PDF (browser already uploaded it to the
 * student's own folder — storage RLS enforces that). Re-submitting before
 * the deadline replaces the file; last_edit_at drives the timeliness stat.
 */
export async function submitWork(
  assignmentId: string,
  storagePath: string,
  note: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, course_id, deadline")
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { ok: false, error: "Assignment not found." };
  if (new Date(assignment.deadline).getTime() < Date.now()) {
    return { ok: false, error: "The deadline has passed." };
  }
  const enrollmentId = await myEnrollment(supabase, assignment.course_id, user.id);
  if (!enrollmentId) return { ok: false, error: "You're not on this course's roster." };
  if (!storagePath.startsWith(`${assignment.course_id}/sub/${enrollmentId}/`)) {
    return { ok: false, error: "Upload didn't complete — try again." };
  }

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("submissions")
      .update({
        storage_path: storagePath,
        note: note.trim().slice(0, 2000),
        last_edit_at: now,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Couldn't submit — try again." };
  } else {
    const { error } = await supabase.from("submissions").insert({
      assignment_id: assignmentId,
      course_id: assignment.course_id,
      enrollment_id: enrollmentId,
      storage_path: storagePath,
      note: note.trim().slice(0, 2000),
      submitted_at: now,
      last_edit_at: now,
    });
    if (error) return { ok: false, error: "Couldn't submit — try again." };
  }
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/** Professor: adjust assignment settings (pair mix, weights, cut points…). */
export async function updateAssignmentSettings(
  assignmentId: string,
  patch: Record<string, unknown>
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, course_id, settings, courses!inner(professor_id)")
    .eq("id", assignmentId)
    .single();
  if (
    !assignment ||
    (assignment.courses as unknown as { professor_id: string }).professor_id !== user.id
  ) {
    return { ok: false, error: "Only the course owner can change settings." };
  }
  const merged = { ...(assignment.settings as Record<string, unknown>), ...patch };
  const { error } = await supabase
    .from("assignments")
    .update({ settings: merged })
    .eq("id", assignmentId);
  if (error) return { ok: false, error: "Couldn't save settings." };
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/** Student: accumulate time spent reviewing the consensus rubric. */
export async function rubricPing(
  assignmentId: string,
  seconds: number
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const add = Math.min(120, Math.max(0, Math.round(seconds)));
  if (add === 0) return { ok: true };
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, course_id")
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { ok: false, error: "Assignment not found." };
  const enrollmentId = await myEnrollment(supabase, assignment.course_id, user.id);
  if (!enrollmentId) return { ok: false, error: "Not enrolled." };
  const { data: existing } = await supabase
    .from("rubric_views")
    .select("id, seconds")
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("rubric_views")
      .update({ seconds: existing.seconds + add })
      .eq("id", existing.id);
  } else {
    await supabase.from("rubric_views").insert({
      assignment_id: assignmentId,
      course_id: assignment.course_id,
      enrollment_id: enrollmentId,
      seconds: add,
    });
  }
  return { ok: true };
}
