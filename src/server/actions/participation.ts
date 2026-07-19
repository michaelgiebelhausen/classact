"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  computeWorkReadiness,
  PARTICIPATION_ATTRIBUTES,
  type WorkReadiness,
  type WorkReadinessInput,
} from "@/lib/employability";
import {
  fitWeights,
  parseWeights,
  participationScore,
  weightsToRecord,
  type StudentComparison,
  type WeightedAttribute,
} from "@/lib/participation";
import { summarizeFocus, type FocusEventInput } from "@/lib/focus";
import { summarizeParticipation } from "@/lib/participate";
import { judgingStats, type DecidedComparison } from "@/lib/tastestats";
import { computeMemberStats, type ProjectTaskInput } from "@/lib/projectstats";
import { CONTRACT_TASK_TITLE } from "@/lib/projects";
import { resolveEnrollmentPhotos } from "@/lib/storage";
import type { ActionResult } from "@/server/actions/auth";
import type { PollPhase } from "@/types/db";

/**
 * Metrics dashboard v2 — course-wide signal collection (one batched pass,
 * computed per student in memory) powering both the student dashboard and
 * the professor's participation cockpit. Spec: docs/metrics-dashboard-plan.md.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface StudentSignalBundle {
  input: WorkReadinessInput;
  /** Dashboard extras beyond the competency inputs. */
  extras: {
    firstCorrect: number;
    answered: number;
    changedToCorrect: number;
    groupsJoined: number;
    groupAnswersWritten: number;
    onTaskRate: number | null;
    lecturesFollowed: number;
    driftCount: number;
    assignmentsSubmitted: number;
    avgDistinctiveness: number | null;
    avgOwnBar: number | null;
    avgTasteAgreement: number | null;
    avgSelfHonesty: number | null;
    medianHoursBeforeDeadline: number | null;
    rubricMinutes: number;
    shoutOutsReceived: number;
    shoutOutsGiven: number;
    /** Peer-review shout-outs that hit top-quartile work / total given there. */
    spotsExcellence: { hits: number; given: number };
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One batched pass over every signal table, bucketed per enrollment. */
async function buildCourseSignals(
  admin: Admin,
  courseId: string
): Promise<Map<string, StudentSignalBundle>> {
  const { data: sessions } = await admin
    .from("class_sessions")
    .select("id")
    .eq("course_id", courseId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  const [
    { data: checkIns },
    { data: verifications },
    { data: rounds },
    { data: answers },
    { data: exerciseMembers },
    { data: exerciseResponses },
    { data: lectures },
    { data: teamMembers },
    { data: teamTasks },
    { data: taskFlags },
    { data: signatures },
    { data: assignments },
    { data: tasteFiles },
    { data: submissions },
    { data: aiScores },
    { data: comparisons },
    { data: rankings },
    { data: rubricViews },
    { data: shoutOuts },
    { data: enrollments },
  ] = await Promise.all([
    sessionIds.length > 0
      ? admin
          .from("check_ins")
          .select("enrollment_id, verified, is_new_seat, session_id")
          .in("session_id", sessionIds)
      : Promise.resolve({ data: [] as never[] }),
    sessionIds.length > 0
      ? admin
          .from("seat_verifications")
          .select("verifier_enrollment_id, subject_enrollment_id, session_id")
          .in("session_id", sessionIds)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from("poll_rounds")
      .select("id, correct_indices")
      .eq("course_id", courseId)
      .eq("stage", "closed"),
    admin.from("poll_answers").select("round_id, enrollment_id, phase, choice"),
    admin
      .from("exercise_group_members")
      .select("group_id, enrollment_id")
      .eq("course_id", courseId),
    admin
      .from("exercise_responses")
      .select("group_id, updated_by_enrollment_id")
      .eq("course_id", courseId),
    admin
      .from("lectures")
      .select("id, started_at, ended_at")
      .eq("course_id", courseId)
      .not("ended_at", "is", null),
    admin
      .from("project_team_members")
      .select("team_id, enrollment_id, role, project_teams!inner(course_id)")
      .eq("project_teams.course_id", courseId),
    admin
      .from("team_tasks")
      .select(
        "id, team_id, status, estimated_minutes, actual_minutes, assigned_enrollment_id, assigned_by_enrollment_id, title"
      )
      .eq("course_id", courseId),
    admin
      .from("task_flags")
      .select("team_task_id")
      .is("resolved_at", null)
      .eq("course_id", courseId),
    admin.from("team_contract_signatures").select("team_id, enrollment_id"),
    admin
      .from("assignments")
      .select("id, deadline, published_at")
      .eq("course_id", courseId),
    admin
      .from("taste_files")
      .select("assignment_id, enrollment_id, is_default_untouched")
      .eq("course_id", courseId),
    admin
      .from("submissions")
      .select("id, assignment_id, enrollment_id, last_edit_at")
      .eq("course_id", courseId),
    admin
      .from("ai_scores")
      .select("submission_id, own_bar, distinctiveness")
      .eq("course_id", courseId),
    admin
      .from("comparisons")
      .select(
        "id, assignment_id, judge_enrollment_id, left_submission_id, right_submission_id, verdict, pair_type"
      )
      .eq("course_id", courseId),
    admin
      .from("rankings")
      .select("assignment_id, submission_id, rank")
      .eq("course_id", courseId),
    admin.from("rubric_views").select("enrollment_id, seconds").eq("course_id", courseId),
    admin
      .from("shout_outs")
      .select("giver_enrollment_id, recipient_enrollment_id, context, context_id")
      .eq("course_id", courseId),
    admin
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("status", "active"),
  ]);

  const roundIds = new Set((rounds ?? []).map((r) => r.id));
  const courseAnswers = (answers ?? []).filter((a) => roundIds.has(a.round_id));
  const lectureById = new Map((lectures ?? []).map((l) => [l.id, l]));
  const lectureIds = [...lectureById.keys()];
  const { data: focusEvents } =
    lectureIds.length > 0
      ? await admin
          .from("focus_events")
          .select("lecture_id, enrollment_id, event_type, occurred_at")
          .in("lecture_id", lectureIds)
      : { data: [] as never[] };

  const teamIdSet = new Set((teamMembers ?? []).map((m) => m.team_id));
  const courseSignatures = (signatures ?? []).filter((s) => teamIdSet.has(s.team_id));
  const publishedAssignments = new Set(
    (assignments ?? []).filter((a) => a.published_at !== null).map((a) => a.id)
  );
  const deadlineByAssignment = new Map(
    (assignments ?? []).map((a) => [a.id, new Date(a.deadline).getTime()])
  );
  const scoreBySubmission = new Map(
    (aiScores ?? []).map((s) => [s.submission_id, s])
  );
  const rankBySubmission = new Map(
    (rankings ?? []).map((r) => [r.submission_id, r.rank])
  );
  const rankedCountByAssignment = new Map<string, number>();
  for (const r of rankings ?? []) {
    rankedCountByAssignment.set(
      r.assignment_id,
      (rankedCountByAssignment.get(r.assignment_id) ?? 0) + 1
    );
  }
  const comparisonById = new Map((comparisons ?? []).map((c) => [c.id, c]));

  const flaggedTaskIds = new Set((taskFlags ?? []).map((f) => f.team_task_id));
  const taskInputsByTeam = new Map<string, ProjectTaskInput[]>();
  for (const t of teamTasks ?? []) {
    const list = taskInputsByTeam.get(t.team_id) ?? [];
    list.push({
      teamId: t.team_id,
      assignedEnrollmentId: t.assigned_enrollment_id,
      assignedByEnrollmentId: t.assigned_by_enrollment_id,
      status: t.status,
      estimatedMinutes: t.estimated_minutes,
      actualMinutes: t.actual_minutes,
      isContract: t.title === CONTRACT_TASK_TITLE,
      hasOpenFlag: flaggedTaskIds.has(t.id),
    });
    taskInputsByTeam.set(t.team_id, list);
  }
  // Per-team member stats via the shared engine, computed once per team.
  const membersByTeam = new Map<string, Array<{ enrollmentId: string; teamId: string }>>();
  for (const m of teamMembers ?? []) {
    const list = membersByTeam.get(m.team_id) ?? [];
    list.push({ enrollmentId: m.enrollment_id, teamId: m.team_id });
    membersByTeam.set(m.team_id, list);
  }
  const statsByTeamMember = new Map<string, ReturnType<typeof computeMemberStats>[number]>();
  for (const [teamId, members] of membersByTeam) {
    const stats = computeMemberStats(members, taskInputsByTeam.get(teamId) ?? []);
    for (const s of stats) statsByTeamMember.set(`${teamId}|${s.enrollmentId}`, s);
  }

  const bundles = new Map<string, StudentSignalBundle>();
  for (const enrollment of enrollments ?? []) {
    const eid = enrollment.id;

    const myCheckIns = (checkIns ?? []).filter((c) => c.enrollment_id === eid);
    const myVerifs = (verifications ?? []).filter(
      (v) => v.verifier_enrollment_id === eid || v.subject_enrollment_id === eid
    );
    const peopleMet = new Set(
      myVerifs.map((v) =>
        v.verifier_enrollment_id === eid
          ? v.subject_enrollment_id
          : v.verifier_enrollment_id
      )
    ).size;
    const neighborsVerified = (verifications ?? []).filter(
      (v) => v.verifier_enrollment_id === eid
    ).length;

    const myAnswers = courseAnswers
      .filter((a) => a.enrollment_id === eid)
      .map((a) => ({
        round_id: a.round_id,
        phase: a.phase as PollPhase,
        choice: a.choice,
      }));
    const tps = summarizeParticipation(rounds ?? [], myAnswers);

    const myGroups = (exerciseMembers ?? []).filter((m) => m.enrollment_id === eid);
    const groupAnswersWritten = (exerciseResponses ?? []).filter(
      (r) => r.updated_by_enrollment_id === eid
    ).length;

    // Focus: per lecture the student followed (has any events).
    const myFocusByLecture = new Map<string, FocusEventInput[]>();
    for (const f of focusEvents ?? []) {
      if (f.enrollment_id !== eid) continue;
      const list = myFocusByLecture.get(f.lecture_id) ?? [];
      list.push({
        enrollment_id: f.enrollment_id,
        event_type: f.event_type,
        occurred_at: f.occurred_at,
      });
      myFocusByLecture.set(f.lecture_id, list);
    }
    let lectureMs = 0;
    let awayMs = 0;
    let driftCount = 0;
    for (const [lectureId, events] of myFocusByLecture) {
      const lecture = lectureById.get(lectureId);
      if (!lecture?.ended_at) continue;
      const end = new Date(lecture.ended_at);
      const duration = end.getTime() - new Date(lecture.started_at).getTime();
      if (duration <= 0) continue;
      const summary = summarizeFocus(events, end);
      lectureMs += duration;
      awayMs += Math.min(summary.awayMs, duration);
      driftCount += summary.awayCount;
    }
    const lecturesFollowed = myFocusByLecture.size;
    const onTaskRate =
      lectureMs > 0 ? Math.max(0, Math.min(1, 1 - awayMs / lectureMs)) : null;

    // Projects via the shared engine.
    let doneMinutes = 0;
    let doneTasks = 0;
    let biggestTaskMinutes = 0;
    let distributedTasks = 0;
    let selfAssignedTasks = 0;
    let flaggedTasks = 0;
    const shares: number[] = [];
    const myTeams = (teamMembers ?? []).filter((m) => m.enrollment_id === eid);
    for (const membership of myTeams) {
      const stats = statsByTeamMember.get(`${membership.team_id}|${eid}`);
      if (!stats) continue;
      doneMinutes += stats.doneMinutes;
      doneTasks += stats.doneTasks;
      biggestTaskMinutes = Math.max(biggestTaskMinutes, stats.biggestTaskMinutes);
      distributedTasks += stats.distributedTasks;
      selfAssignedTasks += stats.selfAssignedTasks;
      flaggedTasks += stats.flaggedTasks;
      if (stats.shareOfTeamDone > 0) shares.push(stats.shareOfTeamDone);
    }
    const leadRoles = myTeams.filter((m) => m.role === "lead").length;
    const contractsSigned = courseSignatures.filter(
      (s) => s.enrollment_id === eid
    ).length;

    // Assignments.
    const mySubmissions = (submissions ?? []).filter((s) => s.enrollment_id === eid);
    const myTastes = (tasteFiles ?? []).filter((t) => t.enrollment_id === eid);
    const submittedAssignmentIds = new Set(mySubmissions.map((s) => s.assignment_id));
    const tastesSharpened = myTastes.filter(
      (t) => !t.is_default_untouched && submittedAssignmentIds.has(t.assignment_id)
    ).length;
    const ownBars: number[] = [];
    const distinctivenesses: number[] = [];
    const hoursBefore: number[] = [];
    for (const sub of mySubmissions) {
      const score = scoreBySubmission.get(sub.id);
      if (score?.own_bar !== null && score?.own_bar !== undefined) {
        ownBars.push(Number(score.own_bar));
      }
      if (score?.distinctiveness !== null && score?.distinctiveness !== undefined) {
        distinctivenesses.push(Number(score.distinctiveness));
      }
      const deadline = deadlineByAssignment.get(sub.assignment_id);
      if (deadline) {
        hoursBefore.push(
          (deadline - new Date(sub.last_edit_at).getTime()) / 3_600_000
        );
      }
    }

    // Judging across published assignments.
    const myDecided: DecidedComparison[] = [];
    let assignedPairs = 0;
    const mySubmissionByAssignment = new Map(
      mySubmissions.map((s) => [s.assignment_id, s.id])
    );
    for (const c of comparisons ?? []) {
      if (c.judge_enrollment_id !== eid) continue;
      if (!publishedAssignments.has(c.assignment_id)) continue;
      assignedPairs += 1;
      if (c.verdict === null) continue;
      myDecided.push({
        leftSubmissionId: c.left_submission_id,
        rightSubmissionId: c.right_submission_id,
        verdict: c.verdict,
        pairType:
          c.pair_type === "self"
            ? "self"
            : c.pair_type === "exceptional"
              ? "exceptional"
              : "refine",
        judgeSubmissionId: mySubmissionByAssignment.get(c.assignment_id) ?? null,
      });
    }
    const judge = judgingStats(
      myDecided,
      assignedPairs,
      rankBySubmission as ReadonlyMap<string, number>
    );
    const rubricSeconds = (rubricViews ?? [])
      .filter((r) => r.enrollment_id === eid)
      .reduce((s, r) => s + r.seconds, 0);

    // Shout-outs (+ spots-excellence bets).
    const received = (shoutOuts ?? []).filter(
      (s) => s.recipient_enrollment_id === eid
    ).length;
    const givenAll = (shoutOuts ?? []).filter((s) => s.giver_enrollment_id === eid);
    let spotHits = 0;
    let spotGiven = 0;
    for (const s of givenAll) {
      if (s.context !== "peer_review" || !s.context_id) continue;
      const comparison = comparisonById.get(s.context_id);
      if (!comparison || !publishedAssignments.has(comparison.assignment_id)) continue;
      spotGiven += 1;
      const recipientSub = (submissions ?? []).find(
        (sub) =>
          sub.assignment_id === comparison.assignment_id &&
          sub.enrollment_id === s.recipient_enrollment_id
      );
      const rank = recipientSub ? rankBySubmission.get(recipientSub.id) : undefined;
      const total = rankedCountByAssignment.get(comparison.assignment_id) ?? 0;
      if (rank !== undefined && total > 0 && rank <= Math.ceil(total / 4)) {
        spotHits += 1;
      }
    }

    const input: WorkReadinessInput = {
      sessionsHeld: sessionIds.length,
      sessionsAttended: myCheckIns.length,
      verifiedAttendances: myCheckIns.filter((c) => c.verified).length,
      newSeats: myCheckIns.filter((c) => c.is_new_seat).length,
      peopleMet,
      neighborsVerified,
      exercisesJoined: myGroups.length,
      answered: tps.answered,
      changedToCorrect: tps.changedToCorrect,
      teams: myTeams.length,
      contractsSigned,
      leadRoles,
      doneMinutes,
      doneTasks,
      biggestTaskMinutes,
      distributedTasks,
      selfAssignedTasks,
      flaggedTasks,
      avgShareOfTeam: mean(shares) ?? 0,
      lecturesFollowed,
      onTaskRate,
      firstCorrect: tps.firstCorrect,
      groupAnswersWritten,
      assignmentsSubmitted: mySubmissions.length,
      tastesSharpened,
      avgOwnBar: mean(ownBars),
      avgDistinctiveness: mean(distinctivenesses),
      avgTasteAgreement: judge.tasteAgreement,
      avgSelfHonesty: judge.selfHonesty,
      peerPairsAssigned: assignedPairs,
      peerPairsDone: myDecided.length,
      rubricMinutes: Math.round(rubricSeconds / 60),
      shoutOutsReceived: received,
      shoutOutsGiven: givenAll.length,
    };

    bundles.set(eid, {
      input,
      extras: {
        firstCorrect: tps.firstCorrect,
        answered: tps.answered,
        changedToCorrect: tps.changedToCorrect,
        groupsJoined: myGroups.length,
        groupAnswersWritten,
        onTaskRate,
        lecturesFollowed,
        driftCount,
        assignmentsSubmitted: mySubmissions.length,
        avgDistinctiveness: mean(distinctivenesses),
        avgOwnBar: mean(ownBars),
        avgTasteAgreement: judge.tasteAgreement,
        avgSelfHonesty: judge.selfHonesty,
        medianHoursBeforeDeadline: median(hoursBefore),
        rubricMinutes: Math.round(rubricSeconds / 60),
        shoutOutsReceived: received,
        shoutOutsGiven: givenAll.length,
        spotsExcellence: { hits: spotHits, given: spotGiven },
      },
    });
  }
  return bundles;
}

// ---------------------------------------------------------------------------
// Student dashboard v2
// ---------------------------------------------------------------------------

export interface MyMetricsV2 {
  workReadiness: WorkReadiness;
  extras: StudentSignalBundle["extras"];
  shoutOutsReceived: Array<{ message: string; context: string; createdAt: string }>;
}

export async function getMyMetricsV2(
  courseId: string
): Promise<MyMetricsV2 | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isConfigured.supabaseAdmin) return null;
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return null;

  const admin = createAdminClient();
  const bundles = await buildCourseSignals(admin, courseId);
  const mine = bundles.get(enrollment.id);
  if (!mine) return null;

  const { data: myShoutOuts } = await supabase
    .from("shout_outs")
    .select("message, context, created_at")
    .eq("course_id", courseId)
    .eq("recipient_enrollment_id", enrollment.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    workReadiness: computeWorkReadiness(mine.input),
    extras: mine.extras,
    shoutOutsReceived: (myShoutOuts ?? []).map((s) => ({
      message: s.message,
      context: s.context,
      createdAt: s.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Professor participation cockpit
// ---------------------------------------------------------------------------

export interface CockpitParticipant {
  enrollmentId: string;
  name: string;
  photoUrl: string | null;
  scores: Record<string, number>;
  participation: number;
  flagged: boolean;
}

export interface ParticipationCockpitData {
  attributes: Array<{ key: string; label: string }>;
  weights: WeightedAttribute[];
  fittedWeights: WeightedAttribute[] | null;
  comparisonCount: number;
  participants: CockpitParticipant[];
  flags: Array<{ id: string; enrollmentId: string; reason: string; createdAt: string }>;
}

async function requireProfessor(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, course: null };
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id, participation_weights")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { supabase, user, course: null };
  }
  return { supabase, user, course };
}

export async function getParticipationCockpit(
  courseId: string
): Promise<ParticipationCockpitData | null> {
  const { course } = await requireProfessor(courseId);
  if (!course || !isConfigured.supabaseAdmin) return null;
  const admin = createAdminClient();

  const [bundles, { data: enrollments }, { data: comparisons }, { data: flags }] =
    await Promise.all([
      buildCourseSignals(admin, courseId),
      admin
        .from("enrollments")
        .select("id, roster_name, profile_id, roster_photo_path")
        .eq("course_id", courseId)
        .eq("status", "active"),
      admin
        .from("participation_comparisons")
        .select("left_enrollment_id, right_enrollment_id, verdict")
        .eq("course_id", courseId),
      admin
        .from("student_flags")
        .select("id, enrollment_id, reason, created_at")
        .eq("course_id", courseId)
        .is("resolved_at", null),
    ]);

  const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);
  const weights = parseWeights(course.participation_weights, PARTICIPATION_ATTRIBUTES);

  const scoresByEnrollment = new Map<string, Record<string, number>>();
  for (const [eid, bundle] of bundles) {
    const readiness = computeWorkReadiness(bundle.input);
    scoresByEnrollment.set(
      eid,
      Object.fromEntries(readiness.competencies.map((c) => [c.key, c.score]))
    );
  }

  const flaggedEnrollments = new Set((flags ?? []).map((f) => f.enrollment_id));
  const participants: CockpitParticipant[] = (enrollments ?? [])
    .filter((e) => scoresByEnrollment.has(e.id))
    .map((e) => {
      const scores = scoresByEnrollment.get(e.id)!;
      return {
        enrollmentId: e.id,
        name: e.roster_name,
        photoUrl: photoMap.get(e.id)?.[0] ?? null,
        scores,
        participation: participationScore(scores, weights),
        flagged: flaggedEnrollments.has(e.id),
      };
    })
    .sort((a, b) => b.participation - a.participation);

  const comparisonInputs: StudentComparison[] = (comparisons ?? [])
    .map((c) => ({
      left: scoresByEnrollment.get(c.left_enrollment_id) ?? {},
      right: scoresByEnrollment.get(c.right_enrollment_id) ?? {},
      verdict: c.verdict,
    }))
    .filter(
      (c) => Object.keys(c.left).length > 0 && Object.keys(c.right).length > 0
    );
  const decisive = comparisonInputs.filter((c) => c.verdict !== 0).length;
  const fitted =
    decisive >= 3
      ? fitWeights(comparisonInputs, PARTICIPATION_ATTRIBUTES, weights)
      : null;

  return {
    attributes: PARTICIPATION_ATTRIBUTES,
    weights,
    fittedWeights: fitted,
    comparisonCount: (comparisons ?? []).length,
    participants,
    flags: (flags ?? []).map((f) => ({
      id: f.id,
      enrollmentId: f.enrollment_id,
      reason: f.reason,
      createdAt: f.created_at,
    })),
  };
}

/** Professor: persist participation weights (from sliders or the fitted set). */
export async function saveParticipationWeights(
  courseId: string,
  weights: Record<string, number>
): Promise<ActionResult> {
  const { supabase, course } = await requireProfessor(courseId);
  if (!course) return { ok: false, error: "Professor only." };
  const normalized = weightsToRecord(
    parseWeights(weights, PARTICIPATION_ATTRIBUTES)
  );
  const { error } = await supabase
    .from("courses")
    .update({ participation_weights: normalized })
    .eq("id", courseId);
  if (error) return { ok: false, error: "Couldn't save weights." };
  revalidatePath(`/course/${courseId}/metrics`);
  return { ok: true };
}

/** Professor: record a side-by-side student comparison (the conjoint). */
export async function compareStudents(
  courseId: string,
  leftEnrollmentId: string,
  rightEnrollmentId: string,
  verdict: number
): Promise<ActionResult> {
  if (!Number.isInteger(verdict) || verdict < -2 || verdict > 2) {
    return { ok: false, error: "Invalid verdict." };
  }
  if (leftEnrollmentId === rightEnrollmentId) {
    return { ok: false, error: "Pick two different students." };
  }
  const { supabase, course } = await requireProfessor(courseId);
  if (!course) return { ok: false, error: "Professor only." };
  const { error } = await supabase.from("participation_comparisons").insert({
    course_id: courseId,
    left_enrollment_id: leftEnrollmentId,
    right_enrollment_id: rightEnrollmentId,
    verdict,
  });
  if (error) return { ok: false, error: "Couldn't record the comparison." };
  revalidatePath(`/course/${courseId}/metrics`);
  return { ok: true };
}

/** Professor: flag suspected gaming / maladaptive behavior. */
export async function flagStudent(
  courseId: string,
  enrollmentId: string,
  reason: string
): Promise<ActionResult> {
  const { supabase, course } = await requireProfessor(courseId);
  if (!course) return { ok: false, error: "Professor only." };
  const { error } = await supabase.from("student_flags").insert({
    course_id: courseId,
    enrollment_id: enrollmentId,
    reason: reason.trim().slice(0, 500),
  });
  if (error) return { ok: false, error: "Couldn't flag." };
  revalidatePath(`/course/${courseId}/metrics`);
  return { ok: true };
}

export async function resolveStudentFlag(
  courseId: string,
  flagId: string
): Promise<ActionResult> {
  const { supabase, course } = await requireProfessor(courseId);
  if (!course) return { ok: false, error: "Professor only." };
  const { error } = await supabase
    .from("student_flags")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", flagId)
    .eq("course_id", courseId);
  if (error) return { ok: false, error: "Couldn't resolve the flag." };
  revalidatePath(`/course/${courseId}/metrics`);
  return { ok: true };
}
