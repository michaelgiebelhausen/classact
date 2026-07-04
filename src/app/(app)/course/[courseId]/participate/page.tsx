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

    return (
      <div className="grid gap-6">
        {header}
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
                    <p className="text-sm font-medium">{deck.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {deck.kind === "pdf"
                        ? `PDF${deck.page_count ? ` · ${deck.page_count} slides` : ""}`
                        : "Google Slides (unsynced)"}
                    </p>
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

  return (
    <div className="grid gap-6">
      {header}
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
