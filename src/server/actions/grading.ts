"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { readDividers, resolveSettings, seededRandom } from "@/lib/tastegrading";
import {
  applyLocalMove,
  bandsProblem,
  computeScores,
  cutScoresFromDividers,
  dividersFromThresholds,
  normalizeDividers,
  persistPoints,
  type Band,
} from "@/lib/bands";
import { pairKey, suggestPair } from "@/lib/ranking";
import { classifyUnscored, isGivenUp } from "@/lib/gradingqueue";
import {
  ensureMaterialized,
  loadEngineAssignment,
  patchAnalysis,
  recomputeRanking,
  runGradingChunk,
  writeOrder,
  type AnalysisState,
  type ChunkData,
} from "@/server/gradingengine";
import { docKindFromPath, type DocKind } from "@/server/tastyai";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentState } from "@/types/db";

/**
 * Tasty Grading — the professor's and students' grading actions. The analysis
 * itself lives in server/gradingengine, driven by the every-minute tick; the
 * actions here authorize a person and hand off to it. Human comparisons then
 * refine the ranking; the professor sets the bands and publishes. No grade is
 * published without that click.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";
const SIGNED_URL_SECONDS = 900;

async function requireMemberAssignment(assignmentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first.", user: null, assignment: null, supabase };
  // RLS: members only.
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, course_id, title, storage_path, deadline, peer_close_at, points, settings, state, analysis, published_at, courses!inner(professor_id, grading_defaults)"
    )
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { error: "Assignment not found.", user, assignment: null, supabase };
  return { error: null, user, assignment, supabase };
}

function isProfessorOf(
  assignment: { courses: unknown },
  userId: string
): boolean {
  return (
    (assignment.courses as { professor_id: string }).professor_id === userId
  );
}

/**
 * The peer window is over either because the professor closed it or because
 * it simply lapsed. Both mean the professor now owns the order — the state
 * column alone would miss the second case, since nothing writes a row when a
 * deadline passes.
 */
function effectiveFinalizing(assignment: {
  state: string;
  peer_close_at: string;
}): boolean {
  return (
    assignment.state === "finalizing" ||
    (assignment.state === "peer_review" &&
      new Date(assignment.peer_close_at).getTime() < Date.now())
  );
}

/**
 * The bands, and where their lines fall. Assignments graded before the list
 * existed carry 0–100 thresholds instead of line positions, so those are
 * mapped onto this class's actual scores the first time they're needed.
 */
function resolveBands(
  assignment: { settings: unknown; courses: unknown },
  scoresDesc: number[]
): { bands: Band[]; dividers: number[]; derived: boolean } {
  const settings = resolveSettings(
    (assignment.courses as { grading_defaults: unknown }).grading_defaults,
    assignment.settings
  );
  const stored = readDividers(assignment.settings);
  const derived = stored === null;
  const dividers = derived
    ? dividersFromThresholds(
        scoresDesc,
        settings.cutPoints.map((c) => c.min)
      )
    : stored;
  return {
    bands: settings.bands,
    dividers: normalizeDividers(dividers, scoresDesc.length, settings.bands.length),
    derived,
  };
}

/**
 * Advance grading one chunk from the professor's page. The tick does this on
 * its own every minute; the page calling it too just makes progress visible
 * sooner (both drivers share the engine's lock, so they never collide).
 * "Start grading" is the same call — it no longer has to wait for the tick.
 */
export async function advanceAnalysis(
  assignmentId: string
): Promise<ActionResult<Omit<ChunkData, "worked">>> {
  const { error, assignment, user } = await requireMemberAssignment(assignmentId);
  if (error || !assignment) return { ok: false, error: error ?? "Not found." };
  if (!user || !isProfessorOf(assignment, user.id)) {
    return { ok: false, error: "Only the professor can start grading." };
  }
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured for analysis (service role missing)." };
  }
  if (new Date(assignment.deadline).getTime() > Date.now()) {
    return { ok: false, error: "The deadline hasn't passed yet." };
  }
  const result = await runGradingChunk(createAdminClient(), assignmentId);
  if (!result.ok) return result;
  const { phase, state, scored, total } = result.data!;
  if (state !== assignment.state) {
    revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  }
  return { ok: true, data: { phase, state, scored, total } };
}

/**
 * Professor: give the submissions the AI gave up on another round of
 * attempts (e.g. after a student re-exported a file, or a provider outage).
 */
export async function retryUnreadable(assignmentId: string): Promise<ActionResult> {
  const { error, user, assignment } = await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();
  const fresh = await loadEngineAssignment(admin, assignmentId);
  if (!fresh) return { ok: false, error: "Assignment not found." };
  const cleared = await patchAnalysis(admin, fresh, (analysis: AnalysisState) => {
    const failures = { ...(analysis.failures ?? {}) };
    for (const [id, failure] of Object.entries(failures)) {
      if (!id.startsWith("standards:") && isGivenUp(failure)) delete failures[id];
    }
    return { failures };
  });
  if (!cleared) {
    return { ok: false, error: "Grading is mid-step — try again in a minute." };
  }
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}


/** Signed URLs (+ doc kinds) for a comparison's two files — judge or professor only. */
export async function getPairPdfUrls(comparisonId: string): Promise<
  ActionResult<{
    left: string;
    right: string;
    leftKind: DocKind;
    rightKind: DocKind;
  }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  // RLS: only the judge or the professor can see this row.
  const { data: comparison } = await supabase
    .from("comparisons")
    .select("id, left_submission_id, right_submission_id")
    .eq("id", comparisonId)
    .single();
  if (!comparison) return { ok: false, error: "Pair not found." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("submissions")
    .select("id, storage_path")
    .in("id", [comparison.left_submission_id, comparison.right_submission_id]);
  const pathOf = (id: string) => subs?.find((s) => s.id === id)?.storage_path;
  const leftPath = pathOf(comparison.left_submission_id);
  const rightPath = pathOf(comparison.right_submission_id);
  if (!leftPath || !rightPath) return { ok: false, error: "Submission files missing." };
  const [left, right] = await Promise.all([
    admin.storage.from(ASSIGNMENT_BUCKET).createSignedUrl(leftPath, SIGNED_URL_SECONDS),
    admin.storage.from(ASSIGNMENT_BUCKET).createSignedUrl(rightPath, SIGNED_URL_SECONDS),
  ]);
  if (!left.data?.signedUrl || !right.data?.signedUrl) {
    return { ok: false, error: "Couldn't open the files — try again." };
  }
  return {
    ok: true,
    data: {
      left: left.data.signedUrl,
      right: right.data.signedUrl,
      leftKind: docKindFromPath(leftPath),
      rightKind: docKindFromPath(rightPath),
    },
  };
}

/**
 * Record a verdict on an assigned pair (peer) or a professor pair, then
 * refine the ranking. Verdict: −2..+2, right-is-better positive.
 */
export async function submitVerdict(
  comparisonId: string,
  verdict: number
): Promise<ActionResult> {
  if (!Number.isInteger(verdict) || verdict < -2 || verdict > 2) {
    return { ok: false, error: "Invalid verdict." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: comparison } = await supabase
    .from("comparisons")
    .select(
      "id, assignment_id, course_id, judge_enrollment_id, left_submission_id, right_submission_id, assignments!inner(peer_close_at, state, courses!inner(professor_id))"
    )
    .eq("id", comparisonId)
    .single();
  if (!comparison) return { ok: false, error: "Pair not found." };
  const assignment = comparison.assignments as unknown as {
    peer_close_at: string;
    state: string;
    courses: { professor_id: string };
  };
  const isProfessor = assignment.courses.professor_id === user.id;
  if (!isProfessor) {
    if (assignment.state !== "peer_review") {
      return { ok: false, error: "Peer grading isn't open." };
    }
    if (new Date(assignment.peer_close_at).getTime() < Date.now()) {
      return { ok: false, error: "The peer grading window has closed." };
    }
  } else if (assignment.state === "published") {
    return { ok: false, error: "This assignment is already published." };
  }
  // RLS restricts the update to the judge (or professor via professor_write).
  const { error } = await supabase
    .from("comparisons")
    .update({ verdict, decided_at: new Date().toISOString() })
    .eq("id", comparisonId);
  if (error) return { ok: false, error: "Couldn't record your call — try again." };
  if (!isConfigured.supabaseAdmin) return { ok: true };
  const admin = createAdminClient();

  if (isProfessor && effectiveFinalizing(assignment)) {
    // The list is the professor's now, so their call is a local move: the
    // loser drops in just below the winner. A global refit here would throw
    // away every drag they'd already made.
    if (verdict === 0) return { ok: true };
    const winner =
      verdict > 0 ? comparison.right_submission_id : comparison.left_submission_id;
    const loser =
      verdict > 0 ? comparison.left_submission_id : comparison.right_submission_id;
    const rows = await ensureMaterialized(admin, comparison.assignment_id);
    const moved = applyLocalMove(
      rows.map((r) => r.submission_id),
      winner,
      loser
    );
    const byId = new Map(rows.map((r) => [r.submission_id, r]));
    await writeOrder(
      admin,
      comparison.assignment_id,
      moved.map((id) => byId.get(id)!).filter(Boolean)
    );
    return { ok: true };
  }

  await recomputeRanking(admin, comparison.assignment_id);
  return { ok: true };
}

/**
 * Professor: serve the next most informative pair (optionally within a
 * histogram bin) as a fresh comparison row.
 */
export async function professorNextPair(
  assignmentId: string,
  bin?: { minScore: number; maxScore: number }
): Promise<ActionResult<{ comparisonId: string }>> {
  const { error, user, assignment } = await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) {
    return { ok: false, error: "Professor only." };
  }
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();
  const [{ data: rankRows }, { data: myPairs }] = await Promise.all([
    admin
      .from("rankings")
      .select("submission_id, bt_score, rank, final_rank")
      .eq("assignment_id", assignmentId),
    admin
      .from("comparisons")
      .select("left_submission_id, right_submission_id")
      .eq("assignment_id", assignmentId)
      .is("judge_enrollment_id", null),
  ]);
  if (!rankRows || rankRows.length < 2) {
    return { ok: false, error: "Not enough ranked submissions yet." };
  }
  const { data: comparisonCounts } = await admin
    .from("comparisons")
    .select("left_submission_id, right_submission_id")
    .eq("assignment_id", assignmentId)
    .not("verdict", "is", null);
  const touch = new Map<string, number>();
  for (const c of comparisonCounts ?? []) {
    touch.set(c.left_submission_id, (touch.get(c.left_submission_id) ?? 0) + 1);
    touch.set(c.right_submission_id, (touch.get(c.right_submission_id) ?? 0) + 1);
  }

  let pool = rankRows;
  if (bin) {
    const inBin = rankRows.filter(
      (r) => Number(r.bt_score) >= bin.minScore && Number(r.bt_score) < bin.maxScore
    );
    if (inBin.length >= 2) pool = inBin;
  }
  const ranked = pool
    .map((r) => ({
      submissionId: r.submission_id,
      theta: 0,
      score: Number(r.bt_score),
      // The professor's order once it exists, so "next pair" walks the list
      // they are actually looking at.
      rank: r.final_rank ?? r.rank,
      comparisons: touch.get(r.submission_id) ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);
  // Boundary weighting follows the lines: the pairs worth a second look are
  // the ones straddling a band edge, wherever the professor put it.
  const scoresDesc = [...rankRows]
    .sort((a, b) => (a.final_rank ?? a.rank) - (b.final_rank ?? b.rank))
    .map((r) => Number(r.bt_score));
  const { dividers } = resolveBands(assignment, scoresDesc);
  const exclude = new Set(
    (myPairs ?? []).map((p) => pairKey(p.left_submission_id, p.right_submission_id))
  );
  const rand = seededRandom(`${assignmentId}:${(myPairs ?? []).length}`);
  const pair = suggestPair(
    ranked,
    cutScoresFromDividers(scoresDesc, dividers),
    exclude,
    rand
  );
  if (!pair) return { ok: false, error: "No fresh pairs left — you've seen them all." };
  const { data: created, error: insertError } = await admin
    .from("comparisons")
    .insert({
      assignment_id: assignmentId,
      course_id: assignment.course_id,
      judge_enrollment_id: null,
      left_submission_id: pair.left,
      right_submission_id: pair.right,
      pair_type: "professor",
    })
    .select("id")
    .single();
  if (insertError || !created) return { ok: false, error: "Couldn't create the pair." };
  return { ok: true, data: { comparisonId: created.id } };
}

/**
 * Professor: save the grade bands and where their lines sit in the list.
 * Deliberately does NOT recompute the ranking — bands decide what a position
 * is worth, never who is in it.
 */
export async function setBands(
  assignmentId: string,
  bands: Band[],
  dividers: number[]
): Promise<ActionResult> {
  const { error, user, assignment, supabase } =
    await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  if (assignment.state === "published") {
    return { ok: false, error: "This assignment is already published." };
  }

  const clean: Band[] = bands.map((b) => ({
    label:
      typeof b.label === "string" && b.label.trim()
        ? b.label.trim().slice(0, 40)
        : null,
    value:
      typeof b.value === "number" && Number.isFinite(b.value)
        ? Math.max(0, b.value)
        : null,
  }));
  const { count } = await supabase
    .from("rankings")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  const settings = resolveSettings(
    (assignment.courses as unknown as { grading_defaults: unknown }).grading_defaults,
    assignment.settings
  );
  const problem = bandsProblem({
    bands: clean,
    dividers,
    scoreMode: settings.scoreMode,
    points: assignment.points === null ? null : Number(assignment.points),
    rowCount: count ?? 0,
  });
  if (problem) return { ok: false, error: problem };

  const merged = { ...(assignment.settings as Record<string, unknown>) };
  merged.bands = clean;
  merged.dividers = dividers;
  // The 0–100 thresholds have no meaning once lines live in the list.
  delete merged.cutPoints;

  const { error: updateError } = await supabase
    .from("assignments")
    .update({ settings: merged })
    .eq("id", assignmentId);
  if (updateError) return { ok: false, error: "Couldn't save the bands." };
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/**
 * Professor: move a submission to a new position in the ranked list.
 * Only once peer review is over — while it runs, the order is still being
 * refined by votes and a drag would be overwritten by the next one.
 */
export async function reorderSubmission(
  assignmentId: string,
  submissionId: string,
  toPosition: number
): Promise<ActionResult> {
  const { error, user, assignment } = await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  if (assignment.state === "published") {
    return { ok: false, error: "This assignment is already published." };
  }
  if (!effectiveFinalizing(assignment)) {
    return {
      ok: false,
      error: "Close peer grading first — the order is still being refined.",
    };
  }
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }

  const admin = createAdminClient();
  const rows = await ensureMaterialized(admin, assignmentId);
  const from = rows.findIndex((r) => r.submission_id === submissionId);
  if (from < 0) return { ok: false, error: "That submission isn't in this list." };
  const to = Math.min(rows.length - 1, Math.max(0, Math.round(toPosition)));
  if (to === from) return { ok: true };

  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  if (!(await writeOrder(admin, assignmentId, next))) {
    return { ok: false, error: "Couldn't save the new order — try again." };
  }
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/** Professor: end peer grading now (moves to finalizing). */
export async function closePeerWindow(assignmentId: string): Promise<ActionResult> {
  const { error, user, assignment, supabase } =
    await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  const { error: updateError } = await supabase
    .from("assignments")
    .update({ peer_close_at: new Date().toISOString(), state: "finalizing" })
    .eq("id", assignmentId);
  if (updateError) return { ok: false, error: "Couldn't close the window." };
  // From here the order is the professor's, not the model's.
  if (isConfigured.supabaseAdmin) {
    await ensureMaterialized(createAdminClient(), assignmentId);
  }
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/**
 * Professor: publish. The irreducible act — grades, ranks, and reports
 * become visible to students only after this click.
 */
export async function publishAssignment(assignmentId: string): Promise<ActionResult> {
  const { error, user, assignment, supabase } =
    await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();

  // Submissions stay open until this click, so late work may still be in the
  // grader. Publishing now would leave it out of the grades — wait for it.
  // (What the AI gave up on is the professor's to grade by hand; that one
  // doesn't block.)
  const [{ data: subRows }, { data: scoreRows }] = await Promise.all([
    admin.from("submissions").select("id").eq("assignment_id", assignmentId),
    admin.from("ai_scores").select("submission_id").eq("assignment_id", assignmentId),
  ]);
  const queue = classifyUnscored({
    submissionIds: (subRows ?? []).map((s) => s.id),
    scoredIds: new Set((scoreRows ?? []).map((s) => s.submission_id)),
    failures: ((assignment.analysis ?? {}) as AnalysisState).failures ?? {},
    now: new Date(),
  });
  const inFlight = queue.ready.length + queue.waiting.length;
  if (inFlight > 0) {
    return {
      ok: false,
      error: `${inFlight} late submission${inFlight === 1 ? " is" : "s are"} still being graded — publish once ${inFlight === 1 ? "it's" : "they're"} in the list (usually a minute or two).`,
    };
  }

  // The order is settled here, not recomputed: publishing must hand out the
  // list the professor is looking at, including every drag they made.
  const rows = await ensureMaterialized(admin, assignmentId);
  const scoresDesc = rows.map((r) => Number(r.bt_score));
  const { bands, dividers, derived } = resolveBands(assignment, scoresDesc);
  const settings = resolveSettings(
    (assignment.courses as unknown as { grading_defaults: unknown }).grading_defaults,
    assignment.settings
  );
  const points = assignment.points === null ? null : Number(assignment.points);

  if (rows.length > 0) {
    const problem = bandsProblem({
      bands,
      dividers,
      scoreMode: settings.scoreMode,
      points,
      rowCount: rows.length,
    });
    if (problem) return { ok: false, error: problem };

    const scored = computeScores({
      order: rows.map((r) => r.submission_id),
      bands,
      dividers,
      scoreMode: settings.scoreMode,
      points,
    });
    const now = new Date().toISOString();
    const { error: scoreError } = await admin.from("rankings").upsert(
      scored.map((s) => ({
        assignment_id: assignmentId,
        course_id: rows[s.position].course_id,
        submission_id: s.submissionId,
        bt_score: rows[s.position].bt_score,
        rank: rows[s.position].rank,
        final_rank: s.position + 1,
        points_awarded: persistPoints(s.points),
        letter: s.label,
        updated_at: now,
      })),
      { onConflict: "submission_id" }
    );
    if (scoreError) {
      return { ok: false, error: "Couldn't write the grades — nothing was published." };
    }
  }

  const update: {
    published_at: string;
    state: AssignmentState;
    settings?: Record<string, unknown>;
  } = {
    published_at: new Date().toISOString(),
    state: "published",
  };
  // Lines derived from legacy thresholds become real, so a published grade
  // can always be recomputed from what is stored.
  if (derived) {
    update.settings = {
      ...(assignment.settings as Record<string, unknown>),
      bands,
      dividers,
    };
  }
  const { error: updateError } = await supabase
    .from("assignments")
    .update(update)
    .eq("id", assignmentId);
  if (updateError) return { ok: false, error: "Couldn't publish — try again." };
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}

/**
 * Professor: one submission, ready to read — the file, what the AI saw, and
 * the student's note. Fetched when a row is opened rather than signing a URL
 * for every submission up front.
 */
export async function getSubmissionReview(
  assignmentId: string,
  submissionId: string
): Promise<
  ActionResult<{
    url: string;
    kind: DocKind;
    note: string;
    summary: string;
    ownBar: number | null;
    distinctiveness: number | null;
    themeScores: Array<{ name: string; score: number; evidence: string }>;
  }>
> {
  const { error, user, assignment } = await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }

  const admin = createAdminClient();
  const [{ data: submission }, { data: score }, { data: themes }] =
    await Promise.all([
      admin
        .from("submissions")
        .select("id, storage_path, note")
        .eq("id", submissionId)
        .eq("assignment_id", assignmentId)
        .single(),
      admin
        .from("ai_scores")
        .select("theme_scores, summary, own_bar, distinctiveness")
        .eq("submission_id", submissionId)
        .maybeSingle(),
      admin
        .from("rubric_themes")
        .select("id, name")
        .eq("assignment_id", assignmentId)
        .order("position"),
    ]);
  if (!submission) return { ok: false, error: "Submission not found." };

  const { data: signed } = await admin.storage
    .from(ASSIGNMENT_BUCKET)
    .createSignedUrl(submission.storage_path, SIGNED_URL_SECONDS);
  if (!signed?.signedUrl) {
    return { ok: false, error: "Couldn't open the file — try again." };
  }

  const nameById = new Map((themes ?? []).map((t) => [t.id, t.name]));
  const themeScores = (
    (score?.theme_scores ?? []) as Array<{
      themeId: string;
      score: number;
      evidence: string;
    }>
  ).map((t) => ({
    name: nameById.get(t.themeId) ?? "Theme",
    score: t.score,
    evidence: t.evidence,
  }));

  return {
    ok: true,
    data: {
      url: signed.signedUrl,
      kind: docKindFromPath(submission.storage_path),
      note: submission.note ?? "",
      summary: score?.summary ?? "",
      ownBar: score?.own_bar === null || score?.own_bar === undefined ? null : Number(score.own_bar),
      distinctiveness:
        score?.distinctiveness === null || score?.distinctiveness === undefined
          ? null
          : Number(score.distinctiveness),
      themeScores,
    },
  };
}
