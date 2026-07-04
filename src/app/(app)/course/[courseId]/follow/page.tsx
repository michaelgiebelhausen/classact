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
import {
  ProfessorPresenter,
  type FocusStateInput,
  type RosterEntry,
} from "@/components/features/follow/ProfessorPresenter";
import { StudentFollow } from "@/components/features/follow/StudentFollow";

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
        .select("id, title, kind, page_count, created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });
      const decks: DeckListItem[] = (deckRows ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        pageCount: d.page_count,
        createdAt: d.created_at,
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

  return (
    <div className="grid gap-6">
      {header}
      <StudentFollow
        courseId={courseId}
        lectureId={lecture.id}
        initialPage={lecture.current_page}
        deckTitle={deck.title}
        deckKind={deck.kind}
        fileUrl={fileUrl}
        embedUrl={deck.embed_url}
        initialNotes={note?.content ?? ""}
        initialAwayCount={myFocus.awayCount}
        initialAwayMs={myFocus.awayMs}
      />
    </div>
  );
}
