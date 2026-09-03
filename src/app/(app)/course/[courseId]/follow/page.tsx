import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import {
  getSignedDeckDownloadUrl,
  getSignedDeckPageUrls,
  getSignedDeckUrl,
  getSignedMaterialDownloadUrl,
} from "@/lib/storage";
import { deckPagePath, pagesReady } from "@/lib/deckpages";
import { readRenderedPages } from "@/server/deckrendered";
import { getCourseDirectory } from "@/lib/coursedirectory";
import { summarizeFocus, summarizeFocusByEnrollment } from "@/lib/focus";
import { loadCourseSeats } from "@/server/courseseats";
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
import type { PresenterExercise } from "@/components/features/follow/ProfessorPresenter";

/**
 * The one-minute paper running right now, if any. Exercises live on the
 * course rather than the lecture, so a professor can start one from the
 * presenter and it survives a reload of either side.
 */
async function loadOpenExercise(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<PresenterExercise | null> {
  const { data: round } = await supabase
    .from("exercise_rounds")
    .select("id, prompt")
    .eq("course_id", courseId)
    .eq("stage", "open")
    .maybeSingle();
  if (!round) return null;

  const { data: groups } = await supabase
    .from("exercise_groups")
    .select("id")
    .eq("round_id", round.id);
  const { data: responses } = await supabase
    .from("exercise_responses")
    .select("group_id, content")
    .eq("round_id", round.id);

  return {
    roundId: round.id,
    prompt: round.prompt,
    groupCount: groups?.length ?? 0,
    answered: (responses ?? []).filter(
      (r) => (r.content ?? "").trim().length > 0
    ).length,
  };
}

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
    .select("id, name, professor_id, room_id, transcripts_downloadable")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  // The live lecture (if any) and its deck.
  const { data: liveLecture } = await supabase
    .from("lectures")
    .select("id, deck_id, current_page, started_at, pauses")
    .eq("course_id", courseId)
    .is("ended_at", null)
    .maybeSingle();

  // Stale-lecture guard: nobody reliably clicks "End lecture", and a live
  // lecture hides the deck library entirely. Anything running longer than a
  // normal class day is auto-closed (with any open pause) on page load.
  const STALE_MS = 12 * 60 * 60 * 1000;
  let lecture = liveLecture;
  if (lecture) {
    const startedMs = Date.parse(lecture.started_at);
    const nowMs = new Date().getTime();
    if (Number.isFinite(startedMs) && nowMs - startedMs > STALE_MS) {
      const endedAt = new Date(nowMs).toISOString();
      const pauses = lecture.pauses ?? [];
      const closedPauses =
        pauses.length > 0 && pauses[pauses.length - 1].end === null
          ? [...pauses.slice(0, -1), { ...pauses[pauses.length - 1], end: endedAt }]
          : pauses;
      await supabase
        .from("lectures")
        .update({ ended_at: endedAt, pauses: closedPauses })
        .eq("id", lecture.id);
      lecture = null;
    }
  }

  const { data: deck } = lecture
    ? await supabase
        .from("lecture_decks")
        .select(
          "id, title, kind, storage_path, embed_url, page_count, transcript_path, transcript_title"
        )
        .eq("id", lecture.deck_id)
        .single()
    : { data: null };

  const fileUrl =
    deck?.kind === "pdf" && deck.storage_path
      ? await getSignedDeckUrl(supabase, deck.storage_path)
      : null;
  const slidesDownloadUrl =
    deck?.kind === "pdf" && deck.storage_path
      ? await getSignedDeckDownloadUrl(
          supabase,
          deck.storage_path,
          `${deck.title || "slides"}.pdf`
        )
      : null;
  // Admin-minted (the bucket has no member read) and only while the
  // professor's toggle allows it — that's the whole enforcement.
  let transcriptDownloadUrl: string | null = null;
  if (
    deck?.transcript_path &&
    course.transcripts_downloadable &&
    isConfigured.supabaseAdmin
  ) {
    const ext = deck.transcript_path.split(".").pop() ?? "txt";
    transcriptDownloadUrl = await getSignedMaterialDownloadUrl(
      createAdminClient(),
      deck.transcript_path,
      `${deck.transcript_title || "transcript"}.${ext}`
    );
  }

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
        .select(
          "id, title, kind, page_count, created_at, reading_title, transcript_title"
        )
        .eq("course_id", courseId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: false });
      const { data: questionRows } = await supabase
        .from("deck_questions")
        .select(
          "id, deck_id, prompt, options, correct_indices, rationale, position_after_page, approved, source"
        )
        .eq("course_id", courseId)
        .order("position_after_page", { ascending: true });
      const renderedByDeck = await readRenderedPages(
        supabase,
        (deckRows ?? []).map((d) => d.id)
      );
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
        renderedPages: renderedByDeck.get(d.id) ?? 0,
        createdAt: d.created_at,
        readingTitle: d.reading_title,
        transcriptTitle: d.transcript_title,
        questions: questionsByDeck.get(d.id) ?? [],
      }));
      return (
        <div className="grid gap-6">
          {header}
          <DeckManager courseId={courseId} decks={decks} />
        </div>
      );
    }

    // Roster (names + one photo) via admin — membership proven above. The
    // class-visible name, not roster_name: this view gets projected, and a
    // code-joiner's roster_name is their email address.
    // This is the render behind the Follow-along click. Everything that
    // depends on nothing else goes out in one round trip; only the check-ins
    // (need the session) and the votes (need the open round) wait for a
    // second one.
    const [
      directory,
      seats,
      { data: liveSession },
      { data: focusEvents },
      { data: presenceRows },
      { data: approvedRows },
      { data: roundRows },
      initialExercise,
    ] = await Promise.all([
      isConfigured.supabaseAdmin
        ? getCourseDirectory(createAdminClient(), courseId)
        : Promise.resolve({} as Awaited<ReturnType<typeof getCourseDirectory>>),
      loadCourseSeats(supabase, courseId, course.room_id),
      supabase
        .from("class_sessions")
        .select("id")
        .eq("course_id", courseId)
        .is("closed_at", null)
        .order("session_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("focus_events")
        .select("enrollment_id, event_type, occurred_at")
        .eq("lecture_id", lecture.id),
      supabase
        .from("lecture_presence")
        .select("enrollment_id, last_seen_at")
        .eq("lecture_id", lecture.id),
      // Approved questions for this deck + rounds already run this lecture.
      supabase
        .from("deck_questions")
        .select("id, prompt, options, correct_indices, position_after_page")
        .eq("deck_id", lecture.deck_id)
        .eq("approved", true)
        .order("position_after_page", { ascending: true }),
      supabase
        .from("poll_rounds")
        .select("id, question_id, prompt, options, stage, results, correct_indices")
        .eq("lecture_id", lecture.id),
      // A group exercise may already be running: a reload mid-activity
      // should land back on it rather than pretending nothing is happening.
      loadOpenExercise(supabase, courseId),
    ]);

    // Roster (names + one photo) via admin: membership proven above. The
    // class-visible name, not roster_name: this view gets projected, and a
    // code-joiner's roster_name is their email address.
    const roster: Record<string, RosterEntry> = {};
    for (const [enrollmentId, entry] of Object.entries(directory)) {
      roster[enrollmentId] = {
        name: entry.name,
        photoUrl: entry.photoUrl,
      };
    }

    // Room geometry + today's check-ins so the presenter can show the class
    // as a seat map. Missing either just falls back to the roster list.
    const occupants: Record<string, string> = {};
    if (liveSession) {
      const { data: checkIns } = await supabase
        .from("check_ins")
        .select("seat_id, enrollment_id")
        .eq("session_id", liveSession.id);
      for (const c of checkIns ?? []) occupants[c.seat_id] = c.enrollment_id;
    }
    const lastSeenByEnrollment = new Map(
      (presenceRows ?? []).map((p) => [
        p.enrollment_id,
        Date.parse(p.last_seen_at),
      ])
    );
    const initialFocus: FocusStateInput[] = Array.from(
      summarizeFocusByEnrollment(
        focusEvents ?? [],
        new Date(),
        lecture.pauses ?? [],
        lastSeenByEnrollment
      )
    ).map(([enrollmentId, s]) => ({
      enrollmentId,
      awayCount: s.awayCount,
      awayMs: s.awayMs,
      isAway: s.isAway,
    }));
    const initialPresence = (presenceRows ?? []).map((p) => ({
      enrollmentId: p.enrollment_id,
      lastSeenAt: p.last_seen_at,
    }));

    const questions: PresenterQuestion[] = (approvedRows ?? []).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: q.options,
      correctIndices: q.correct_indices,
      positionAfterPage: q.position_after_page,
    }));

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
          initialPresence={initialPresence}
          initialPauses={lecture.pauses ?? []}
          seats={seats}
          occupants={occupants}
          questions={questions}
          ranQuestionIds={(roundRows ?? [])
            .map((r) => r.question_id)
            .filter((id): id is string => Boolean(id))}
          initialRound={initialRound}
          initialVotes={initialVotes}
          initialExercise={initialExercise}
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
    .order("created_at", { ascending: true })
    .limit(1)
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

  // Everything the student view needs that doesn't depend on the open round,
  // in one round trip. This is the render every laptop in the room performs
  // in the same minute; sequential awaits here were pure latency.
  const [
    { data: noteEntries },
    { data: myFocusEvents },
    { data: myPresence },
    { data: openRound },
    openExercise,
    pageImageUrls,
  ] = await Promise.all([
    supabase
      .from("lecture_note_entries")
      .select("id, page, content, created_at")
      .eq("lecture_id", lecture.id)
      .eq("enrollment_id", myEnrollment.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("focus_events")
      .select("enrollment_id, event_type, occurred_at")
      .eq("lecture_id", lecture.id)
      .eq("enrollment_id", myEnrollment.id),
    supabase
      .from("lecture_presence")
      .select("last_seen_at")
      .eq("lecture_id", lecture.id)
      .eq("enrollment_id", myEnrollment.id)
      .maybeSingle(),
    // Open think-pair-share round (correct_indices is null until reveal).
    supabase
      .from("poll_rounds")
      .select("id, prompt, options, stage, results, correct_indices")
      .eq("lecture_id", lecture.id)
      .neq("stage", "closed")
      .maybeSingle(),
    loadOpenExercise(supabase, courseId),
    // Slides as images (see lib/deckpages): only once the whole deck has
    // rendered; otherwise the PDF path stands. Signed in one batch and
    // cached, so the room signs each page once.
    (async () => {
      if (deck.kind !== "pdf" || !deck.page_count) return null;
      const rendered = (await readRenderedPages(supabase, [deck.id])).get(deck.id) ?? 0;
      if (!pagesReady(rendered, deck.page_count)) return null;
      return getSignedDeckPageUrls(
        supabase,
        Array.from({ length: deck.page_count }, (_, i) =>
          deckPagePath(courseId, deck.id, i + 1)
        )
      );
    })(),
  ]);
  const myFocus = summarizeFocus(
    myFocusEvents ?? [],
    new Date(),
    lecture.pauses ?? [],
    myPresence ? Date.parse(myPresence.last_seen_at) : undefined
  );

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
    const [{ data: myAnswers }, { data: myPair }] = await Promise.all([
      supabase
        .from("poll_answers")
        .select("phase, choice")
        .eq("round_id", openRound.id)
        .eq("enrollment_id", myEnrollment.id),
      supabase
        .from("poll_pairs")
        .select("member_ids")
        .eq("round_id", openRound.id)
        .contains("member_ids", JSON.stringify([myEnrollment.id]))
        .maybeSingle(),
    ]);
    initialMyAnswers = myAnswers ?? [];
    initialPartnerIds = (myPair?.member_ids ?? []).filter(
      (id) => id !== myEnrollment.id
    );
  }

  // Roster (names + one photo) so the poll card can show partners by face.
  // Reads the course directory rather than roster_name directly: "discuss with"
  // is addressed to a person, so it needs the name the class knows them by —
  // and roster_name for a code-joiner is the email they signed up with.
  const studentRoster: Record<
    string,
    { name: string; firstName: string; photoUrl: string | null }
  > = {};
  if (isConfigured.supabaseAdmin) {
    const directory = await getCourseDirectory(createAdminClient(), courseId);
    for (const [enrollmentId, entry] of Object.entries(directory)) {
      studentRoster[enrollmentId] = {
        name: entry.name,
        firstName: entry.firstName,
        photoUrl: entry.photoUrl,
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
        pageImageUrls={pageImageUrls}
        slidesDownloadUrl={slidesDownloadUrl}
        transcriptDownloadUrl={transcriptDownloadUrl}
        embedUrl={deck.embed_url}
        initialEntries={(noteEntries ?? []).map((e) => ({
          id: e.id,
          page: e.page,
          content: e.content,
          createdAt: e.created_at,
        }))}
        initialAwayCount={myFocus.awayCount}
        initialAwayMs={myFocus.awayMs}
        initialIsAway={myFocus.isAway}
        initialPauses={lecture.pauses ?? []}
        roster={studentRoster}
        initialRound={initialRound}
        initialMyAnswers={initialMyAnswers}
        initialPartnerIds={initialPartnerIds}
        initialExercisePrompt={openExercise?.prompt ?? null}
      />
    </div>
  );
}
