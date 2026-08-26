"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeInstructions,
  normalizePoints,
} from "@/lib/assignmentfields";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { resolveSettings } from "@/lib/tastegrading";
import { describeQueryFailure } from "@/lib/dberror";
import {
  docKindFromPath,
  generateDefaultTaste,
  type TasteDraft,
} from "@/server/tastyai";
import { resolveCourseAi } from "@/server/aicreds";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentRow, TasteCriterion } from "@/types/db";

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
  /** Student-facing brief. NOT gradingInstructions, which is the
   *  professor's private AI criteria for ai_only assignments. */
  instructions?: string;
  /** What the assignment is worth. Blank/absent = no value set. */
  points?: string | number | null;
  /** ISO datetime. */
  deadline: string;
  /** ISO datetime; defaults to deadline + peerWindowDays. */
  peerCloseAt?: string | null;
  /** "tasty" (default): taste files + peer round. "ai_only": AI grades
   * against the instructor's criteria; no taste files, no peer review. */
  gradingMode?: "tasty" | "ai_only";
  /** ai_only: the instructor's grading criteria (their "taste file"). */
  gradingInstructions?: string;
}): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the assignment a title." };
  const instructions = normalizeInstructions(input.instructions ?? "");
  if (!instructions.ok) return { ok: false, error: instructions.message };
  const points = normalizePoints(input.points);
  if (!points.ok) return { ok: false, error: points.message };
  // AI-only grading has no emergent rubric — the instructor's taste
  // criteria ARE the standard, so they're required (one sentence is fine).
  if (input.gradingMode === "ai_only" && !(input.gradingInstructions ?? "").trim()) {
    return {
      ok: false,
      error:
        "AI-only grading needs your grading criteria — even one sentence (e.g. 'count the questions marked correct; score proportionally').",
    };
  }
  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() < Date.now()) {
    return { ok: false, error: "Pick a deadline in the future." };
  }
  if (input.storagePath && !input.storagePath.startsWith(`${input.courseId}/brief/`)) {
    return { ok: false, error: "Upload didn't complete — try again." };
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, professor_id, grading_defaults")
    .eq("id", input.courseId)
    .single();
  const courseFailure = describeQueryFailure("createAssignment", courseError);
  if (courseFailure) return { ok: false, error: courseFailure };
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
  // BYOK: the draft runs on the course owner's key (founder falls back to
  // the system key). No key → no draft; students start from a blank taste
  // file and the professor sees a connect-your-key banner.
  const gradingMode = input.gradingMode === "ai_only" ? "ai_only" : "tasty";
  // ai_only assignments have no student taste files — skip the draft.
  if (gradingMode === "tasty") {
    const creds = await resolveCourseAi(input.courseId, "taste");
    if (creds) {
      const draft = await generateDefaultTaste(
        {
          assignmentTitle: title,
          brief:
            briefBase64 && input.storagePath
              ? { base64: briefBase64, kind: docKindFromPath(input.storagePath) }
              : null,
          // A text-only assignment used to draft from the title alone.
          instructions: instructions.value,
        },
        creds
      );
      if (draft.ok) defaultTaste = draft.data;
    }
  }

  const { data: created, error } = await supabase
    .from("assignments")
    .insert({
      course_id: input.courseId,
      title,
      storage_path: input.storagePath,
      instructions: instructions.value,
      points: points.value,
      deadline: deadline.toISOString(),
      peer_close_at: peerClose.toISOString(),
      settings: {
        ...(defaultTaste ? { defaultTaste } : {}),
        ...(gradingMode === "ai_only"
          ? {
              gradingMode,
              gradingInstructions: (input.gradingInstructions ?? "")
                .trim()
                .slice(0, 4000),
            }
          : {}),
      },
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

/**
 * Student: save the note to graders without re-uploading the file.
 *
 * The note used to travel only inside submitWork, so a student who had
 * already submitted and then thought of something to say had no way to save
 * it — the text sat in the box and vanished on the next refresh. Editing
 * the note is not a resubmission: `last_edit_at` is deliberately left alone,
 * because that field decides timeliness and a typo fix at 11:58 shouldn't
 * read as handing the work in at 11:58.
 */
export async function saveSubmissionNote(
  assignmentId: string,
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
  if (!enrollmentId) {
    return { ok: false, error: "You're not on this course's roster." };
  }

  const { data: existing } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "Upload your file first — the note goes with it." };
  }

  const { error } = await supabase
    .from("submissions")
    .update({ note: note.trim().slice(0, 2000) })
    .eq("id", existing.id);
  if (error) return { ok: false, error: "Couldn't save the note — try again." };

  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/** Professor: adjust assignment settings (pair mix, weights, cut points…). */
/**
 * Professor: edit an assignment after creating it. What's editable depends
 * on where the lifecycle stands — the title always; the deadline only while
 * submissions are open (extending it past "now" reopens an assignment whose
 * deadline lapsed before analysis ran); the peer-grading close while open or
 * during peer review (moving it into the past is the "close peer grading
 * now" lever). Nothing else moves mid-flight: a deadline change during
 * analysis or after publication would pull the rug out from under scores.
 */
export async function updateAssignment(input: {
  assignmentId: string;
  title?: string;
  instructions?: string;
  points?: string | number | null;
  /** ISO datetime. */
  deadline?: string;
  /** ISO datetime. */
  peerCloseAt?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, course_id, state, deadline, peer_close_at, courses!inner(professor_id)")
    .eq("id", input.assignmentId)
    .single();
  if (
    !assignment ||
    (assignment.courses as unknown as { professor_id: string }).professor_id !==
      user.id
  ) {
    return { ok: false, error: "Only the course owner can edit an assignment." };
  }

  const patch: Partial<
    Pick<
      AssignmentRow,
      "title" | "deadline" | "peer_close_at" | "instructions" | "points"
    >
  > = {};

  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 200);
    if (!title) return { ok: false, error: "Give the assignment a title." };
    patch.title = title;
  }

  // Neither field is state-gated. Unlike the deadline — which is baked into
  // the analysis once grading starts — a typo in the brief or the point
  // value is worth fixing at any point in the assignment's life.
  if (input.instructions !== undefined) {
    const verdict = normalizeInstructions(input.instructions);
    if (!verdict.ok) return { ok: false, error: verdict.message };
    patch.instructions = verdict.value;
  }

  if (input.points !== undefined) {
    const verdict = normalizePoints(input.points);
    if (!verdict.ok) return { ok: false, error: verdict.message };
    patch.points = verdict.value;
  }

  let deadline = new Date(assignment.deadline);
  if (input.deadline !== undefined) {
    if (assignment.state !== "open") {
      return {
        ok: false,
        error:
          "The deadline can't change once grading has started — it's baked into the analysis.",
      };
    }
    const next = new Date(input.deadline);
    if (Number.isNaN(next.getTime()) || next.getTime() < Date.now()) {
      return { ok: false, error: "Pick a deadline in the future." };
    }
    deadline = next;
    patch.deadline = next.toISOString();
  }

  if (input.peerCloseAt !== undefined) {
    if (assignment.state !== "open" && assignment.state !== "peer_review") {
      return {
        ok: false,
        error: "Peer grading has already closed — its end can't move now.",
      };
    }
    const next = new Date(input.peerCloseAt);
    if (Number.isNaN(next.getTime()) || next <= deadline) {
      return {
        ok: false,
        error: "Peer grading must close after the submission deadline.",
      };
    }
    patch.peer_close_at = next.toISOString();
  } else if (
    patch.deadline &&
    new Date(assignment.peer_close_at) <= deadline
  ) {
    // The deadline moved past the peer window: keep the invariant rather
    // than erroring on a field the professor didn't touch.
    return {
      ok: false,
      error:
        "That deadline is after peer grading closes — move the peer grading close too.",
    };
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("assignments")
    .update(patch)
    .eq("id", assignment.id);
  if (error) return { ok: false, error: "Couldn't save the changes." };

  revalidatePath(`/course/${assignment.course_id}/assignments/${assignment.id}`);
  revalidatePath(`/course/${assignment.course_id}/assignments`);
  return { ok: true };
}

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
