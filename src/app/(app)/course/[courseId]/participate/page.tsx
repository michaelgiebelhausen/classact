import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { summarizeParticipation } from "@/lib/participate";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DeckQuestions,
  type QuestionItem,
} from "@/components/features/follow/DeckQuestions";
import { DeckReading } from "@/components/features/follow/DeckReading";
import {
  ExerciseProfessor,
  type OpenExerciseView,
} from "@/components/features/participate/ExerciseProfessor";
import {
  ExerciseStudent,
  type MyExerciseGroup,
} from "@/components/features/participate/ExerciseStudent";

/**
 * The open one-minute-paper round for a course, with each group's members and
 * shared response. RLS decides what the caller sees: professor gets every
 * group; a student gets their own group's response only.
 */
async function loadOpenExercise(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<{
  roundId: string;
  prompt: string;
  groups: {
    id: string;
    label: string;
    memberEnrollmentIds: string[];
    memberNames: string[];
    response: string;
  }[];
} | null> {
  const { data: round } = await supabase
    .from("exercise_rounds")
    .select("id, prompt")
    .eq("course_id", courseId)
    .eq("stage", "open")
    .maybeSingle();
  if (!round) return null;

  const { data: groupRows } = await supabase
    .from("exercise_groups")
    .select("id, label")
    .eq("round_id", round.id)
    .order("label");
  const groupIds = (groupRows ?? []).map((g) => g.id);

  const [{ data: memberRows }, { data: responseRows }] = await Promise.all([
    supabase
      .from("exercise_group_members")
      .select("group_id, enrollment_id, enrollments(roster_name)")
      .in("group_id", groupIds),
    supabase
      .from("exercise_responses")
      .select("group_id, content")
      .in("group_id", groupIds),
  ]);
  const responseByGroup = new Map(
    (responseRows ?? []).map((r) => [r.group_id, r.content])
  );

  return {
    roundId: round.id,
    prompt: round.prompt,
    groups: (groupRows ?? []).map((g) => {
      const members = (memberRows ?? []).filter((m) => m.group_id === g.id);
      return {
        id: g.id,
        label: g.label,
        memberEnrollmentIds: members.map((m) => m.enrollment_id),
        memberNames: members.map(
          (m) =>
            (m.enrollments as unknown as { roster_name: string } | null)
              ?.roster_name ?? "Someone"
        ),
        response: responseByGroup.get(g.id) ?? "",
      };
    }),
  };
}

/**
 * Participate — the think-pair-share home. Professors manage each deck's
 * question bank here (same controls as under Your Decks); students see how
 * their in-class participation is adding up.
 */
export default async function ParticipatePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Participate</h1>
      <p className="text-sm text-muted-foreground">{course.name}</p>
    </div>
  );

  // ---------- Professor: question banks per deck ----------
  if (isProfessor) {
    const { data: deckRows } = await supabase
      .from("lecture_decks")
      .select("id, title, kind, page_count, reading_title, created_at")
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

    const exercise = await loadOpenExercise(supabase, courseId);
    const professorRound: OpenExerciseView | null = exercise
      ? {
          roundId: exercise.roundId,
          prompt: exercise.prompt,
          groups: exercise.groups.map((g) => ({
            id: g.id,
            label: g.label,
            memberNames: g.memberNames,
            response: g.response,
          })),
        }
      : null;

    return (
      <div className="grid gap-6">
        {header}
        <ExerciseProfessor courseId={courseId} round={professorRound} />
        <Card>
          <CardHeader>
            <CardTitle>Think-Pair-Share questions</CardTitle>
            <CardDescription>
              AI drafts questions from each deck (and its attached reading).
              Approve the ones you like — they pop into the lecture
              automatically after their slide. The flow follows Eric
              Mazur&apos;s Peer Instruction: think alone, discuss with a
              partner, re-vote, reveal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(deckRows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Upload a deck in Follow Along first — its question bank shows
                up here.
              </p>
            ) : (
              <ul className="grid gap-3">
                {(deckRows ?? []).map((deck) => (
                  <li key={deck.id} className="rounded-lg border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{deck.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {deck.kind === "pdf"
                            ? `PDF${deck.page_count ? ` · ${deck.page_count} slides` : ""}`
                            : "Google Slides (unsynced)"}
                        </p>
                      </div>
                      <DeckReading
                        courseId={courseId}
                        deckId={deck.id}
                        readingTitle={deck.reading_title}
                      />
                    </div>
                    <DeckQuestions
                      courseId={courseId}
                      deckId={deck.id}
                      deckKind={deck.kind}
                      pageCount={deck.page_count}
                      readingTitle={deck.reading_title}
                      questions={questionsByDeck.get(deck.id) ?? []}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------- Student: participation record ----------
  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();

  let stats = { answered: 0, firstCorrect: 0, changedToCorrect: 0 };
  if (myEnrollment) {
    const { data: rounds } = await supabase
      .from("poll_rounds")
      .select("id, correct_indices")
      .eq("course_id", courseId)
      .eq("stage", "closed");
    const roundIds = new Set((rounds ?? []).map((r) => r.id));
    const { data: answers } = await supabase
      .from("poll_answers")
      .select("round_id, phase, choice")
      .eq("enrollment_id", myEnrollment.id);
    stats = summarizeParticipation(
      rounds ?? [],
      (answers ?? []).filter((a) => roundIds.has(a.round_id))
    );
  }

  const exercise = await loadOpenExercise(supabase, courseId);
  let myGroup: MyExerciseGroup | null = null;
  let openButUngrouped = false;
  if (exercise) {
    const mine = myEnrollment
      ? exercise.groups.find((g) =>
          g.memberEnrollmentIds.includes(myEnrollment.id)
        )
      : undefined;
    if (mine) {
      myGroup = {
        groupId: mine.id,
        label: mine.label,
        prompt: exercise.prompt,
        memberNames: mine.memberNames,
        response: mine.response,
      };
    } else {
      openButUngrouped = true;
    }
  }

  return (
    <div className="grid gap-6">
      {header}
      {exercise && (
        <ExerciseStudent
          courseId={courseId}
          group={myGroup}
          openButUngrouped={openButUngrouped}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Your participation</CardTitle>
          <CardDescription>
            Think-pair-share questions run during lectures in Follow Along.
            Answer, argue your case with a partner, then answer again —
            changing your mind for the right reasons is the whole point.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                Questions answered
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {stats.answered}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Right on the first try
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {stats.firstCorrect}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Switched to the right answer
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {stats.changedToCorrect}
              </dd>
            </div>
          </dl>
          {stats.answered === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing yet — join the next lecture in Follow Along and the
              questions will pop in automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
