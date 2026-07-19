import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { CourseSetupTabs } from "@/components/features/setup/CourseSetupTabs";
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
  const { data: course } = await supabase
    .from("courses")
    .select(
      "id, name, join_code, icebreaker_fields, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, auto_open"
    )
    .eq("id", courseId)
    .single();

  if (!course) notFound();
  if (course.professor_id !== profile.id) redirect(`/course/${courseId}`);

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

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
        <p className="text-sm text-muted-foreground">
          Course setup — room, roster, icebreakers, invites.
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
        }}
        enrollments={enrollments ?? []}
        siteUrl={env.siteUrl}
      />
    </div>
  );
}
