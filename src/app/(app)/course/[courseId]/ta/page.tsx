import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { resolveCourseAi } from "@/server/aicreds";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaChat, type TaChatMessage } from "@/components/features/ta/TaChat";
import {
  TaIndexPanel,
  type IndexItem,
} from "@/components/features/ta/TaIndexPanel";
import { TaTogglePanel } from "@/components/features/ta/TaTogglePanel";

// The askTa / indexNextMaterial actions run AI calls up to 90-150s; server
// actions inherit the invoking page's segment config (checkin page is the
// precedent), so the ceiling has to be declared here.
export const maxDuration = 120;

export default async function AskTaPage({
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
    .select(
      "id, name, professor_id, ta_enabled, syllabus_title, syllabus_path, syllabus_text"
    )
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  if (!isProfessor) {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .maybeSingle();
    if (!enrollment) {
      return (
        <div className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Ask the TA</h1>
            <p className="text-muted-foreground">{course.name}</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>You&apos;re not on this roster yet</CardTitle>
              <CardDescription>
                Activate your enrollment to talk to the course TA.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }
  }

  // A live chat needs a key AND the professor's opt-in (0041) — a key
  // connected for grading doesn't switch the TA on by itself. resolveCourseAi
  // is service-role only; the key never reaches this page's output.
  const creds = await resolveCourseAi(courseId, "ta");
  const hasKey = creds !== null;

  // Corpus inventory — what the TA can (and can't yet) read. Text columns
  // stay out of this select on purpose; only presence is needed.
  const { data: deckRows } = await supabase
    .from("lecture_decks")
    .select(
      "id, title, kind, storage_path, reading_path, reading_title, transcript_title, deck_text, reading_text, transcript_text"
    )
    .eq("course_id", courseId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });

  const items: IndexItem[] = [];
  if (course.syllabus_path || course.syllabus_text) {
    items.push({
      label: course.syllabus_title ?? "Syllabus",
      indexed: Boolean(course.syllabus_text),
    });
  }
  for (const deck of deckRows ?? []) {
    if (deck.kind === "pdf" && deck.storage_path) {
      items.push({
        label: `Slides: ${deck.title}`,
        indexed: Boolean(deck.deck_text),
      });
    }
    if (deck.reading_path) {
      items.push({
        label: `Reading: ${deck.reading_title ?? deck.title}`,
        indexed: Boolean(deck.reading_text),
      });
    }
    if (deck.transcript_title) {
      items.push({
        label: `Transcript: ${deck.transcript_title}`,
        indexed: Boolean(deck.transcript_text),
      });
    }
  }
  const anyIndexed =
    Boolean(course.syllabus_text) ||
    (deckRows ?? []).some(
      (d) => d.deck_text || d.transcript_text || d.reading_text
    );

  // This member's own private thread (RLS scopes the select).
  const { data: messageRows } = await supabase
    .from("ta_messages")
    .select("id, role, content, created_at")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const messages: TaChatMessage[] = (messageRows ?? [])
    .reverse()
    .map((m) => ({ id: m.id, role: m.role, content: m.content }));

  let disabledReason: string | null = null;
  if (!hasKey) {
    disabledReason = isProfessor
      ? "The TA runs on your OpenRouter key. Connect one in AI Settings, then switch the TA on below."
      : "The TA isn't enabled for this course yet — ask your professor.";
  } else if (!course.ta_enabled) {
    disabledReason = isProfessor
      ? "Your key is connected — flip the switch below to open the TA to students (and to try it yourself)."
      : "The TA isn't enabled for this course yet — ask your professor.";
  } else if (!anyIndexed) {
    disabledReason = isProfessor
      ? "The TA has nothing to read yet — upload a syllabus or transcripts, or index your slides below."
      : "The TA is waiting on course materials — check back soon.";
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask the TA</h1>
        <p className="text-muted-foreground">{course.name}</p>
      </div>

      {!hasKey && isProfessor && (
        <Card>
          <CardHeader>
            <CardTitle>Turn on your course TA</CardTitle>
            <CardDescription>
              {disabledReason}{" "}
              <Link href="/settings/ai" className="underline">
                Open AI Settings
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <TaChat
        courseId={courseId}
        initialMessages={messages}
        disabledReason={disabledReason}
      />

      {isProfessor && (
        <>
          <TaTogglePanel
            courseId={courseId}
            enabled={course.ta_enabled ?? false}
            hasKey={hasKey}
          />
          <TaIndexPanel courseId={courseId} items={items} enabled={hasKey} />
        </>
      )}
    </div>
  );
}
