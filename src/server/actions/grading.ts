"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  letterFor,
  resolveSettings,
  seededRandom,
  type CutPoint,
} from "@/lib/tastegrading";
import {
  computeRanking,
  pairKey,
  suggestPair,
  type ComparisonInput,
} from "@/lib/ranking";
import { assignPeerPairs } from "@/lib/pairing";
import { findSimilarPairs } from "@/lib/shingle";
import {
  emergeRubric,
  generateBaselines,
  scoreSubmission,
} from "@/server/tastyai";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentState, TasteCriterion } from "@/types/db";

/**
 * Tasty Grading — the grading engine. The analysis runs as a resumable
 * state machine in assignments.analysis (each advanceAnalysis call does one
 * bounded chunk, so a 100-student class never outlives a serverless
 * timeout): rubric → baselines → scoring (batched) → shingle → pairs.
 * Human comparisons then refine the ranking; the professor sets cut points
 * and publishes. No grade is published without that click.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";
const SCORE_BATCH = 2;
const SIGNED_URL_SECONDS = 900;

interface AnalysisState {
  phase?: "rubric" | "baselines" | "scoring" | "shingle" | "pairs" | "done";
  baselines?: string[];
  /** submissionId → extracted text (cleared after the shingle phase). */
  texts?: Record<string, string>;
  similarPairs?: Array<{ aId: string; bId: string; similarity: number }>;
  error?: string;
  busyUntil?: string;
}

type Supa = ReturnType<typeof createAdminClient>;

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
      "id, course_id, title, storage_path, deadline, peer_close_at, settings, state, analysis, published_at, courses!inner(professor_id, grading_defaults)"
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

async function downloadBase64(admin: Supa, path: string): Promise<string | null> {
  const { data: blob } = await admin.storage.from(ASSIGNMENT_BUCKET).download(path);
  if (!blob) return null;
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

/** Blend the distinctiveness dial into the ranking prior. */
function blendedOverall(
  overall: number,
  distinctiveness: number | null,
  weight: number
): number {
  if (distinctiveness === null) return overall;
  return overall * (1 - weight) + distinctiveness * weight;
}

/** Recompute the ranking from AI scores + decided comparisons (admin). */
async function recomputeRanking(admin: Supa, assignmentId: string) {
  const [{ data: assignment }, { data: scores }, { data: comparisons }] =
    await Promise.all([
      admin
        .from("assignments")
        .select("id, course_id, settings, courses!inner(grading_defaults)")
        .eq("id", assignmentId)
        .single(),
      admin
        .from("ai_scores")
        .select("submission_id, overall, distinctiveness")
        .eq("assignment_id", assignmentId),
      admin
        .from("comparisons")
        .select("left_submission_id, right_submission_id, verdict, judge_enrollment_id")
        .eq("assignment_id", assignmentId)
        .not("verdict", "is", null),
    ]);
  if (!assignment || !scores || scores.length === 0) return;
  const settings = resolveSettings(
    (assignment.courses as unknown as { grading_defaults: unknown }).grading_defaults,
    assignment.settings
  );
  const inputs = scores.map((s) => ({
    submissionId: s.submission_id,
    aiOverall: blendedOverall(
      Number(s.overall),
      s.distinctiveness === null ? null : Number(s.distinctiveness),
      settings.distinctivenessWeight
    ),
  }));
  const comparisonInputs: ComparisonInput[] = (comparisons ?? []).map((c) => ({
    leftSubmissionId: c.left_submission_id,
    rightSubmissionId: c.right_submission_id,
    verdict: c.verdict as number,
    weight: c.judge_enrollment_id === null ? settings.professorWeight : 1,
  }));
  const ranked = computeRanking(inputs, comparisonInputs);
  const now = new Date().toISOString();
  for (const r of ranked) {
    await admin.from("rankings").upsert(
      {
        assignment_id: assignmentId,
        course_id: assignment.course_id,
        submission_id: r.submissionId,
        bt_score: r.score,
        rank: r.rank,
        letter: letterFor(r.score, settings.cutPoints),
        updated_at: now,
      },
      { onConflict: "submission_id" }
    );
  }
}

/**
 * Advance the analysis one bounded chunk. Anyone in the course can turn
 * the crank once the deadline has passed (the UI polls this); all writes
 * run as service role after the membership check.
 */
export async function advanceAnalysis(assignmentId: string): Promise<
  ActionResult<{
    phase: string;
    state: string;
    scored: number;
    total: number;
  }>
> {
  const { error, assignment } = await requireMemberAssignment(assignmentId);
  if (error || !assignment) return { ok: false, error: error ?? "Not found." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured for analysis (service role missing)." };
  }
  if (new Date(assignment.deadline).getTime() > Date.now()) {
    return { ok: false, error: "The deadline hasn't passed yet." };
  }
  if (assignment.state !== "open" && assignment.state !== "analyzing") {
    return {
      ok: true,
      data: { phase: "done", state: assignment.state, scored: 0, total: 0 },
    };
  }

  const admin = createAdminClient();
  const analysis = (assignment.analysis ?? {}) as AnalysisState;

  // Soft lock: another crank is mid-chunk.
  if (analysis.busyUntil && new Date(analysis.busyUntil).getTime() > Date.now()) {
    const { count } = await admin
      .from("ai_scores")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);
    return {
      ok: true,
      data: {
        phase: analysis.phase ?? "rubric",
        state: "analyzing",
        scored: count ?? 0,
        total: -1,
      },
    };
  }

  const saveAnalysis = async (patch: AnalysisState, state?: AssignmentState) => {
    await admin
      .from("assignments")
      .update({
        analysis: { ...analysis, ...patch },
        ...(state ? { state } : {}),
      })
      .eq("id", assignmentId);
  };
  await saveAnalysis(
    { busyUntil: new Date(Date.now() + 150_000).toISOString() },
    "analyzing"
  );
  const done = async (patch: AnalysisState, state?: AssignmentState) =>
    saveAnalysis({ ...patch, busyUntil: undefined }, state);

  const phase = analysis.phase ?? "rubric";
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, enrollment_id, storage_path")
    .eq("assignment_id", assignmentId);
  const total = submissions?.length ?? 0;

  try {
    if (phase === "rubric") {
      const { data: tasteRows } = await admin
        .from("taste_files")
        .select("enrollment_id, criteria, bar_statement")
        .eq("assignment_id", assignmentId);
      const corpus = (tasteRows ?? []).map((t) => ({
        enrollmentId: t.enrollment_id,
        criteria: (t.criteria ?? []) as TasteCriterion[],
        barStatement: t.bar_statement ?? "",
      }));
      if (corpus.length === 0 || total === 0) {
        await done({ error: "No submissions to analyze." }, "peer_review");
        return { ok: true, data: { phase: "done", state: "peer_review", scored: 0, total } };
      }
      const rubric = await emergeRubric({
        assignmentTitle: assignment.title,
        tasteFiles: corpus,
      });
      if (!rubric.ok) {
        await done({});
        return { ok: false, error: rubric.error };
      }
      // Idempotence: clear any partial themes from an interrupted run.
      await admin.from("rubric_themes").delete().eq("assignment_id", assignmentId);
      for (let i = 0; i < rubric.data.length; i++) {
        const t = rubric.data[i];
        await admin.from("rubric_themes").insert({
          assignment_id: assignmentId,
          course_id: assignment.course_id,
          name: t.name,
          description: t.description,
          provenance: t.provenance,
          items: t.items,
          position: i,
        });
      }
      await done({ phase: "baselines" });
      return { ok: true, data: { phase: "baselines", state: "analyzing", scored: 0, total } };
    }

    if (phase === "baselines") {
      const briefBase64 = assignment.storage_path
        ? await downloadBase64(admin, assignment.storage_path)
        : null;
      const baselines = await generateBaselines({
        assignmentTitle: assignment.title,
        briefPdfBase64: briefBase64,
      });
      await done({
        phase: "scoring",
        baselines: baselines.ok ? baselines.data : [],
      });
      return { ok: true, data: { phase: "scoring", state: "analyzing", scored: 0, total } };
    }

    if (phase === "scoring") {
      const { data: doneScores } = await admin
        .from("ai_scores")
        .select("submission_id")
        .eq("assignment_id", assignmentId);
      const scoredIds = new Set((doneScores ?? []).map((s) => s.submission_id));
      const pending = (submissions ?? []).filter((s) => !scoredIds.has(s.id));

      if (pending.length === 0) {
        await done({ phase: "shingle" });
        return {
          ok: true,
          data: { phase: "shingle", state: "analyzing", scored: total, total },
        };
      }

      const { data: themes } = await admin
        .from("rubric_themes")
        .select("id, name, description, items")
        .eq("assignment_id", assignmentId)
        .order("position");
      const themeInputs = (themes ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        itemQuotes: ((t.items ?? []) as Array<{ quote: string }>).map((i) => i.quote),
      }));
      const { data: tastes } = await admin
        .from("taste_files")
        .select("enrollment_id, criteria, bar_statement")
        .eq("assignment_id", assignmentId);
      const tasteByEnrollment = new Map(
        (tastes ?? [])
          .filter((t) => t.enrollment_id !== null)
          .map((t) => [
            t.enrollment_id as string,
            {
              criteria: (t.criteria ?? []) as TasteCriterion[],
              barStatement: t.bar_statement ?? "",
            },
          ])
      );

      const texts = { ...(analysis.texts ?? {}) };
      for (const sub of pending.slice(0, SCORE_BATCH)) {
        const pdf = await downloadBase64(admin, sub.storage_path);
        if (!pdf) continue;
        const score = await scoreSubmission({
          assignmentTitle: assignment.title,
          submissionPdfBase64: pdf,
          themes: themeInputs,
          ownTaste: tasteByEnrollment.get(sub.enrollment_id) ?? null,
          baselines: analysis.baselines ?? [],
        });
        if (!score.ok) continue; // retried on the next crank
        await admin.from("ai_scores").insert({
          assignment_id: assignmentId,
          course_id: assignment.course_id,
          submission_id: sub.id,
          theme_scores: score.data.themeScores,
          overall: score.data.overall,
          own_bar: score.data.ownBar,
          distinctiveness: score.data.distinctiveness,
          summary: score.data.summary,
        });
        texts[sub.id] = score.data.extractedText.slice(0, 8000);
      }
      await done({ phase: "scoring", texts });
      const scoredNow = scoredIds.size + Math.min(SCORE_BATCH, pending.length);
      return {
        ok: true,
        data: { phase: "scoring", state: "analyzing", scored: scoredNow, total },
      };
    }

    if (phase === "shingle") {
      const docs = Object.entries(analysis.texts ?? {}).map(([id, text]) => ({
        id,
        text,
      }));
      const similarPairs = findSimilarPairs(docs);
      await done({ phase: "pairs", similarPairs, texts: {} });
      return { ok: true, data: { phase: "pairs", state: "analyzing", scored: total, total } };
    }

    // phase === "pairs": draft ranking + peer pair assignment, then open.
    await recomputeRanking(admin, assignmentId);
    const { data: ranked } = await admin
      .from("rankings")
      .select("submission_id, rank")
      .eq("assignment_id", assignmentId);
    const { data: subRows } = await admin
      .from("submissions")
      .select("id, enrollment_id")
      .eq("assignment_id", assignmentId);
    const rankBySub = new Map((ranked ?? []).map((r) => [r.submission_id, r.rank]));
    const pairingInput = (subRows ?? []).map((s) => ({
      submissionId: s.id,
      enrollmentId: s.enrollment_id,
      rank: rankBySub.get(s.id) ?? 999,
    }));

    // Teammates (any shared project team in this course) never judge each other.
    const excluded = new Set<string>();
    const { data: teamRows } = await admin
      .from("project_team_members")
      .select("team_id, enrollment_id, project_teams!inner(course_id)")
      .eq("project_teams.course_id", assignment.course_id);
    const byTeam = new Map<string, string[]>();
    for (const row of teamRows ?? []) {
      const list = byTeam.get(row.team_id) ?? [];
      list.push(row.enrollment_id);
      byTeam.set(row.team_id, list);
    }
    for (const members of byTeam.values()) {
      for (const a of members)
        for (const b of members) if (a !== b) excluded.add(`${a}|${b}`);
    }

    const settings = resolveSettings(
      (assignment.courses as unknown as { grading_defaults: unknown }).grading_defaults,
      assignment.settings
    );
    const pairs = assignPeerPairs({
      submissions: pairingInput,
      mix: settings.pairMix,
      excludedJudgeOwner: excluded,
      seed: assignmentId,
    });
    // Idempotence: clear peer pairs from an interrupted run (professor rows kept).
    await admin
      .from("comparisons")
      .delete()
      .eq("assignment_id", assignmentId)
      .not("judge_enrollment_id", "is", null);
    for (const p of pairs) {
      await admin.from("comparisons").insert({
        assignment_id: assignmentId,
        course_id: assignment.course_id,
        judge_enrollment_id: p.judgeEnrollmentId,
        left_submission_id: p.leftSubmissionId,
        right_submission_id: p.rightSubmissionId,
        pair_type: p.pairType,
        position: p.position,
      });
    }
    await done({ phase: "done" }, "peer_review");
    revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
    return { ok: true, data: { phase: "done", state: "peer_review", scored: total, total } };
  } catch (e) {
    console.error(`[grading] analysis chunk failed:`, e);
    await done({});
    return { ok: false, error: "Analysis hit a snag — it will resume on the next try." };
  }
}

/** Signed URLs for a comparison's two PDFs — judge or professor only. */
export async function getPairPdfUrls(
  comparisonId: string
): Promise<ActionResult<{ left: string; right: string }>> {
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
    return { ok: false, error: "Couldn't open the PDFs — try again." };
  }
  return { ok: true, data: { left: left.data.signedUrl, right: right.data.signedUrl } };
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
      "id, assignment_id, course_id, judge_enrollment_id, assignments!inner(peer_close_at, state, courses!inner(professor_id))"
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
  }
  // RLS restricts the update to the judge (or professor via professor_write).
  const { error } = await supabase
    .from("comparisons")
    .update({ verdict, decided_at: new Date().toISOString() })
    .eq("id", comparisonId);
  if (error) return { ok: false, error: "Couldn't record your call — try again." };
  if (isConfigured.supabaseAdmin) {
    await recomputeRanking(createAdminClient(), comparison.assignment_id);
  }
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
      .select("submission_id, bt_score, rank")
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
  const ranked = pool.map((r) => ({
    submissionId: r.submission_id,
    theta: 0,
    score: Number(r.bt_score),
    rank: r.rank,
    comparisons: touch.get(r.submission_id) ?? 0,
  }));
  const settings = resolveSettings(
    (assignment.courses as unknown as { grading_defaults: unknown }).grading_defaults,
    assignment.settings
  );
  const exclude = new Set(
    (myPairs ?? []).map((p) => pairKey(p.left_submission_id, p.right_submission_id))
  );
  const rand = seededRandom(`${assignmentId}:${(myPairs ?? []).length}`);
  const pair = suggestPair(
    ranked,
    settings.cutPoints.map((c) => c.min),
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

/** Professor: set cut points (assignment-level) and re-letter the ranking. */
export async function setCutPoints(
  assignmentId: string,
  cutPoints: CutPoint[]
): Promise<ActionResult> {
  const { error, user, assignment, supabase } =
    await requireMemberAssignment(assignmentId);
  if (error || !assignment || !user) return { ok: false, error: error ?? "Not found." };
  if (!isProfessorOf(assignment, user.id)) return { ok: false, error: "Professor only." };
  const merged = {
    ...(assignment.settings as Record<string, unknown>),
    cutPoints,
  };
  const { error: updateError } = await supabase
    .from("assignments")
    .update({ settings: merged })
    .eq("id", assignmentId);
  if (updateError) return { ok: false, error: "Couldn't save cut points." };
  if (isConfigured.supabaseAdmin) {
    await recomputeRanking(createAdminClient(), assignmentId);
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
  await recomputeRanking(admin, assignmentId);
  const { error: updateError } = await supabase
    .from("assignments")
    .update({ published_at: new Date().toISOString(), state: "published" })
    .eq("id", assignmentId);
  if (updateError) return { ok: false, error: "Couldn't publish — try again." };
  revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
  return { ok: true };
}
