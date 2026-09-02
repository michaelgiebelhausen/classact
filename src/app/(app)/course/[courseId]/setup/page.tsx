import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { env, isConfigured } from "@/lib/env";
import { getSignedPhotoUrls } from "@/lib/storage";
import {
  CourseSetupTabs,
  type RosterPhotoSet,
} from "@/components/features/setup/CourseSetupTabs";
import type { PhotoKind } from "@/types/db";
import { CourseNameEditor } from "@/components/features/setup/CourseNameEditor";
import { getCanvasConnection } from "@/server/actions/canvassettings";
import { getActivationRoster } from "@/server/actions/activation";
import { parseAttendancePolicy } from "@/lib/absences";
import type { DeckListItem } from "@/components/features/follow/DeckManager";
import type { QuestionItem } from "@/components/features/follow/DeckQuestions";
import type { RoomLayout } from "@/lib/roomlayout";
import type { RoomLocation } from "@/server/actions/rooms";
import { readRenderedPages } from "@/server/deckrendered";

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
      "id, name, join_code, icebreaker_fields, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, auto_open, term_start, term_end, attendance_policy, invite_subject, invite_message, canvas_course_id, canvas_section_ids, canvas_synced_at, syllabus_title, transcripts_downloadable"
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
      `Course setup couldn't load: ${courseError.message}. If that names a missing column, run the migrations that haven't been applied yet in the Supabase SQL editor (supabase/catchup_0019_to_0023.sql, then 0024, 0025, 0026 and 0027).`
    );
  }
  if (!course) notFound();
  if (course.professor_id !== profile.id) redirect(`/course/${courseId}`);

  const canvasConnection = await getCanvasConnection();
  // Activation state needs auth.users, so it comes from a server action rather
  // than the page's own query. Fetched here rather than in the client so the
  // panel renders with data instead of fetching after mount.
  const activationResult = await getActivationRoster(courseId);
  const activation = activationResult.ok ? activationResult.data?.rows ?? [] : [];
  const [{ count: seatCount }, { data: enrollments }] = await Promise.all([
    supabase
      .from("seats")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId),
    supabase
      .from("enrollments")
      .select(
        "id, roster_name, roster_email, status, invited_at, invite_error, profile_id, roster_photo_path"
      )
      .eq("course_id", courseId)
      .order("roster_name"),
  ]);

  // Per-student photos by kind, for the roster's photo tabs: each student's
  // own uploads (professional / candid / adventure) plus the seeded roster
  // photo (e.g. from Canvas) as its own entry. Signed through the admin
  // client like every other photo surface; absent config = no photos, and
  // the roster degrades to initials.
  const rosterPhotos: Record<string, RosterPhotoSet> = {};
  if (isConfigured.supabaseAdmin && (enrollments ?? []).length > 0) {
    const admin = createAdminClient();
    const profileIds = (enrollments ?? [])
      .map((e) => e.profile_id)
      .filter((id): id is string => Boolean(id));
    const { data: uploaded } =
      profileIds.length > 0
        ? await admin
            .from("profile_photos")
            .select("profile_id, kind, storage_path")
            .in("profile_id", profileIds)
        : { data: [] as { profile_id: string; kind: PhotoKind; storage_path: string }[] };
    const allPaths = [
      ...(uploaded ?? []).map((p) => p.storage_path),
      ...(enrollments ?? [])
        .map((e) => e.roster_photo_path)
        .filter((p): p is string => Boolean(p)),
    ];
    const urlMap = await getSignedPhotoUrls(admin, allPaths);
    const byProfile = new Map<string, Partial<Record<PhotoKind, string>>>();
    for (const p of uploaded ?? []) {
      const url = urlMap[p.storage_path];
      if (!url) continue;
      const set = byProfile.get(p.profile_id) ?? {};
      set[p.kind] = url;
      byProfile.set(p.profile_id, set);
    }
    for (const e of enrollments ?? []) {
      const own = e.profile_id ? byProfile.get(e.profile_id) ?? {} : {};
      rosterPhotos[e.id] = {
        professional: own.professional ?? null,
        candid: own.candid ?? null,
        adventure: own.adventure ?? null,
        roster:
          e.roster_photo_path && urlMap[e.roster_photo_path]
            ? urlMap[e.roster_photo_path]
            : null,
      };
    }
  }

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
      .select(
        "id, title, kind, page_count, created_at, reading_title, transcript_title"
      )
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
  const renderedByDeck = await readRenderedPages(
    supabase,
    (deckRows ?? []).map((d) => d.id)
  );
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
      <div>
        <CourseNameEditor courseId={course.id} name={course.name} />
        <p className="text-sm text-muted-foreground">
          Course setup — room, schedule, attendance, roster, slides,
          icebreakers, invites.
        </p>
      </div>
      <CourseSetupTabs
        course={{
          id: course.id,
          name: course.name,
          join_code: course.join_code,
          icebreaker_fields: (course.icebreaker_fields as string[]) ?? [],
          invite_subject: course.invite_subject,
          invite_message: course.invite_message,
          syllabus_title: course.syllabus_title,
          transcripts_downloadable: course.transcripts_downloadable ?? true,
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
        rosterPhotos={rosterPhotos}
        activation={activation}
        siteUrl={env.siteUrl}
        canvasConnection={canvasConnection}
        canvasLink={
          course.canvas_course_id
            ? {
                canvasCourseId: course.canvas_course_id,
                sectionIds: course.canvas_section_ids,
                syncedAt: course.canvas_synced_at,
              }
            : null
        }
        decks={decks}
        attendancePolicy={parseAttendancePolicy(course.attendance_policy)}
      />
    </div>
  );
}
