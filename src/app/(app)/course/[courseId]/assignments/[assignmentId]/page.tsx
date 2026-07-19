import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";
import { resolveSettings } from "@/lib/tastegrading";
import { judgingStats, type DecidedComparison } from "@/lib/tastestats";
import { Card, CardContent } from "@/components/ui/card";
import { SubmissionEditor } from "@/components/features/assignments/SubmissionEditor";
import { AnalysisRunner } from "@/components/features/assignments/AnalysisRunner";
import {
  PeerReview,
  type PeerPairView,
} from "@/components/features/assignments/PeerReview";
import {
  GradingCockpit,
  type CockpitStudent,
} from "@/components/features/assignments/GradingCockpit";
import { StudentReport } from "@/components/features/assignments/StudentReport";
import type { TasteCriterion, ThemeScore } from "@/types/db";

/**
 * Tasty Grading — one assignment, routed by role and lifecycle state:
 * student: submit → wait → judge pairs → read the report;
 * professor: watch → analyze → cockpit → publish.
 */

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, course_id, title, deadline, peer_close_at, settings, state, analysis, published_at, courses!inner(name, professor_id, grading_defaults)"
    )
    .eq("id", assignmentId)
    .eq("course_id", courseId)
    .single();
  if (!assignment) notFound();
  const courseMeta = assignment.courses as unknown as {
    name: string;
    professor_id: string;
    grading_defaults: unknown;
  };
  const isProfessor = courseMeta.professor_id === profile.id;
  const settings = resolveSettings(courseMeta.grading_defaults, assignment.settings);

  const now = new Date();
  const deadlinePassed = new Date(assignment.deadline) < now;
  const peerClosed = new Date(assignment.peer_close_at) < now;
  const analyzing =
    (assignment.state === "open" && deadlinePassed) || assignment.state === "analyzing";

  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  const enrollmentId = myEnrollment?.id ?? null;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{assignment.title}</h1>
      <p className="text-sm text-muted-foreground">
        {courseMeta.name} · due {new Date(assignment.deadline).toLocaleString()}
      </p>
    </div>
  );

  // ---------- Analyzing (either role) ----------
  if (analyzing) {
    return (
      <div className="grid gap-6">
        {header}
        <AnalysisRunner assignmentId={assignmentId} />
      </div>
    );
  }

  // ---------- Professor ----------
  if (isProfessor) {
    if (assignment.state === "open") {
      const [{ count: submitted }, { count: tastes }] = await Promise.all([
        supabase
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", assignmentId),
        supabase
          .from("taste_files")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", assignmentId)
          .not("enrollment_id", "is", null),
      ]);
      return (
        <div className="grid gap-6">
          {header}
          <Card>
            <CardContent className="grid gap-1 py-10 text-center">
              <p className="font-medium">
                {submitted ?? 0} submissions · {tastes ?? 0} taste files started
              </p>
              <p className="text-sm text-muted-foreground">
                At the deadline the AI reads the class&apos;s taste files,
                builds the rubric, drafts the ranking, and opens peer
                grading — nothing for you to do until then.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Cockpit states: peer_review / finalizing / published.
    const [{ data: rankRows }, { data: subRows }, { data: comparisonRows }] =
      await Promise.all([
        supabase
          .from("rankings")
          .select("submission_id, bt_score, rank, letter")
          .eq("assignment_id", assignmentId),
        supabase
          .from("submissions")
          .select("id, enrollment_id")
          .eq("assignment_id", assignmentId),
        supabase
          .from("comparisons")
          .select("left_submission_id, right_submission_id, judge_enrollment_id, verdict")
          .eq("assignment_id", assignmentId),
      ]);

    const directory = new Map<string, { name: string; photoUrl: string | null }>();
    if (isConfigured.supabaseAdmin) {
      const admin = createAdminClient();
      const { data: enrollments } = await admin
        .from("enrollments")
        .select("id, roster_name, profile_id, roster_photo_path")
        .eq("course_id", courseId);
      const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);
      for (const e of enrollments ?? []) {
        directory.set(e.id, {
          name: e.roster_name,
          photoUrl: photoMap.get(e.id)?.[0] ?? null,
        });
      }
    }

    const enrollmentBySub = new Map(
      (subRows ?? []).map((s) => [s.id, s.enrollment_id])
    );
    const touch = new Map<string, number>();
    let decidedPeerVotes = 0;
    let totalPeerPairs = 0;
    for (const c of comparisonRows ?? []) {
      if (c.judge_enrollment_id !== null) {
        totalPeerPairs += 1;
        if (c.verdict !== null) decidedPeerVotes += 1;
      }
      if (c.verdict !== null) {
        touch.set(c.left_submission_id, (touch.get(c.left_submission_id) ?? 0) + 1);
        touch.set(c.right_submission_id, (touch.get(c.right_submission_id) ?? 0) + 1);
      }
    }
    const students: CockpitStudent[] = (rankRows ?? [])
      .map((r) => {
        const enrollment = enrollmentBySub.get(r.submission_id);
        const person = enrollment ? directory.get(enrollment) : undefined;
        return {
          submissionId: r.submission_id,
          name: person?.name ?? "Student",
          photoUrl: person?.photoUrl ?? null,
          score: Number(r.bt_score),
          rank: r.rank,
          letter: r.letter,
          comparisons: touch.get(r.submission_id) ?? 0,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    const similarRaw =
      ((assignment.analysis as Record<string, unknown>).similarPairs as Array<{
        aId: string;
        bId: string;
        similarity: number;
      }>) ?? [];
    const nameOfSub = (id: string) => {
      const enrollment = enrollmentBySub.get(id);
      return (enrollment && directory.get(enrollment)?.name) || "Unknown";
    };
    const similarPairs = similarRaw.map((p) => ({
      aName: nameOfSub(p.aId),
      bName: nameOfSub(p.bId),
      similarity: p.similarity,
    }));

    return (
      <div className="grid gap-6">
        {header}
        <GradingCockpit
          assignmentId={assignmentId}
          state={
            peerClosed && assignment.state === "peer_review"
              ? "finalizing"
              : assignment.state
          }
          peerCloseAt={assignment.peer_close_at}
          students={students}
          initialCutPoints={settings.cutPoints}
          similarPairs={similarPairs}
          decidedPeerVotes={decidedPeerVotes}
          totalPeerPairs={totalPeerPairs}
          published={assignment.state === "published"}
        />
      </div>
    );
  }

  // ---------- Student ----------
  if (!enrollmentId) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            You&apos;re not on this course&apos;s active roster.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (assignment.state === "open") {
    const [{ data: taste }, { data: submission }] = await Promise.all([
      supabase
        .from("taste_files")
        .select("criteria, bar_statement, is_default_untouched")
        .eq("assignment_id", assignmentId)
        .eq("enrollment_id", enrollmentId)
        .maybeSingle(),
      supabase
        .from("submissions")
        .select("submitted_at, note")
        .eq("assignment_id", assignmentId)
        .eq("enrollment_id", enrollmentId)
        .maybeSingle(),
    ]);
    const defaultTaste = (
      assignment.settings as {
        defaultTaste?: { criteria: TasteCriterion[]; barStatement: string };
      }
    ).defaultTaste;
    return (
      <div className="grid gap-6">
        {header}
        <SubmissionEditor
          courseId={courseId}
          assignmentId={assignmentId}
          enrollmentId={enrollmentId}
          deadline={assignment.deadline}
          initialCriteria={
            (taste?.criteria as TasteCriterion[] | undefined) ??
            defaultTaste?.criteria ??
            []
          }
          initialBar={taste?.bar_statement ?? defaultTaste?.barStatement ?? ""}
          tasteIsDefault={taste ? taste.is_default_untouched : true}
          submittedAt={submission?.submitted_at ?? null}
          submissionNote={submission?.note ?? ""}
        />
      </div>
    );
  }

  if (assignment.state === "peer_review" && !peerClosed) {
    const [{ data: themes }, { data: myPairs }, { data: mySubmission }] =
      await Promise.all([
        supabase
          .from("rubric_themes")
          .select("id, name, description, provenance, items")
          .eq("assignment_id", assignmentId)
          .order("position"),
        supabase
          .from("comparisons")
          .select(
            "id, pair_type, position, verdict, left_submission_id, right_submission_id"
          )
          .eq("assignment_id", assignmentId)
          .eq("judge_enrollment_id", enrollmentId),
        supabase
          .from("submissions")
          .select("id")
          .eq("assignment_id", assignmentId)
          .eq("enrollment_id", enrollmentId)
          .maybeSingle(),
      ]);
    const mySubId = mySubmission?.id ?? null;
    const pairViews: PeerPairView[] = (myPairs ?? []).map((p) => ({
      comparisonId: p.id,
      pairType: p.pair_type,
      position: p.position,
      verdict: p.verdict,
      containsMine:
        mySubId !== null &&
        (p.left_submission_id === mySubId || p.right_submission_id === mySubId),
      mineIsRight: mySubId !== null && p.right_submission_id === mySubId,
    }));
    return (
      <div className="grid gap-6">
        {header}
        {pairViews.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Peer grading is running, but you have no assigned pairs
              {mySubId ? "" : " (you didn't submit this time)"}.
            </CardContent>
          </Card>
        ) : (
          <PeerReview
            assignmentId={assignmentId}
            themes={(themes ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              provenance: t.provenance,
              quotes: ((t.items ?? []) as Array<{ quote: string }>).map(
                (i) => i.quote
              ),
            }))}
            pairs={pairViews}
            peerCloseAt={assignment.peer_close_at}
          />
        )}
      </div>
    );
  }

  if (assignment.state !== "published") {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Peer grading has closed. Your professor is doing the final
            review — your report appears the moment they publish.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Published: the full private report.
  const { data: mySubmission } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (!mySubmission) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Grades are out, but you didn&apos;t submit for this assignment.
          </CardContent>
        </Card>
      </div>
    );
  }
  const [
    { data: myRanking },
    { count: totalRanked },
    { data: myScore },
    { data: themes },
    { data: myDecided },
    { count: myAssignedCount },
    { data: rubricView },
  ] = await Promise.all([
    supabase
      .from("rankings")
      .select("rank, letter")
      .eq("submission_id", mySubmission.id)
      .maybeSingle(),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId),
    supabase
      .from("ai_scores")
      .select("theme_scores, own_bar, distinctiveness, summary")
      .eq("submission_id", mySubmission.id)
      .maybeSingle(),
    supabase
      .from("rubric_themes")
      .select("id, name")
      .eq("assignment_id", assignmentId),
    supabase
      .from("comparisons")
      .select("left_submission_id, right_submission_id, verdict, pair_type")
      .eq("assignment_id", assignmentId)
      .eq("judge_enrollment_id", enrollmentId)
      .not("verdict", "is", null),
    supabase
      .from("comparisons")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("judge_enrollment_id", enrollmentId),
    supabase
      .from("rubric_views")
      .select("seconds")
      .eq("assignment_id", assignmentId)
      .eq("enrollment_id", enrollmentId)
      .maybeSingle(),
  ]);

  // Judging stats need rank positions for compared submissions. RLS hides
  // other rankings from students, so resolve positions via admin —
  // identities never leave the server (FERPA: positions only).
  const rankOf = new Map<string, number>();
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: allRanks } = await admin
      .from("rankings")
      .select("submission_id, rank")
      .eq("assignment_id", assignmentId);
    for (const r of allRanks ?? []) rankOf.set(r.submission_id, r.rank);
  }

  const themeName = new Map((themes ?? []).map((t) => [t.id, t.name]));
  const themeScores = (((myScore?.theme_scores ?? []) as ThemeScore[]) ?? []).map(
    (t) => ({
      name: themeName.get(t.themeId) ?? "Theme",
      score: t.score,
      evidence: t.evidence,
    })
  );
  const decided: DecidedComparison[] = (myDecided ?? []).map((c) => ({
    leftSubmissionId: c.left_submission_id,
    rightSubmissionId: c.right_submission_id,
    verdict: c.verdict as number,
    pairType:
      c.pair_type === "self"
        ? "self"
        : c.pair_type === "exceptional"
          ? "exceptional"
          : "refine",
    judgeSubmissionId: mySubmission.id,
  }));
  const stats = judgingStats(decided, myAssignedCount ?? decided.length, rankOf);

  return (
    <div className="grid gap-6">
      {header}
      <StudentReport
        rank={myRanking?.rank ?? 0}
        total={totalRanked ?? 0}
        letter={myRanking?.letter ?? null}
        summary={myScore?.summary ?? ""}
        themeScores={themeScores}
        ownBar={
          myScore?.own_bar === null || myScore?.own_bar === undefined
            ? null
            : Number(myScore.own_bar)
        }
        distinctiveness={
          myScore?.distinctiveness === null || myScore?.distinctiveness === undefined
            ? null
            : Number(myScore.distinctiveness)
        }
        stats={{
          tasteAgreement: stats.tasteAgreement,
          selfHonesty: stats.selfHonesty,
          participation: stats.participation,
          rubricSeconds: rubricView?.seconds ?? 0,
        }}
      />
    </div>
  );
}
