import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LocalTime } from "@/components/ui/localtime";
import { resolveCourseAi, scoringPricing } from "@/server/aicreds";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getSignedBriefUrl, getSignedSubmissionUrl } from "@/lib/storage";
import type { DeliverableType } from "@/lib/submissionfile";
import { getCourseDirectory } from "@/lib/coursedirectory";
import { rosterDisplayName } from "@/lib/names";
import {
  defaultBands,
  readBands,
  readDividers,
  resolveSettings,
} from "@/lib/tastegrading";
import { dividersFromThresholds, normalizeDividers } from "@/lib/bands";
import { draftBody, tasteProse } from "@/lib/tasteprose";
import { judgingStats, type DecidedComparison } from "@/lib/tastestats";
import { Card, CardContent } from "@/components/ui/card";
import { SubmissionEditor } from "@/components/features/assignments/SubmissionEditor";
import { AnalysisRunner } from "@/components/features/assignments/AnalysisRunner";
import { StartGradingButton } from "@/components/features/assignments/StartGradingButton";
import {
  PeerReview,
  type PeerPairView,
} from "@/components/features/assignments/PeerReview";
import {
  GradingCockpit,
  type CockpitStudent,
} from "@/components/features/assignments/GradingCockpit";
import { StudentReport } from "@/components/features/assignments/StudentReport";
import {
  SubmissionRoster,
  type SubmissionRosterRow,
} from "@/components/features/assignments/SubmissionRoster";
import { AssignmentEdit } from "@/components/features/assignments/AssignmentEdit";
import type { ThemeScore } from "@/types/db";

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
      "id, course_id, title, instructions, points, deadline, peer_close_at, storage_path, settings, state, analysis, published_at, courses!inner(name, professor_id, grading_defaults)"
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

  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  const enrollmentId = myEnrollment?.id ?? null;

  const header = (
    <div className="grid gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{assignment.title}</h1>
        <p className="text-sm text-muted-foreground">
          {courseMeta.name} · due <LocalTime iso={assignment.deadline} />
          {assignment.points !== null ? ` · ${assignment.points} points` : ""}
        </p>
      </div>
      {assignment.instructions && (
        <p className="max-w-3xl whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">
          {assignment.instructions}
        </p>
      )}
    </div>
  );

  // ---------- Grading in progress (the professor kicked it off) ----------
  // Grading is professor-triggered, so the deadline passing no longer starts
  // anything on its own. Once the professor presses Start, the state is
  // "analyzing" — only they drive the crank; a student sees a status card and
  // never triggers analysis.
  if (assignment.state === "analyzing") {
    return (
      <div className="grid gap-6">
        {header}
        {isProfessor ? (
          <AnalysisRunner assignmentId={assignmentId} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Grading is underway. Your report appears the moment your professor
              publishes.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---------- Paused: no working AI key (BYOK) ----------
  if (assignment.state === "awaiting_key") {
    return (
      <div className="grid gap-6">
        {header}
        {isProfessor ? (
          <>
            <Card className="border-primary/50">
              <CardContent className="grid gap-2 py-8 text-center">
                <p className="font-medium">
                  Grading is paused — it needs your OpenRouter key.
                </p>
                <p className="text-sm text-muted-foreground">
                  Analysis runs on your own AI credits. Connect a key (or fix
                  the current one) and this resumes exactly where it stopped —
                  nothing is lost.
                </p>
                <p>
                  <Link href="/settings/ai" className="font-medium text-primary underline">
                    Open AI Settings
                  </Link>
                </p>
              </CardContent>
            </Card>
            <AnalysisRunner assignmentId={assignmentId} currentState="awaiting_key" />
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              The AI analysis starts once your professor completes setup —
              check back soon.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---------- Professor ----------
  if (isProfessor) {
    // The professor's own taste file (the benchmark row, enrollment_id null) —
    // theirs to view, and to edit while the assignment is still open. RLS lets
    // the course owner read it directly; a legacy structured row renders back
    // as prose. Loaded once here for both the open and cockpit edit panels.
    const { data: professorTasteRow } = await supabase
      .from("taste_files")
      .select("body, criteria, bar_statement")
      .eq("assignment_id", assignmentId)
      .is("enrollment_id", null)
      .maybeSingle();
    const professorTaste = tasteProse(professorTasteRow);
    const gradingMode =
      (assignment.settings as { gradingMode?: string }).gradingMode === "ai_only"
        ? "ai_only"
        : "tasty";
    const deliverableType = ((
      assignment.settings as { deliverableType?: DeliverableType }
    ).deliverableType ?? "any") as DeliverableType;
    // The uploaded brief, so the edit panel can show what's attached and let
    // the professor open, replace, or remove it. Only the storage path is
    // stored, never the original filename — the extension is all we can label.
    const briefExt =
      assignment.storage_path?.split(".").pop()?.toLowerCase() ?? null;
    const briefUrl = assignment.storage_path
      ? await getSignedBriefUrl(supabase, assignment.storage_path)
      : null;

    if (assignment.state === "open") {
      const [{ data: subRows }, { data: tasteRows }, { data: activeRoster }] =
        await Promise.all([
          supabase
            .from("submissions")
            .select("enrollment_id, submitted_at, last_edit_at")
            .eq("assignment_id", assignmentId),
          supabase
            .from("taste_files")
            .select(
              "enrollment_id, criteria, is_default_untouched, last_edit_at"
            )
            .eq("assignment_id", assignmentId)
            .not("enrollment_id", "is", null),
          supabase
            .from("enrollments")
            .select("id, roster_name, profile_id, roster_photo_path")
            .eq("course_id", courseId)
            .eq("status", "active")
            .order("roster_name"),
        ]);
      const submitted = (subRows ?? []).length;
      const tastes = (tasteRows ?? []).length;
      const lateCount = (subRows ?? []).filter(
        (s) => new Date(s.submitted_at) > new Date(assignment.deadline)
      ).length;

      // Who's-turned-in-what roster: faces via the same resolver every other
      // photo surface uses; a missing admin config just means initials.
      const subByEnrollment = new Map(
        (subRows ?? []).map((s) => [s.enrollment_id, s])
      );
      const tasteByEnrollment = new Map(
        (tasteRows ?? []).map((t) => [t.enrollment_id as string, t])
      );
      // Names and faces from the course directory: class-visible names, never
      // the email a code-joiner's roster_name holds.
      const directory = isConfigured.supabaseAdmin
        ? await getCourseDirectory(createAdminClient(), courseId)
        : {};
      const rosterRows: SubmissionRosterRow[] = (activeRoster ?? []).map((e) => {
        const sub = subByEnrollment.get(e.id);
        const taste = tasteByEnrollment.get(e.id);
        // "Edited" only when the last edit is meaningfully after submission —
        // the two timestamps are written moments apart on a normal submit.
        const edited =
          sub &&
          new Date(sub.last_edit_at).getTime() -
            new Date(sub.submitted_at).getTime() >
            60_000;
        return {
          enrollmentId: e.id,
          name: directory[e.id]?.name ?? rosterDisplayName(e.roster_name),
          photoUrl: directory[e.id]?.photoUrl ?? null,
          submittedAt: sub?.submitted_at ?? null,
          // Late = the submission first landed after the deadline.
          late: sub
            ? new Date(sub.submitted_at) > new Date(assignment.deadline)
            : false,
          editedAt: edited ? sub.last_edit_at : null,
          taste: taste
            ? {
                criteriaCount: ((taste.criteria ?? []) as unknown[]).length,
                untouchedDefault: taste.is_default_untouched,
                editedAt: taste.last_edit_at,
              }
            : null,
        };
      });
      // BYOK preflight surface: key status + a rough scoring-cost preview.
      const creds = await resolveCourseAi(courseId, "scoring");
      const pricing = await scoringPricing(courseId);
      // ~25k prompt + ~1.5k completion tokens per scored PDF (rule of thumb).
      const estimate =
        pricing && (submitted ?? 0) > 0
          ? (submitted ?? 0) *
            ((25_000 * pricing.prompt + 1_500 * pricing.completion) / 1_000_000)
          : null;
      return (
        <div className="grid gap-6">
          {header}
          <AssignmentEdit
            assignmentId={assignmentId}
            state={assignment.state}
            title={assignment.title}
            instructions={assignment.instructions}
            points={assignment.points}
            deadline={assignment.deadline}
            peerCloseAt={assignment.peer_close_at}
            gradingMode={gradingMode}
            professorTaste={professorTaste}
            tasteRequirement={settings.tasteRequirement}
            deliverableType={deliverableType}
            courseId={courseId}
            briefUrl={briefUrl}
            briefExt={briefExt}
          />
          {!creds && (
            <Card className="border-primary/50">
              <CardContent className="grid gap-1 py-6 text-center">
                <p className="font-medium">
                  Connect your OpenRouter key before the deadline.
                </p>
                <p className="text-sm text-muted-foreground">
                  AI grading runs on your own credits — without a key, the
                  analysis pauses at the deadline until you connect one.
                </p>
                <p>
                  <Link
                    href="/settings/ai"
                    className="font-medium text-primary underline"
                  >
                    Open AI Settings
                  </Link>
                </p>
              </CardContent>
            </Card>
          )}
          {deadlinePassed ? (
            <Card className="border-primary/50">
              <CardContent className="grid gap-3 py-10 text-center">
                <p className="font-medium">
                  The deadline has passed — ready to grade.
                </p>
                <p className="text-sm text-muted-foreground">
                  {submitted ?? 0} submissions
                  {lateCount > 0 ? ` · ${lateCount} late` : ""}
                  {gradingMode === "tasty" ? ` · ${tastes ?? 0} taste files` : ""}.
                  Students can still turn work in — it&apos;s marked late — until
                  you start. Starting grading closes submissions and{" "}
                  {gradingMode === "tasty"
                    ? "reads the class's taste files, builds the rubric, drafts the ranking, and opens peer grading."
                    : "scores every submission against your taste file."}
                </p>
                <div className="flex justify-center">
                  <StartGradingButton assignmentId={assignmentId} />
                </div>
                {estimate !== null && pricing && (
                  <p className="text-xs text-muted-foreground">
                    Estimated scoring cost: ≈ ${estimate.toFixed(2)} on{" "}
                    <span className="font-mono">{pricing.model}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="grid gap-1 py-10 text-center">
                <p className="font-medium">
                  {submitted ?? 0} submissions
                  {gradingMode === "tasty"
                    ? ` · ${tastes ?? 0} taste files started`
                    : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  When the deadline passes you&apos;ll start grading here —
                  nothing runs until you do. Students can keep submitting past
                  the deadline (marked late) right up until you start.
                </p>
                {estimate !== null && pricing && (
                  <p className="text-sm text-muted-foreground">
                    Estimated scoring cost so far: ≈ ${estimate.toFixed(2)} on{" "}
                    <span className="font-mono">{pricing.model}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          <SubmissionRoster rows={rosterRows} showTaste={gradingMode === "tasty"} />
        </div>
      );
    }

    // Cockpit states: peer_review / finalizing / published.
    const [{ data: rankRows }, { data: subRows }, { data: comparisonRows }] =
      await Promise.all([
        supabase
          .from("rankings")
          .select("submission_id, bt_score, rank, final_rank, letter")
          .eq("assignment_id", assignmentId),
        supabase
          .from("submissions")
          .select("id, enrollment_id, submitted_at")
          .eq("assignment_id", assignmentId),
        supabase
          .from("comparisons")
          .select("left_submission_id, right_submission_id, judge_enrollment_id, verdict")
          .eq("assignment_id", assignmentId),
      ]);

    // Who came in after the bell — carried onto the ranked list as a badge.
    const lateBySub = new Map(
      (subRows ?? []).map((s) => [
        s.id,
        new Date(s.submitted_at) > new Date(assignment.deadline),
      ])
    );

    // Class-visible names + one face each, from the shared course directory.
    const directory = new Map<string, { name: string; photoUrl: string | null }>();
    if (isConfigured.supabaseAdmin) {
      const entries = await getCourseDirectory(createAdminClient(), courseId);
      for (const [enrollmentId, entry] of Object.entries(entries)) {
        directory.set(enrollmentId, {
          name: entry.name,
          photoUrl: entry.photoUrl,
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
          // The professor's order once they own it, the model's until then.
          rank: r.final_rank ?? r.rank,
          letter: r.letter,
          comparisons: touch.get(r.submission_id) ?? 0,
          late: lateBySub.get(r.submission_id) ?? false,
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

    // The bands the professor opens on: their own if they've saved any, then a
    // course template's, then the points-scaled A+/A/B/C default — Worth
    // pre-filled from the assignment's point total.
    const initialBands =
      readBands(assignment.settings) ??
      readBands(courseMeta.grading_defaults) ??
      defaultBands(assignment.points === null ? null : Number(assignment.points));

    return (
      <div className="grid gap-6">
        {header}
        <AssignmentEdit
          assignmentId={assignmentId}
          state={assignment.state}
          title={assignment.title}
          instructions={assignment.instructions}
          points={assignment.points}
          deadline={assignment.deadline}
          peerCloseAt={assignment.peer_close_at}
          gradingMode={gradingMode}
          professorTaste={professorTaste}
          tasteRequirement={settings.tasteRequirement}
          deliverableType={deliverableType}
          courseId={courseId}
          briefUrl={briefUrl}
          briefExt={briefExt}
        />
        <GradingCockpit
          assignmentId={assignmentId}
          state={
            peerClosed && assignment.state === "peer_review"
              ? "finalizing"
              : assignment.state
          }
          peerCloseAt={assignment.peer_close_at}
          students={students}
          initialBands={initialBands}
          // Where the lines start: saved positions if the professor has any,
          // otherwise derived from the AI's scores against the resolved cut
          // points. normalizeDividers reconciles however many lines that
          // produces with the band count — always one line fewer than there
          // are bands — so the cockpit opens on a publishable shape.
          initialDividers={normalizeDividers(
            readDividers(assignment.settings) ??
              dividersFromThresholds(
                students.map((s) => s.score),
                settings.cutPoints.map((c) => c.min)
              ),
            students.length,
            initialBands.length
          )}
          scoreMode={settings.scoreMode}
          scoreVisibility={settings.scoreVisibility}
          points={assignment.points === null ? null : Number(assignment.points)}
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
        .select("body, criteria, bar_statement, is_default_untouched")
        .eq("assignment_id", assignmentId)
        .eq("enrollment_id", enrollmentId)
        .maybeSingle(),
      supabase
        .from("submissions")
        .select("submitted_at, note, storage_path")
        .eq("assignment_id", assignmentId)
        .eq("enrollment_id", enrollmentId)
        .maybeSingle(),
    ]);
    // Let the student open what they actually submitted. A timestamp alone
    // doesn't answer "did the right file go up?", which is the question
    // behind most of the emails.
    const submittedFileUrl = submission?.storage_path
      ? await getSignedSubmissionUrl(supabase, submission.storage_path)
      : null;
    const submittedFileExt =
      submission?.storage_path?.split(".").pop()?.toLowerCase() ?? null;
    // Their own words if they've written any; the AI's draft if not. A taste
    // file written under the old structured editor is read back as prose, so
    // nobody has to re-enter what they already said.
    const written = tasteProse(taste);
    const seed = draftBody(
      (assignment.settings as { defaultTaste?: unknown }).defaultTaste
    );

    // AI-only grading has no emergent rubric, so students are shown what
    // they ARE graded against. That text now lives in the professor's taste
    // row, which RLS hides from students — hence the admin read. Deliberately
    // ai_only: in tasty mode the professor's taste is one private voice in
    // the corpus, not an announcement.
    const isAiOnly =
      (assignment.settings as { gradingMode?: string }).gradingMode === "ai_only";
    let instructorTaste =
      (assignment.settings as { gradingInstructions?: string })
        .gradingInstructions ?? "";
    if (isAiOnly && isConfigured.supabaseAdmin) {
      const admin = createAdminClient();
      const { data: professorTaste } = await admin
        .from("taste_files")
        .select("body, criteria, bar_statement")
        .eq("assignment_id", assignmentId)
        .is("enrollment_id", null)
        .maybeSingle();
      instructorTaste = tasteProse(professorTaste) || instructorTaste;
    }
    const deliverableType = ((
      assignment.settings as { deliverableType?: DeliverableType }
    ).deliverableType ?? "any") as DeliverableType;
    return (
      <div className="grid gap-6">
        {header}
        <SubmissionEditor
          courseId={courseId}
          assignmentId={assignmentId}
          enrollmentId={enrollmentId}
          deadline={assignment.deadline}
          initialTaste={written || seed}
          tasteIsDefault={taste ? taste.is_default_untouched : true}
          tasteRequirement={settings.tasteRequirement}
          submittedAt={submission?.submitted_at ?? null}
          submissionNote={submission?.note ?? ""}
          submittedFileUrl={submittedFileUrl}
          submittedFileExt={submittedFileExt}
          mode={
            (assignment.settings as { gradingMode?: string }).gradingMode ===
            "ai_only"
              ? "ai_only"
              : "tasty"
          }
          instructorCriteria={instructorTaste}
          deliverableType={deliverableType}
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
            courseId={courseId}
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
            {(assignment.settings as { gradingMode?: string }).gradingMode ===
            "ai_only"
              ? "The AI has graded the class. Your professor is doing the final review — your report appears the moment they publish."
              : "Peer grading has closed. Your professor is doing the final review — your report appears the moment they publish."}
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
      .select("rank, final_rank, points_awarded, letter")
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
        rank={myRanking?.final_rank ?? myRanking?.rank ?? 0}
        total={totalRanked ?? 0}
        letter={myRanking?.letter ?? null}
        pointsAwarded={
          myRanking?.points_awarded === null || myRanking?.points_awarded === undefined
            ? null
            : Number(myRanking.points_awarded)
        }
        pointsPossible={assignment.points === null ? null : Number(assignment.points)}
        visibility={settings.scoreVisibility}
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
