import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { CourseSetupTabs } from "@/components/features/setup/CourseSetupTabs";
import { getCanvasConnection } from "@/server/actions/canvassettings";
import type { DeckListItem } from "@/components/features/follow/DeckManager";
import type { QuestionItem } from "@/components/features/follow/DeckQuestions";
import type { RoomLayout } from "@/lib/roomlayout";
import type { RoomLocation } from "@/server/actions/rooms";

export default async function CourseSetupPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, name, join_code, icebreaker_fields, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, auto_open, term_start, term_end"
    )
    .eq("id", courseId)
    .single();

  // PGRST116 = no row matched (a genuinely missing/foreign course). Anything
  // else — notably 42703, undefined_column when a migration hasn't run — is a
  // real failure and must not masquerade as "that page isn't here".
  if (courseError && courseError.code !== "PGRST116") {
    console.error("[setup] course query failed:", {
      code: courseError.code,
      message: courseError.message,
      hint: courseError.hint,
    });
    throw new Error(
      `Course setup couldn't load: ${courseError.message}. If that names a missing column, run supabase/catchup_0019_to_0023.sql in the Supabase SQL editor.`
    );
  }
  if (!course) notFound();
  if (course.professor_id !== profile.id) redirect(`/course/${courseId}`);

  const canvasConnection = await getCanvasConnection();
  const [{ count: seatCount }, { data: enrollments }] = await Promise.all([
    supabase
      .from("seats")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId),
    supabase
      .from("enrollments")
      .select("id, roster_name, roster_email, status")
      .eq("course_id", courseId)
      .order("roster_name"),
  ]);

  // The course's room (layout + campus location) for re-editing.
  let initialLayout: RoomLayout | null = null;
  let initialLocation: RoomLocation | null = null;
  if (course.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("layout, room_number, buildings(name, universities(name))")
      .eq("id", course.room_id)
      .maybeSingle();
    if (room) {
      initialLayout = room.layout as unknown as RoomLayout;
      const building = room.buildings as unknown as {
        name: string;
        universities: { name: string };
      } | null;
      if (building && room.room_number) {
        initialLocation = {
          universityName: building.universities.name,
          buildingName: building.name,
          roomNumber: room.room_number,
        };
      }
    }
  }

  // University suggestion: saved affiliation first, then email domain match.
  let universitySuggestion = "";
  const { data: fullProfile } = await supabase
    .from("profiles")
    .select("university_id")
    .eq("id", profile.id)
    .single();
  if (fullProfile?.university_id) {
    const { data: uni } = await supabase
      .from("universities")
      .select("name")
      .eq("id", fullProfile.university_id)
      .maybeSingle();
    universitySuggestion = uni?.name ?? "";
  }
  if (!universitySuggestion) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const domain = user?.email?.split("@")[1]?.toLowerCase();
    if (domain) {
      const { data: uni } = await supabase
        .from("universities")
        .select("name")
        .eq("domain", domain)
        .maybeSingle();
      universitySuggestion = uni?.name ?? "";
    }
  }

  // Slide decks (+ their questions) for the Slides tab — the same manager
  // Follow Along uses, surfaced where professors look for it.
  const [{ data: deckRows }, { data: questionRows }] = await Promise.all([
    supabase
      .from("lecture_decks")
      .select("id, title, kind, page_count, created_at, reading_title")
      .eq("course_id", courseId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("deck_questions")
      .select(
        "id, deck_id, prompt, options, correct_indices, rationale, position_after_page, approved, source"
      )
      .eq("course_id", courseId)
      .order("position_after_page", { ascending: true }),
  ]);
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
        <p className="text-sm text-muted-foreground">
          Course setup — room, roster, slides, icebreakers, invites.
        </p>
      </div>
      <CourseSetupTabs
        course={{
          id: course.id,
          name: course.name,
          join_code: course.join_code,
          icebreaker_fields: (course.icebreaker_fields as string[]) ?? [],
        }}
        roomSetup={{
          hasExistingRoom: (seatCount ?? 0) > 0,
          initialLayout,
          initialLocation,
          universitySuggestion,
        }}
        schedule={{
          days: (course.meeting_days as number[]) ?? [],
          start: course.meeting_start,
          end: course.meeting_end,
          timezone: course.timezone,
          autoOpen: course.auto_open ?? true,
          termStart: course.term_start,
          termEnd: course.term_end,
        }}
        enrollments={enrollments ?? []}
        siteUrl={env.siteUrl}
        canvasConnection={canvasConnection}
        decks={decks}
      />
    </div>
  );
}
