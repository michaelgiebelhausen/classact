"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  readDividers,
  resolveSettings,
  seededRandom,
} from "@/lib/tastegrading";
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
import {
  computeRanking,
  pairKey,
  suggestPair,
  type ComparisonInput,
} from "@/lib/ranking";
import { assignPeerPairs } from "@/lib/pairing";
import { findSimilarPairs } from "@/lib/shingle";
import {
  docKindFromPath,
  emergeRubric,
  generateBaselines,
  scoreSubmission,
  type DocKind,
} from "@/server/tastyai";
import { resolveCourseAi, type AiTask } from "@/server/aicreds";
import { draftBody, tasteProse } from "@/lib/tasteprose";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentState } from "@/types/db";

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
    // Deliberately does NOT write final_rank or letter. rank is the model's
    // draft; final_rank is the professor's order and letter is the band label
    // they publish. A recompute must never be able to undo a drag.
    await admin.from("rankings").upsert(
      {
        assignment_id: assignmentId,
        course_id: assignment.course_id,
        submission_id: r.submissionId,
        bt_score: r.score,
        rank: r.rank,
        updated_at: now,
      },
      { onConflict: "submission_id" }
    );
  }
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

interface RankRow {
  submission_id: string;
  course_id: string;
  bt_score: number;
  rank: number;
  final_rank: number | null;
}

/** Rankings for an assignment, best first, honouring a materialized order. */
async function readOrder(admin: Supa, assignmentId: string): Promise<RankRow[]> {
  const { data } = await admin
    .from("rankings")
    .select("submission_id, course_id, bt_score, rank, final_rank")
    .eq("assignment_id", assignmentId);
  const rows = (data ?? []) as RankRow[];
  return rows.sort((a, b) => (a.final_rank ?? a.rank) - (b.final_rank ?? b.rank));
}

/**
 * Persist an order as final_rank 1..N in one statement. A whole-list rewrite
 * is what keeps positions a permutation; writing them row by row would leave
 * a half-applied order behind if a call failed mid-loop.
 */
async function writeOrder(
  admin: Supa,
  assignmentId: string,
  rows: RankRow[]
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await admin.from("rankings").upsert(
    rows.map((row, index) => ({
      assignment_id: assignmentId,
      course_id: row.course_id,
      submission_id: row.submission_id,
      bt_score: row.bt_score,
      rank: row.rank,
      final_rank: index + 1,
      updated_at: now,
    })),
    { onConflict: "submission_id" }
  );
  return !error;
}

/**
 * Freeze the model's draft into the professor's order, once. Idempotent: if
 * any row already carries a final_rank the list is already theirs, and this
 * does nothing. Called lazily from the mutations rather than on render, so
 * looking at the page never writes.
 */
async function ensureMaterialized(
  admin: Supa,
  assignmentId: string
): Promise<RankRow[]> {
  const rows = await readOrder(admin, assignmentId);
  if (rows.length === 0) return rows;
  if (rows.some((r) => r.final_rank !== null)) return rows;
  await writeOrder(admin, assignmentId, rows);
  return rows.map((row, index) => ({ ...row, final_rank: index + 1 }));
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
 * Advance the analysis one bounded chunk. Grading is kicked off and driven by
 * the PROFESSOR — the first call flips the assignment out of `open`, which is
 * also what closes the late-submission window, so only the course owner may
 * turn the crank. All writes run as service role after that check.
 */
export async function advanceAnalysis(assignmentId: string): Promise<
  ActionResult<{
    phase: string;
    state: string;
    scored: number;
    total: number;
  }>
> {
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
  if (
    assignment.state !== "open" &&
    assignment.state !== "analyzing" &&
    assignment.state !== "awaiting_key"
  ) {
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
  // "tasty" = taste files + peer round; "ai_only" = AI grades against the
  // instructor's criteria, skips baselines and peer review entirely.
  const gradingMode =
    (assignment.settings as { gradingMode?: string }).gradingMode === "ai_only"
      ? "ai_only"
      : "tasty";
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, enrollment_id, storage_path")
    .eq("assignment_id", assignmentId);
  const total = submissions?.length ?? 0;

  // BYOK preflight: the AI phases run on the course owner's key. No working
  // key → pause in awaiting_key (resumes automatically once connected; the
  // saveAnalysis above already flipped us back to 'analyzing' to try).
  const taskForPhase: AiTask | null =
    phase === "rubric"
      ? "rubric"
      : phase === "baselines"
        ? "baseline"
        : phase === "scoring"
          ? "scoring"
          : null;
  const creds = taskForPhase
    ? await resolveCourseAi(assignment.course_id, taskForPhase)
    : null;
  if (taskForPhase && !creds) {
    await done({}, "awaiting_key");
    return {
      ok: true,
      data: { phase, state: "awaiting_key", scored: 0, total },
    };
  }

  try {
    if (phase === "rubric") {
      let corpus: Array<{ enrollmentId: string | null; text: string }>;
      const { data: tasteRows } = await admin
        .from("taste_files")
        .select("enrollment_id, body, criteria, bar_statement")
        .eq("assignment_id", assignmentId);

      if (gradingMode === "ai_only") {
        // The instructor's taste file is the whole corpus. It lives in the
        // professor row now; settings.gradingInstructions is the pre-0037
        // home and stays readable for anything the backfill missed.
        const professorRow = (tasteRows ?? []).find(
          (t) => t.enrollment_id === null
        );
        const text =
          tasteProse(professorRow ?? null) ||
          ((assignment.settings as { gradingInstructions?: string })
            .gradingInstructions ?? "") ||
          "Grade for correctness, completeness, and quality of the work relative to the assignment brief.";
        corpus = [{ enrollmentId: null, text }];
      } else {
        corpus = (tasteRows ?? [])
          .map((t) => ({ enrollmentId: t.enrollment_id, text: tasteProse(t) }))
          .filter((t) => t.text.length > 0);
        // Nobody was asked to write one (tasteRequirement 'off'), or nobody
        // did: the AI's own draft stands in so a rubric can still emerge.
        if (corpus.length === 0) {
          const seed = draftBody(
            (assignment.settings as { defaultTaste?: unknown }).defaultTaste
          );
          if (seed) corpus = [{ enrollmentId: null, text: seed }];
        }
      }
      if (corpus.length === 0 || total === 0) {
        const idleState = gradingMode === "ai_only" ? "finalizing" : "peer_review";
        await done({ error: "No submissions to analyze." }, idleState);
        return { ok: true, data: { phase: "done", state: idleState, scored: 0, total } };
      }
      const rubric = await emergeRubric(
        { assignmentTitle: assignment.title, tasteFiles: corpus },
        creds!
      );
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
      if (gradingMode === "ai_only") {
        // Objective grading: no generic-answer baselines, no distinctiveness.
        await done({ phase: "scoring", baselines: [] });
        return {
          ok: true,
          data: { phase: "scoring", state: "analyzing", scored: 0, total },
        };
      }
      const briefBase64 = assignment.storage_path
        ? await downloadBase64(admin, assignment.storage_path)
        : null;
      const baselines = await generateBaselines(
        {
          assignmentTitle: assignment.title,
          brief:
            briefBase64 && assignment.storage_path
              ? { base64: briefBase64, kind: docKindFromPath(assignment.storage_path) }
              : null,
        },
        creds!
      );
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
        .select("enrollment_id, body, criteria, bar_statement")
        .eq("assignment_id", assignmentId);
      const tasteByEnrollment = new Map(
        (tastes ?? [])
          .filter((t) => t.enrollment_id !== null)
          .map((t) => [t.enrollment_id as string, { text: tasteProse(t) }])
      );

      const texts = { ...(analysis.texts ?? {}) };
      for (const sub of pending.slice(0, SCORE_BATCH)) {
        const fileBase64 = await downloadBase64(admin, sub.storage_path);
        if (!fileBase64) continue;
        const score = await scoreSubmission(
          {
            assignmentTitle: assignment.title,
            submission: {
              base64: fileBase64,
              kind: docKindFromPath(sub.storage_path),
            },
            themes: themeInputs,
            ownTaste: tasteByEnrollment.get(sub.enrollment_id) ?? null,
            baselines: analysis.baselines ?? [],
          },
          creds!
        );
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
    if (gradingMode === "ai_only") {
      // No peer round: the ranking goes straight to the professor, so it is
      // theirs to reorder the moment they see it.
      await ensureMaterialized(admin, assignmentId);
      await done({ phase: "done" }, "finalizing");
      revalidatePath(`/course/${assignment.course_id}/assignments/${assignmentId}`);
      return {
        ok: true,
        data: { phase: "done", state: "finalizing", scored: total, total },
      };
    }
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
