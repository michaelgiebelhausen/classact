"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { describeQueryFailure } from "@/lib/dberror";
import {
  cleanCriteria,
  fingerprint,
  readRubricMeta,
  rubricSignature,
  type Criterion,
} from "@/lib/rubric";
import { tasteProse } from "@/lib/tasteprose";
import {
  loadEngineAssignment,
  patchAnalysis,
  rebuildOrder,
  type AnalysisState,
} from "@/server/gradingengine";
import { rubricFromTaste } from "@/server/tastyai";
import { resolveCourseAi } from "@/server/aicreds";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentState } from "@/types/db";

/**
 * The rubric grid: the professor's at any point. Drafted from their taste
 * file while the assignment is open, edited by hand before or after grading,
 * saved to and imported from their own library, and regraded against.
 *
 * What a regrade costs depends on what changed. Weights alone are arithmetic
 * (the ranking is the weighted mean of the per-criterion scores), so the new
 * order is instant. A changed name or description changes what the AI reads,
 * so every submission is re-read by the engine — the same tick and lock as
 * normal grading. Either way the order is rebuilt from the new scores (the
 * professor confirms that in the UI), and a published assignment goes back
 * to the cockpit until it's published again: students never see a half-
 * regraded class.
 */

/** States whose scores a regrade can replace. */
const REGRADABLE: AssignmentState[] = ["peer_review", "finalizing", "published"];

async function requireProfessorAssignment(assignmentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first.", supabase, user: null, assignment: null };
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, course_id, title, instructions, state, settings, analysis, courses!inner(professor_id)"
    )
    .eq("id", assignmentId)
    .single();
  if (
    !assignment ||
    (assignment.courses as unknown as { professor_id: string }).professor_id !== user.id
  ) {
    return {
      error: "Only the course owner can change the rubric.",
      supabase,
      user,
      assignment: null,
    };
  }
  return { error: null, supabase, user, assignment };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Write rows to match the grid: update kept ids, insert new, delete removed. */
async function writeGrid(
  supabase: Supabase,
  assignment: { id: string; course_id: string },
  criteria: Criterion[],
  replaceAll: boolean
): Promise<string | null> {
  const { data: existing, error: readError } = await supabase
    .from("rubric_themes")
    .select("id")
    .eq("assignment_id", assignment.id);
  if (readError) return describeQueryFailure("rubric", readError) ?? "Couldn't read the rubric.";
  // Only ids that already belong to this assignment are updated; anything
  // else from the client is treated as a new row.
  const ownIds = new Set((existing ?? []).map((r) => r.id));
  const keep = new Set(
    replaceAll ? [] : criteria.map((c) => c.id).filter((id): id is string => !!id && ownIds.has(id))
  );
  const removed = [...ownIds].filter((id) => !keep.has(id));
  if (removed.length > 0) {
    const { error } = await supabase.from("rubric_themes").delete().in("id", removed);
    if (error) return describeQueryFailure("rubric", error) ?? "Couldn't save the rubric.";
  }
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    const fields = {
      name: c.name,
      description: c.description,
      weight: c.weight,
      position: i,
    };
    const { error } =
      c.id && keep.has(c.id)
        ? await supabase.from("rubric_themes").update(fields).eq("id", c.id)
        : await supabase.from("rubric_themes").insert({
            ...fields,
            assignment_id: assignment.id,
            course_id: assignment.course_id,
            // The professor wrote it; it seeds the class's themes and
            // survives emergence word for word.
            provenance: "professor",
            items: [],
          });
    if (error) return describeQueryFailure("rubric", error) ?? "Couldn't save the rubric.";
  }
  return null;
}

async function patchSettings(
  supabase: Supabase,
  assignment: { id: string; settings: unknown },
  patch: Record<string, unknown>
): Promise<boolean> {
  const { error } = await supabase
    .from("assignments")
    .update({
      settings: { ...((assignment.settings ?? {}) as Record<string, unknown>), ...patch },
    })
    .eq("id", assignment.id);
  return !error;
}

export type RegradeOutcome =
  /** Stored; grading hasn't run, so there was nothing to regrade. */
  | "saved"
  /** The AI is re-reading every submission (the engine works through them). */
  | "ai"
  /** Only weights changed: the order was rebuilt on the spot. */
  | "weights";

/**
 * Start a regrade. `forceAi` re-reads every submission even when the
 * criteria text is unchanged — the professor asking for a fresh read.
 */
async function startRegrade(
  assignmentId: string,
  courseId: string,
  forceAi: boolean,
  /** What the scores were read against when the engine never recorded it
   *  (graded before signatures existed): the grid as it stood before this
   *  save. Without it, a first weight tweak would re-read the whole class. */
  fallbackSig?: string
): Promise<ActionResult<{ applied: RegradeOutcome }>> {
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();
  const fresh = await loadEngineAssignment(admin, assignmentId);
  if (!fresh) return { ok: false, error: "Assignment not found." };
  const analysis = (fresh.analysis ?? {}) as AnalysisState;
  if (!REGRADABLE.includes(fresh.state) || analysis.phase !== "done") {
    return { ok: true, data: { applied: "saved" } };
  }
  if (analysis.regrade) {
    return { ok: false, error: "A regrade is already running — it rebuilds the list when it finishes." };
  }

  const [{ data: themes }, { data: scored }] = await Promise.all([
    admin.from("rubric_themes").select("name, description").eq("assignment_id", assignmentId),
    admin.from("ai_scores").select("submission_id").eq("assignment_id", assignmentId),
  ]);
  const signature = rubricSignature(themes ?? []);
  const needsAi = forceAi || signature !== (analysis.rubricSig ?? fallbackSig);
  const pending = (scored ?? []).map((s) => s.submission_id);

  // Published grades come down first: students go back to seeing nothing
  // until the professor publishes the regraded list.
  if (fresh.state === "published") {
    const { error } = await admin
      .from("assignments")
      .update({ state: "finalizing", published_at: null })
      .eq("id", assignmentId);
    if (error) return { ok: false, error: "Couldn't reopen the grades — nothing was regraded." };
    fresh.state = "finalizing";
  }

  if (!needsAi || pending.length === 0) {
    await rebuildOrder(admin, assignmentId);
    // Best effort: a chunk holding the lock just means the next save
    // compares against the older signature and may ask for one AI pass more.
    await patchAnalysis(admin, fresh, () => ({ rubricSig: signature }));
    revalidatePath(`/course/${courseId}/assignments/${assignmentId}`);
    return { ok: true, data: { applied: "weights" } };
  }

  const started = await patchAnalysis(admin, fresh, () => ({
    rubricSig: signature,
    regrade: {
      pending,
      failures: {},
      total: pending.length,
      startedAt: new Date().toISOString(),
    },
  }));
  if (!started) {
    return { ok: false, error: "Grading is mid-step — try again in a minute." };
  }
  revalidatePath(`/course/${courseId}/assignments/${assignmentId}`);
  return { ok: true, data: { applied: "ai" } };
}

/**
 * Professor: save the grid, and optionally regrade against it in the same
 * click. Editable at any point except while the AI is mid-pipeline (it may be
 * building or reading this very rubric) or mid-regrade.
 */
export async function saveRubric(
  assignmentId: string,
  rawCriteria: unknown,
  options: { regrade?: boolean } = {}
): Promise<ActionResult<{ applied: RegradeOutcome }>> {
  const { error, supabase, assignment } = await requireProfessorAssignment(assignmentId);
  if (error || !assignment) return { ok: false, error: error ?? "Not found." };
  const criteria = cleanCriteria(rawCriteria);
  if (typeof criteria === "string") return { ok: false, error: criteria };
  if (assignment.state === "analyzing" || assignment.state === "awaiting_key") {
    return {
      ok: false,
      error: "The AI is grading right now — edit the rubric once the ranked list is up.",
    };
  }
  if (((assignment.analysis ?? {}) as AnalysisState).regrade) {
    return { ok: false, error: "A regrade is running — edit again once it finishes." };
  }

  const { data: before } = await supabase
    .from("rubric_themes")
    .select("name, description")
    .eq("assignment_id", assignmentId);
  const problem = await writeGrid(supabase, assignment, criteria, false);
  if (problem) return { ok: false, error: problem };
  // Hand-edited from here on: the taste file no longer redrafts it.
  await patchSettings(supabase, assignment, { rubricEdited: true });

  if (!options.regrade) {
    revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
    return { ok: true, data: { applied: "saved" } };
  }
  return startRegrade(
    assignmentId,
    assignment.course_id,
    false,
    rubricSignature(before ?? [])
  );
}

/** Professor: re-read every submission against the rubric as it stands. */
export async function regradeAssignment(
  assignmentId: string
): Promise<ActionResult<{ applied: RegradeOutcome }>> {
  const { error, assignment } = await requireProfessorAssignment(assignmentId);
  if (error || !assignment) return { ok: false, error: error ?? "Not found." };
  return startRegrade(assignmentId, assignment.course_id, true);
}

/**
 * Professor: turn their taste file into the grid. Automatic while the grid
 * is untouched (the page calls this whenever the taste file has changed since
 * the last draft); `force` is the "Rebuild from taste file" button, which
 * replaces hand edits on purpose. Only while the assignment is open — after
 * that the grid is edited directly.
 */
export async function draftRubricFromTaste(
  assignmentId: string,
  options: { force?: boolean } = {}
): Promise<ActionResult<{ drafted: boolean }>> {
  const { error, supabase, assignment } = await requireProfessorAssignment(assignmentId);
  if (error || !assignment) return { ok: false, error: error ?? "Not found." };
  if (assignment.state !== "open") {
    return { ok: false, error: "Grading has started — edit the rubric directly." };
  }
  const meta = readRubricMeta(assignment.settings);
  if (meta.edited && !options.force) return { ok: true, data: { drafted: false } };

  const { data: tasteRow } = await supabase
    .from("taste_files")
    .select("body, criteria, bar_statement")
    .eq("assignment_id", assignmentId)
    .is("enrollment_id", null)
    .maybeSingle();
  const taste = tasteProse(tasteRow ?? null);
  if (!taste) return { ok: false, error: "Write your taste file first — the rubric is drawn from it." };
  const from = fingerprint(taste);
  if (!options.force && meta.draftedFrom === from) return { ok: true, data: { drafted: false } };

  const creds = await resolveCourseAi(assignment.course_id, "rubric");
  if (!creds) {
    return {
      ok: false,
      error: "Connect an AI key in AI Settings to draft the rubric — or fill in the grid by hand.",
    };
  }
  const draft = await rubricFromTaste(
    {
      assignmentTitle: assignment.title,
      instructions: assignment.instructions ?? "",
      tasteText: taste,
    },
    creds
  );
  if (!draft.ok) return draft;

  const problem = await writeGrid(supabase, assignment, draft.data, true);
  if (problem) return { ok: false, error: problem };
  await patchSettings(supabase, assignment, { rubricEdited: false, rubricDraftedFrom: from });
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true, data: { drafted: true } };
}

// ---------------------------------------------------------------------------
// The professor's library
// ---------------------------------------------------------------------------

/** Save a grid to "My rubrics". The same name replaces the earlier one. */
export async function saveRubricToLibrary(
  name: string,
  rawCriteria: unknown
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const title = name.trim().slice(0, 120);
  if (!title) return { ok: false, error: "Give the rubric a name." };
  const criteria = cleanCriteria(rawCriteria);
  if (typeof criteria === "string") return { ok: false, error: criteria };
  // Copied, never linked: ids and class quotes stay with the assignment.
  const stored = criteria.map((c) => ({
    name: c.name,
    description: c.description,
    weight: c.weight,
  }));
  const { data, error } = await supabase
    .from("saved_rubrics")
    .upsert(
      {
        owner_id: user.id,
        name: title,
        criteria: stored,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,name" }
    )
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: (error && describeQueryFailure("saved_rubrics", error)) ?? "Couldn't save — try again.",
    };
  }
  return { ok: true, data: { id: data.id } };
}

export async function deleteSavedRubric(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { error } = await supabase.from("saved_rubrics").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete — try again." };
  return { ok: true };
}
