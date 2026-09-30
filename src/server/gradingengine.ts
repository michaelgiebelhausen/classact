import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGradingAxes, resolveSettings } from "@/lib/tastegrading";
import { computeRanking, type ComparisonInput } from "@/lib/ranking";
import { assignPeerPairs } from "@/lib/pairing";
import { findSimilarPairs } from "@/lib/shingle";
import {
  classifyUnscored,
  recordFailure,
  slotIntoOrder,
  type ScoreFailure,
} from "@/lib/gradingqueue";
import {
  compareStandards,
  docKindFromPath,
  emergeRubric,
  generateBaselines,
  scoreSubmission,
  type AiCallCreds,
  type DocInput,
} from "@/server/tastyai";
import { fitImageForModel } from "@/server/imageprep";
import { resolveCourseAi, type AiTask } from "@/server/aicreds";
import { draftBody, isUntouchedTaste, tasteProse } from "@/lib/tasteprose";
import type { ActionResult } from "@/server/actions/auth";
import type { AssignmentState } from "@/types/db";

/**
 * Tasty Grading — the engine. Grading used to be cranked by the professor's
 * open browser tab, so it stalled the moment they closed it (NB03–NB05 sat
 * half-graded for two weeks). Now a server tick (/api/cron/grading, pinged
 * every minute by pg_cron) drives it, and the professor's page is only a
 * second, optional driver.
 *
 * The analysis is still a resumable state machine in assignments.analysis —
 * each chunk is bounded, so a 100-student class never outlives a function
 * timeout: rubric → baselines → scoring → standards → shingle → pairs → done.
 * Grading starts on its own once the deadline passes, and late submissions
 * keep arriving until the professor publishes: after `done`, a catch-up chunk
 * scores each one and slots it into the ranking.
 *
 * Two drivers can now race for one assignment, so every chunk runs under a
 * lock: `analysis.busyUntil` plus `analysis.lockId`, which doubles as a
 * version stamp — it changes on every write, and a write only lands if the
 * stamp is still the one its writer read.
 */

const ASSIGNMENT_BUCKET = "assignment-docs";
/** Submissions scored in parallel per chunk. */
const SCORE_CONCURRENCY = 3;
/** Longer than the slowest chunk (AI calls time out at 150s). */
const LOCK_MS = 240_000;

export type Supa = ReturnType<typeof createAdminClient>;

export interface AnalysisState {
  phase?:
    | "rubric"
    | "baselines"
    | "scoring"
    | "standards"
    | "shingle"
    | "pairs"
    | "done";
  baselines?: string[];
  /** submissionId → extracted text (cleared after the shingle phase). */
  texts?: Record<string, string>;
  similarPairs?: Array<{ aId: string; bId: string; similarity: number }>;
  /** submissionId → failed scoring attempts; see lib/gradingqueue. */
  failures?: Record<string, ScoreFailure>;
  error?: string;
  busyUntil?: string;
  lockId?: string;
}

export interface EngineAssignment {
  id: string;
  course_id: string;
  title: string;
  storage_path: string | null;
  deadline: string;
  state: AssignmentState;
  settings: unknown;
  analysis: unknown;
  courses: unknown;
}

export interface ChunkData {
  phase: string;
  state: string;
  scored: number;
  /** -1 when another driver holds the lock and the count wasn't taken. */
  total: number;
  /** Did this call do any work? The tick moves on when it didn't. */
  worked: boolean;
}

const PIPELINE_STATES: AssignmentState[] = ["open", "analyzing", "awaiting_key"];
const GRADED_STATES: AssignmentState[] = ["peer_review", "finalizing"];

// ---------------------------------------------------------------------------
// Ranking helpers (shared with the professor's grading actions)
// ---------------------------------------------------------------------------

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
export async function recomputeRanking(admin: Supa, assignmentId: string) {
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

export interface RankRow {
  submission_id: string;
  course_id: string;
  bt_score: number;
  rank: number;
  final_rank: number | null;
}

/** Rankings for an assignment, best first, honouring a materialized order. */
export async function readOrder(admin: Supa, assignmentId: string): Promise<RankRow[]> {
  const { data } = await admin
    .from("rankings")
    .select("submission_id, course_id, bt_score, rank, final_rank")
    .eq("assignment_id", assignmentId);
  const rows = (data ?? []) as RankRow[];
  return (
    slotIntoOrder(rows) ??
    rows.sort((a, b) => (a.final_rank ?? a.rank) - (b.final_rank ?? b.rank))
  );
}

/**
 * Persist an order as final_rank 1..N in one statement. A whole-list rewrite
 * is what keeps positions a permutation; writing them row by row would leave
 * a half-applied order behind if a call failed mid-loop.
 */
export async function writeOrder(
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
 * Freeze the model's draft into the professor's order, once — and slot in
 * any late arrival scored since. Idempotent: a list that is fully placed is
 * left alone. Called lazily from the mutations rather than on render, so
 * looking at the page never writes.
 */
export async function ensureMaterialized(
  admin: Supa,
  assignmentId: string
): Promise<RankRow[]> {
  const rows = await readOrder(admin, assignmentId);
  if (rows.length === 0) return rows;
  if (rows.every((r) => r.final_rank !== null)) return rows;
  await writeOrder(admin, assignmentId, rows);
  return rows.map((row, index) => ({ ...row, final_rank: index + 1 }));
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

interface Lock {
  analysis: AnalysisState;
  token: string;
}

/**
 * Take the chunk lock, conditionally: only if no one holds it AND nothing has
 * written since we read (same lockId, same state). Postgres re-checks the
 * filter after waiting on a concurrent update, so two drivers can't both win.
 */
async function acquireLock(
  admin: Supa,
  assignment: EngineAssignment,
  nextState?: AssignmentState
): Promise<Lock | null> {
  const read = (assignment.analysis ?? {}) as AnalysisState;
  const now = new Date();
  if (read.busyUntil && new Date(read.busyUntil).getTime() > now.getTime()) {
    return null;
  }
  const token = randomUUID();
  const analysis: AnalysisState = {
    ...read,
    busyUntil: new Date(now.getTime() + LOCK_MS).toISOString(),
    lockId: token,
  };
  let query = admin
    .from("assignments")
    .update({
      analysis: analysis as unknown as Record<string, unknown>,
      ...(nextState ? { state: nextState } : {}),
    })
    .eq("id", assignment.id)
    .eq("state", assignment.state)
    .or(`analysis->>busyUntil.is.null,analysis->>busyUntil.lt."${now.toISOString()}"`);
  query = read.lockId
    ? query.eq("analysis->>lockId", read.lockId)
    : query.is("analysis->>lockId", null);
  const { data, error } = await query.select("id");
  if (error) {
    console.error(`[grading] lock failed for ${assignment.id}:`, error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  return { analysis, token };
}

/**
 * Write the chunk's result and release the lock. Lands only if we still hold
 * it — a chunk that overran its lock must not clobber whoever took over.
 */
async function release(
  admin: Supa,
  assignmentId: string,
  lock: Lock,
  patch: AnalysisState,
  state?: AssignmentState
): Promise<boolean> {
  const analysis: AnalysisState = {
    ...lock.analysis,
    ...patch,
    busyUntil: undefined,
    lockId: randomUUID(),
  };
  const { data } = await admin
    .from("assignments")
    .update({
      analysis: analysis as unknown as Record<string, unknown>,
      ...(state ? { state } : {}),
    })
    .eq("id", assignmentId)
    .eq("analysis->>lockId", lock.token)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Change analysis outside a chunk (e.g. the professor's "try again"), under
 * the same version check. False when a chunk is mid-flight.
 */
export async function patchAnalysis(
  admin: Supa,
  assignment: EngineAssignment,
  change: (analysis: AnalysisState) => AnalysisState
): Promise<boolean> {
  const lock = await acquireLock(admin, assignment);
  if (!lock) return false;
  return release(admin, assignment.id, lock, change(lock.analysis));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function loadDoc(admin: Supa, path: string): Promise<DocInput | null> {
  const { data: blob } = await admin.storage.from(ASSIGNMENT_BUCKET).download(path);
  if (!blob) return null;
  const bytes = Buffer.from(await blob.arrayBuffer());
  const kind = docKindFromPath(path);
  if (kind === "png" || kind === "jpeg") {
    const fitted = await fitImageForModel(bytes, kind);
    return { base64: fitted.base64, kind: fitted.kind };
  }
  return { base64: bytes.toString("base64"), kind };
}

interface ScoringContext {
  themes: Array<{ id: string; name: string; description: string; itemQuotes: string[] }>;
  tasteByEnrollment: Map<string, { text: string }>;
  baselines: string[];
}

async function loadScoringContext(
  admin: Supa,
  assignmentId: string,
  analysis: AnalysisState
): Promise<ScoringContext> {
  const [{ data: themes }, { data: tastes }] = await Promise.all([
    admin
      .from("rubric_themes")
      .select("id, name, description, items")
      .eq("assignment_id", assignmentId)
      .order("position"),
    admin
      .from("taste_files")
      .select("enrollment_id, body, criteria, bar_statement")
      .eq("assignment_id", assignmentId),
  ]);
  return {
    themes: (themes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      itemQuotes: ((t.items ?? []) as Array<{ quote: string }>).map((i) => i.quote),
    })),
    tasteByEnrollment: new Map(
      (tastes ?? [])
        .filter((t) => t.enrollment_id !== null)
        .map((t) => [t.enrollment_id as string, { text: tasteProse(t) }])
    ),
    baselines: analysis.baselines ?? [],
  };
}

/**
 * Score a batch in parallel. Each score is written the moment it lands, so a
 * chunk killed mid-batch keeps what it finished. Failures are recorded, never
 * thrown — the queue decides when to retry and when to give up.
 */
async function scoreBatch(
  admin: Supa,
  assignment: EngineAssignment,
  batch: Array<{ id: string; enrollment_id: string; storage_path: string }>,
  context: ScoringContext,
  creds: AiCallCreds,
  failures: Record<string, ScoreFailure>
): Promise<{ texts: Record<string, string>; failures: Record<string, ScoreFailure>; scored: number }> {
  const texts: Record<string, string> = {};
  const nextFailures = { ...failures };
  let scored = 0;
  await Promise.all(
    batch.map(async (sub) => {
      const fail = (error: string) => {
        nextFailures[sub.id] = recordFailure(nextFailures[sub.id], error, new Date());
        console.error(`[grading] couldn't score ${sub.id}: ${error}`);
      };
      try {
        const doc = await loadDoc(admin, sub.storage_path);
        if (!doc) return fail("The file is missing from storage.");
        const score = await scoreSubmission(
          {
            assignmentTitle: assignment.title,
            submission: doc,
            themes: context.themes,
            ownTaste: context.tasteByEnrollment.get(sub.enrollment_id) ?? null,
            baselines: context.baselines,
          },
          creds
        );
        if (!score.ok) return fail(score.error.replace(/ — try again\.?$/, "."));
        const { error } = await admin.from("ai_scores").insert({
          assignment_id: assignment.id,
          course_id: assignment.course_id,
          submission_id: sub.id,
          theme_scores: score.data.themeScores,
          overall: score.data.overall,
          own_bar: score.data.ownBar,
          distinctiveness: score.data.distinctiveness,
          summary: score.data.summary,
        });
        if (error) return fail("Couldn't save the score.");
        delete nextFailures[sub.id];
        texts[sub.id] = score.data.extractedText.slice(0, 8000);
        scored += 1;
      } catch (e) {
        fail(e instanceof Error ? e.message : "Unexpected error.");
      }
    })
  );
  return { texts, failures: nextFailures, scored };
}

// ---------------------------------------------------------------------------
// One chunk
// ---------------------------------------------------------------------------

export async function loadEngineAssignment(
  admin: Supa,
  assignmentId: string
): Promise<EngineAssignment | null> {
  const { data } = await admin
    .from("assignments")
    .select(
      "id, course_id, title, storage_path, deadline, state, settings, analysis, courses!inner(professor_id, grading_defaults)"
    )
    .eq("id", assignmentId)
    .single();
  return (data as EngineAssignment | null) ?? null;
}

type ChunkResult = ActionResult<ChunkData>;

const idle = (phase: string, state: string, scored = 0, total = 0): ChunkResult => ({
  ok: true,
  data: { phase, state, scored, total, worked: false },
});

/**
 * Advance one assignment by one bounded chunk, whoever is asking. Callers
 * authorize first — the tick by its secret, the page by professor check.
 */
export async function runGradingChunk(
  admin: Supa,
  assignmentId: string
): Promise<ChunkResult> {
  const assignment = await loadEngineAssignment(admin, assignmentId);
  if (!assignment) return { ok: false, error: "Assignment not found." };
  const analysis = (assignment.analysis ?? {}) as AnalysisState;
  if (new Date(assignment.deadline).getTime() > Date.now()) {
    return idle("rubric", assignment.state);
  }
  if (PIPELINE_STATES.includes(assignment.state)) {
    return runPipelineChunk(admin, assignment);
  }
  if (GRADED_STATES.includes(assignment.state) && analysis.phase === "done") {
    return runCatchUpChunk(admin, assignment);
  }
  return idle(analysis.phase ?? "done", assignment.state);
}

async function runPipelineChunk(
  admin: Supa,
  assignment: EngineAssignment
): Promise<ChunkResult> {
  const assignmentId = assignment.id;
  const lock = await acquireLock(admin, assignment, "analyzing");
  if (!lock) {
    const { count } = await admin
      .from("ai_scores")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);
    const phase = (assignment.analysis as AnalysisState | null)?.phase ?? "rubric";
    return idle(phase, "analyzing", count ?? 0, -1);
  }
  const analysis = lock.analysis;
  const done = (patch: AnalysisState, state?: AssignmentState) =>
    release(admin, assignmentId, lock, patch, state);
  const worked = (phase: string, state: string, scored: number, total: number): ChunkResult => ({
    ok: true,
    data: { phase, state, scored, total, worked: true },
  });

  const phase = analysis.phase ?? "rubric";
  // The two grading axes drive every branch below: `tasteSource` (instructor
  // taste is the whole corpus, or co-created from the class) and `peerReview`
  // (a peer round, or straight to finalizing). instructor-sourced also skips
  // baselines/distinctiveness; co-created runs a standards-comparison phase.
  const axes = resolveGradingAxes(assignment.settings);
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, enrollment_id, storage_path")
    .eq("assignment_id", assignmentId);
  const total = submissions?.length ?? 0;

  // BYOK preflight: the AI phases run on the course owner's key. No working
  // key → pause in awaiting_key; the next tick checks again, so connecting a
  // key resumes grading with no one watching.
  const taskForPhase: AiTask | null =
    phase === "rubric"
      ? "rubric"
      : phase === "baselines"
        ? "baseline"
        : phase === "scoring" || phase === "standards"
          ? "scoring"
          : null;
  const creds = taskForPhase
    ? await resolveCourseAi(assignment.course_id, taskForPhase)
    : null;
  if (taskForPhase && !creds) {
    await done({}, "awaiting_key");
    return idle(phase, "awaiting_key", 0, total);
  }

  try {
    if (phase === "rubric") {
      let corpus: Array<{ enrollmentId: string | null; text: string }>;
      const { data: tasteRows } = await admin
        .from("taste_files")
        .select("enrollment_id, body, criteria, bar_statement")
        .eq("assignment_id", assignmentId);

      if (axes.tasteSource === "instructor") {
        // The instructor's taste file is the whole corpus. It lives in the
        // professor row now; settings.gradingInstructions is the pre-0037
        // home and stays readable for anything the backfill missed.
        const professorRow = (tasteRows ?? []).find((t) => t.enrollment_id === null);
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
      // No submissions is no longer a reason to stop: late work can still
      // arrive, and it needs a rubric to be scored against.
      if (corpus.length === 0) {
        const idleState = axes.peerReview ? "peer_review" : "finalizing";
        await done({ phase: "done", error: "No taste files to build a rubric from." }, idleState);
        return worked("done", idleState, 0, total);
      }
      const rubric = await emergeRubric(
        { assignmentTitle: assignment.title, tasteFiles: corpus },
        creds!
      );
      if (!rubric.ok) {
        await done({ error: rubric.error });
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
      await done({ phase: "baselines", error: undefined });
      return worked("baselines", "analyzing", 0, total);
    }

    if (phase === "baselines") {
      if (axes.tasteSource === "instructor") {
        // Objective grading: no generic-answer baselines, no distinctiveness.
        await done({ phase: "scoring", baselines: [] });
        return worked("scoring", "analyzing", 0, total);
      }
      const brief = assignment.storage_path
        ? await loadDoc(admin, assignment.storage_path)
        : null;
      const baselines = await generateBaselines(
        { assignmentTitle: assignment.title, brief },
        creds!
      );
      await done({
        phase: "scoring",
        baselines: baselines.ok ? baselines.data : [],
      });
      return worked("scoring", "analyzing", 0, total);
    }

    if (phase === "scoring") {
      const { data: doneScores } = await admin
        .from("ai_scores")
        .select("submission_id")
        .eq("assignment_id", assignmentId);
      const scoredIds = new Set((doneScores ?? []).map((s) => s.submission_id));
      const queue = classifyUnscored({
        submissionIds: (submissions ?? []).map((s) => s.id),
        scoredIds,
        failures: analysis.failures ?? {},
        now: new Date(),
      });

      if (queue.ready.length === 0 && queue.waiting.length === 0) {
        // Everything scored or given up on → standards (co-created: compare
        // each taste to the instructor's); that phase skips straight to
        // shingle when it doesn't apply.
        await done({ phase: "standards" });
        return worked("standards", "analyzing", scoredIds.size, total);
      }
      if (queue.ready.length === 0) {
        // Only backed-off failures left: wait for the next tick.
        await done({});
        return idle("scoring", "analyzing", scoredIds.size, total);
      }

      const byId = new Map((submissions ?? []).map((s) => [s.id, s]));
      const batch = queue.ready.slice(0, SCORE_CONCURRENCY).map((id) => byId.get(id)!);
      const context = await loadScoringContext(admin, assignmentId, analysis);
      const result = await scoreBatch(
        admin,
        assignment,
        batch,
        context,
        creds!,
        analysis.failures ?? {}
      );
      await done({
        phase: "scoring",
        texts: { ...(analysis.texts ?? {}), ...result.texts },
        failures: result.failures,
      });
      return worked("scoring", "analyzing", scoredIds.size + result.scored, total);
    }

    if (phase === "standards") {
      // Compare each student's own taste to the instructor's — is the bar they
      // set for themselves above, at, or below? Only co-created assignments,
      // and only where the instructor has a taste and the student wrote a real
      // (non-default) one; everything else drops straight to shingle so the
      // phase can never stall.
      const advanceToShingle = async () => {
        await done({ phase: "shingle" });
        return worked("shingle", "analyzing", total, total);
      };
      if (axes.tasteSource !== "cocreated") return advanceToShingle();

      const { data: tasteRows } = await admin
        .from("taste_files")
        .select("enrollment_id, body, criteria, bar_statement, is_default_untouched")
        .eq("assignment_id", assignmentId);
      const instructorTaste = tasteProse(
        (tasteRows ?? []).find((t) => t.enrollment_id === null) ?? null
      );
      const defaultTaste = (assignment.settings as { defaultTaste?: unknown }).defaultTaste;
      // enrollment → their own prose, qualifying rows only (their real take,
      // not the AI draft they never touched — comparing the draft to the
      // instructor would be noise).
      const studentTaste = new Map<string, string>();
      for (const t of tasteRows ?? []) {
        if (t.enrollment_id === null) continue;
        if (isUntouchedTaste(t, defaultTaste)) continue;
        const text = tasteProse(t);
        if (text) studentTaste.set(t.enrollment_id, text);
      }
      if (!instructorTaste || studentTaste.size === 0) return advanceToShingle();

      const enrollmentBySub = new Map((submissions ?? []).map((s) => [s.id, s.enrollment_id]));
      const { data: scores } = await admin
        .from("ai_scores")
        .select("id, submission_id, standards_score")
        .eq("assignment_id", assignmentId);
      const pending = (scores ?? []).filter((sc) => {
        if (sc.standards_score !== null) return false;
        const enr = enrollmentBySub.get(sc.submission_id);
        return enr != null && studentTaste.has(enr);
      });
      if (pending.length === 0) return advanceToShingle();

      // A comparison that fails is skipped rather than retried forever: the
      // standards signal is optional, a stalled pipeline is not.
      const attempted = new Set(Object.keys(analysis.failures ?? {}));
      const todo = pending.filter((sc) => !attempted.has(`standards:${sc.id}`));
      if (todo.length === 0) return advanceToShingle();
      const failures = { ...(analysis.failures ?? {}) };
      await Promise.all(
        todo.slice(0, SCORE_CONCURRENCY).map(async (sc) => {
          const enr = enrollmentBySub.get(sc.submission_id);
          const taste = enr ? studentTaste.get(enr) : undefined;
          if (!taste) return;
          const cmp = await compareStandards(
            { assignmentTitle: assignment.title, instructorTaste, studentTaste: taste },
            creds!
          );
          if (!cmp.ok) {
            failures[`standards:${sc.id}`] = recordFailure(undefined, cmp.error, new Date());
            return;
          }
          await admin
            .from("ai_scores")
            .update({ standards_score: cmp.data.bar, standards_note: cmp.data.note })
            .eq("id", sc.id);
        })
      );
      await done({ phase: "standards", failures });
      return worked("standards", "analyzing", total, total);
    }

    if (phase === "shingle") {
      const docs = Object.entries(analysis.texts ?? {}).map(([id, text]) => ({ id, text }));
      const similarPairs = findSimilarPairs(docs);
      await done({ phase: "pairs", similarPairs, texts: {} });
      return worked("pairs", "analyzing", total, total);
    }

    // phase === "pairs": draft ranking + peer pair assignment, then open.
    await recomputeRanking(admin, assignmentId);
    if (!axes.peerReview) {
      // No peer round: the ranking goes straight to the professor, so it is
      // theirs to reorder the moment they see it.
      await ensureMaterialized(admin, assignmentId);
      await done({ phase: "done" }, "finalizing");
      return worked("done", "finalizing", total, total);
    }
    const { data: ranked } = await admin
      .from("rankings")
      .select("submission_id, rank")
      .eq("assignment_id", assignmentId);
    const rankBySub = new Map((ranked ?? []).map((r) => [r.submission_id, r.rank]));
    const pairingInput = (submissions ?? []).map((s) => ({
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
      for (const a of members) for (const b of members) if (a !== b) excluded.add(`${a}|${b}`);
    }

    const settings = resolveSettings(
      (assignment.courses as { grading_defaults: unknown }).grading_defaults,
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
    return worked("done", "peer_review", total, total);
  } catch (e) {
    console.error(`[grading] analysis chunk failed:`, e);
    await done({});
    return { ok: false, error: "Analysis hit a snag — it will resume on the next try." };
  }
}

/**
 * After the pipeline: score late submissions as they arrive and slot each
 * into the ranking. The professor's order, drags included, is kept.
 */
async function runCatchUpChunk(
  admin: Supa,
  assignment: EngineAssignment
): Promise<ChunkResult> {
  const assignmentId = assignment.id;
  const [{ data: submissions }, { data: doneScores }] = await Promise.all([
    admin
      .from("submissions")
      .select("id, enrollment_id, storage_path")
      .eq("assignment_id", assignmentId),
    admin.from("ai_scores").select("submission_id").eq("assignment_id", assignmentId),
  ]);
  const total = submissions?.length ?? 0;
  const scoredIds = new Set((doneScores ?? []).map((s) => s.submission_id));
  const analysis = (assignment.analysis ?? {}) as AnalysisState;
  const queue = classifyUnscored({
    submissionIds: (submissions ?? []).map((s) => s.id),
    scoredIds,
    failures: analysis.failures ?? {},
    now: new Date(),
  });
  if (queue.ready.length === 0) {
    return idle("done", assignment.state, scoredIds.size, total);
  }
  // No key: leave the state alone (the cockpit stays usable) and retry later.
  const creds = await resolveCourseAi(assignment.course_id, "scoring");
  if (!creds) return idle("done", assignment.state, scoredIds.size, total);

  const lock = await acquireLock(admin, assignment);
  if (!lock) return idle("done", assignment.state, scoredIds.size, -1);
  try {
    const byId = new Map((submissions ?? []).map((s) => [s.id, s]));
    const batch = queue.ready.slice(0, SCORE_CONCURRENCY).map((id) => byId.get(id)!);
    const context = await loadScoringContext(admin, assignmentId, lock.analysis);
    const result = await scoreBatch(
      admin,
      assignment,
      batch,
      context,
      creds,
      lock.analysis.failures ?? {}
    );
    if (result.scored > 0) {
      await recomputeRanking(admin, assignmentId);
      // Only a list the professor already owns needs the newcomers placed;
      // a draft (peer review still running) ranks them by the rank column.
      const rows = await readOrder(admin, assignmentId);
      if (rows.some((r) => r.final_rank !== null)) {
        await ensureMaterialized(admin, assignmentId);
      }
    }
    await release(admin, assignmentId, lock, { failures: result.failures });
    return {
      ok: true,
      data: {
        phase: "done",
        state: assignment.state,
        scored: scoredIds.size + result.scored,
        total,
        worked: true,
      },
    };
  } catch (e) {
    console.error(`[grading] catch-up chunk failed:`, e);
    await release(admin, assignmentId, lock, {});
    return { ok: false, error: "Grading late work hit a snag — it will resume on the next try." };
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * Every assignment with grading work waiting: past-deadline and not yet
 * through the pipeline, or graded but with late submissions unscored.
 */
export async function findGradingWork(admin: Supa): Promise<string[]> {
  const now = new Date();
  const [{ data: starting }, { data: graded }] = await Promise.all([
    admin
      .from("assignments")
      .select("id")
      .in("state", PIPELINE_STATES)
      .lt("deadline", now.toISOString())
      .order("deadline"),
    admin
      .from("assignments")
      .select("id, analysis")
      .in("state", GRADED_STATES)
      .eq("analysis->>phase", "done"),
  ]);
  const ids = (starting ?? []).map((a) => a.id);
  for (const a of graded ?? []) {
    const [{ count: subs }, { count: scored }] = await Promise.all([
      admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", a.id),
      admin
        .from("ai_scores")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", a.id),
    ]);
    const failures = ((a.analysis ?? {}) as AnalysisState).failures ?? {};
    // A rough screen: more submissions than scores and set-aside failures.
    // The chunk itself decides precisely.
    const parked = Object.keys(failures).filter((k) => !k.startsWith("standards:")).length;
    if ((subs ?? 0) > (scored ?? 0) + parked) ids.push(a.id);
    else if ((subs ?? 0) > (scored ?? 0)) {
      // Some failures may be past their backoff; let the chunk check.
      const queue = classifyUnscored({
        submissionIds: Object.keys(failures).filter((k) => !k.startsWith("standards:")),
        scoredIds: new Set(),
        failures,
        now,
      });
      if (queue.ready.length > 0) ids.push(a.id);
    }
  }
  return ids;
}

/** Assignments worked side by side per tick (each scores SCORE_CONCURRENCY at once). */
const PARALLEL_ASSIGNMENTS = 2;

/**
 * One tick: keep turning the crank on every assignment with work until the
 * budget runs out. No chunk starts after the budget, and a chunk takes at
 * most ~150s, so the whole tick fits inside a 300s function.
 */
export async function runGradingTick(
  admin: Supa,
  budgetMs = 120_000
): Promise<{ chunks: number; assignments: number; ms: number }> {
  const start = Date.now();
  const queue = await findGradingWork(admin);
  const assignments = queue.length;
  let chunks = 0;
  const worker = async () => {
    while (queue.length > 0 && Date.now() - start < budgetMs) {
      const id = queue.shift()!;
      // Crank this one until it has nothing to do right now.
      while (Date.now() - start < budgetMs) {
        const result = await runGradingChunk(admin, id);
        if (!result.ok || !result.data?.worked) break;
        chunks += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_ASSIGNMENTS }, worker));
  return { chunks, assignments, ms: Date.now() - start };
}
