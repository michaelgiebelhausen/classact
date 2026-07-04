import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getSignedDeckUrl, resolveEnrollmentPhotos } from "@/lib/storage";
import { summarizeFocus, summarizeFocusByEnrollment } from "@/lib/focus";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeckManager, type DeckListItem } from "@/components/features/follow/DeckManager";
import type { QuestionItem } from "@/components/features/follow/DeckQuestions";
import {
  ProfessorPresenter,
  type ActiveRound,
  type FocusStateInput,
  type PresenterQuestion,
  type PresenterVote,
  type RosterEntry,
} from "@/components/features/follow/ProfessorPresenter";
import {
  StudentFollow,
  type StudentRound,
} from "@/components/features/follow/StudentFollow";

export default async function FollowAlongPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS membership gate — non-members get null.
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  // The live lecture (if any) and its deck.
  const { data: lecture } = await supabase
    .from("lectures")
    .select("id, deck_id, current_page, started_at")
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();

  const { data: deck } = lecture
    ? await supabase
        .from("lecture_decks")
        .select("id, title, kind, storage_path, embed_url, page_count")
        .eq("id", lecture.deck_id)
        .single()
    : { data: null };

  const fileUrl =
    deck?.kind === "pdf" && deck.storage_path
      ? await getSignedDeckUrl(supabase, deck.storage_path)
      : null;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Follow Along</h1>
      <p className="text-sm text-muted-foreground">{course.name}</p>
    </div>
  );

  // ---------- Professor ----------
  if (isProfessor) {
    if (!lecture || !deck) {
      const { data: deckRows } = await supabase
        .from("lecture_decks")
        .select("id, title, kind, page_count, created_at, reading_title")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });
      const { data: questionRows } = await supabase
        .from("deck_questions")
        .select(
          "id, deck_id, prompt, options, correct_indices, rationale, position_after_page, approved, source"
        )
        .eq("course_id", courseId)
        .order("position_after_page", { ascending: true });
      const questionsByDeck = new Map<string, QuestionItem[]>();
      for (const q of questionRows ?? []) {
        const list = questionsByDeck.get(q.deck_id) ?? [];
        list.push({
          id: q.id,
          prompt: q.prompt,
          options: q.options,
          correctIndices: q.correct_indices,
          rationale: q.rationale,
          positionAfterPage: q.position_after_page,
          approved: q.approved,
          source: q.source,
        });
        questionsByDeck.set(q.deck_id, list);
      }
      const decks: DeckListItem[] = (deckRows ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        pageCount: d.page_count,
        createdAt: d.created_at,
        readingTitle: d.reading_title,
        questions: questionsByDeck.get(d.id) ?? [],
      }));
      return (
        <div className="grid gap-6">
          {header}
          <DeckManager courseId={courseId} decks={decks} />
        </div>
      );
    }

    // Roster (names + one photo) via admin — membership proven above.
    const roster: Record<string, RosterEntry> = {};
    if (isConfigured.supabaseAdmin) {
      const admin = createAdminClient();
      const { data: enrollments } = await admin
        .from("enrollments")
        .select("id, roster_name, profile_id, roster_photo_path")
        .eq("course_id", courseId);
      const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);
      for (const e of enrollments ?? []) {
        roster[e.id] = {
          name: e.roster_name,
          photoUrl: photoMap.get(e.id)?.[0] ?? null,
        };
      }
    }

    const { data: focusEvents } = await supabase
      .from("focus_events")
      .select("enrollment_id, event_type, occurred_at")
      .eq("lecture_id", lecture.id);
    const initialFocus: FocusStateInput[] = Array.from(
      summarizeFocusByEnrollment(focusEvents ?? [])
    ).map(([enrollmentId, s]) => ({
      enrollmentId,
      awayCount: s.awayCount,
      awayMs: s.awayMs,
      isAway: s.isAway,
    }));

    // Approved questions for this deck + rounds already run this lecture.
    const { data: approvedRows } = await supabase
      .from("deck_questions")
      .select("id, prompt, options, correct_indices, position_after_page")
      .eq("deck_id", lecture.deck_id)
      .eq("approved", true)
      .order("position_after_page", { ascending: true });
    const questions: PresenterQuestion[] = (approvedRows ?? []).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
      correctIndices: q.correct_indices,
      positionAfterPage: q.position_after_page,
    }));

    const { data: roundRows } = await supabase
      .from("poll_rounds")
      .select("id, question_id, prompt, options, stage, results, correct_indices")
      .eq("lecture_id", lecture.id);
    const openRound = (roundRows ?? []).find((r) => r.stage !== "closed");
    const initialRound: ActiveRound | null = openRound
      ? {
          id: openRound.id,
          questionId: openRound.question_id,
          prompt: openRound.prompt,
          options: openRound.options,
          stage: openRound.stage,
          results: openRound.results,
          correctIndices: openRound.correct_indices,
        }
      : null;

    let initialVotes: PresenterVote[] = [];
    if (openRound) {
      const { data: voteRows } = await supabase
        .from("poll_answers")
        .select("enrollment_id, phase, choice")
        .eq("round_id", openRound.id);
      initialVotes = (voteRows ?? []).map((v) => ({
        enrollmentId: v.enrollment_id,
        phase: v.phase,
        choice: v.choice,
      }));
    }

    return (
      <div className="grid gap-6">
        {header}
        <ProfessorPresenter
          courseId={courseId}
          lectureId={lecture.id}
          startedAt={lecture.started_at}
          initialPage={lecture.current_page}
          deckTitle={deck.title}
          deckKind={deck.kind}
          fileUrl={fileUrl}
          embedUrl={deck.embed_url}
          pageCount={deck.page_count}
          roster={roster}
          initialFocus={initialFocus}
          questions={questions}
          ranQuestionIds={(roundRows ?? [])
            .map((r) => r.question_id)
            .filter((id): id is string => Boolean(id))}
          initialRound={initialRound}
          initialVotes={initialVotes}
        />
      </div>
    );
  }

  // ---------- Student ----------
  if (!lecture || !deck) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>No live lecture right now</CardTitle>
            <CardDescription>
              When your professor starts presenting, the slides appear here and
              follow along automatically. Keep this tab open during class.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();

  if (!myEnrollment) {
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re not on this roster yet</CardTitle>
            <CardDescription>
              Activate your enrollment to follow along with the lecture.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { data: note } = await supabase
    .from("lecture_notes")
    .select("content")
    .eq("lecture_id", lecture.id)
    .eq("enrollment_id", myEnrollment.id)
    .maybeSingle();

  const { data: myFocusEvents } = await supabase
    .from("focus_events")
    .select("enrollment_id, event_type, occurred_at")
    .eq("lecture_id", lecture.id)
    .eq("enrollment_id", myEnrollment.id);
  const myFocus = summarizeFocus(myFocusEvents ?? []);

  // Open think-pair-share round (correct_indices is null until reveal).
  const { data: openRound } = await supabase
    .from("poll_rounds")
    .select("id, prompt, options, stage, results, correct_indices")
    .eq("lecture_id", lecture.id)
    .neq("stage", "closed")
    .maybeSingle();
  const initialRound: StudentRound | null = openRound
    ? {
        id: openRound.id,
        prompt: openRound.prompt,
        options: openRound.options,
        stage: openRound.stage,
        results: openRound.results,
        correctIndices: openRound.correct_indices,
      }
    : null;

  let initialMyAnswers: Array<{ phase: "think" | "revote"; choice: number }> =
    [];
  let initialPartnerIds: string[] = [];
  if (openRound) {
    const { data: myAnswers } = await supabase
      .from("poll_answers")
      .select("phase, choice")
      .eq("round_id", openRound.id)
      .eq("enrollment_id", myEnrollment.id);
    initialMyAnswers = myAnswers ?? [];
    const { data: myPair } = await supabase
      .from("poll_pairs")
      .select("member_ids")
      .eq("round_id", openRound.id)
      .contains("member_ids", JSON.stringify([myEnrollment.id]))
      .maybeSingle();
    initialPartnerIds = (myPair?.member_ids ?? []).filter(
      (id) => id !== myEnrollment.id
    );
  }

  // Roster (names + one photo) so the poll card can show partners by face —
  // the same class-visible roster as the course directory.
  const studentRoster: Record<
    string,
    { name: string; photoUrl: string | null }
  > = {};
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, roster_name, profile_id, roster_photo_path")
      .eq("course_id", courseId);
    const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);
    for (const e of enrollments ?? []) {
      studentRoster[e.id] = {
        name: e.roster_name,
        photoUrl: photoMap.get(e.id)?.[0] ?? null,
      };
    }
  }

  return (
    <div className="grid gap-6">
      {header}
      <StudentFollow
        courseId={courseId}
        lectureId={lecture.id}
        enrollmentId={myEnrollment.id}
        initialPage={lecture.current_page}
        deckTitle={deck.title}
        deckKind={deck.kind}
        fileUrl={fileUrl}
        embedUrl={deck.embed_url}
        initialNotes={note?.content ?? ""}
        initialAwayCount={myFocus.awayCount}
        initialAwayMs={myFocus.awayMs}
        roster={studentRoster}
        initialRound={initialRound}
        initialMyAnswers={initialMyAnswers}
        initialPartnerIds={initialPartnerIds}
      />
    </div>
  );
}
