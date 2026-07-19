import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";
import {
  formatSchedule,
  isMeetingWindow,
  isScheduleComplete,
  sessionDateFor,
  type CourseSchedule,
} from "@/lib/schedule";
import {
  CheckInLive,
  type DirectoryEntry,
  type OccupantInfo,
  type SeatInfo,
} from "@/components/features/checkin/CheckInLive";
import { SessionControls } from "@/components/features/checkin/SessionControls";

export default async function CheckInPage({
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
      "id, name, professor_id, meeting_days, meeting_start, meeting_end, timezone, auto_open"
    )
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  // The course's schedule, when the professor has set one.
  const schedule: CourseSchedule | null = isScheduleComplete({
    days: (course.meeting_days as number[]) ?? [],
    start: course.meeting_start,
    end: course.meeting_end,
    timezone: course.timezone,
  })
    ? {
        days: course.meeting_days as number[],
        start: course.meeting_start as string,
        end: course.meeting_end as string,
        timezone: course.timezone as string,
      }
    : null;

  // "Today" in the course's timezone (falls back to server UTC date).
  const now = new Date();
  const today = schedule
    ? sessionDateFor(schedule, now)
    : now.toISOString().slice(0, 10);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, closed_at")
    .eq("course_id", courseId)
    .eq("session_date", today)
    .is("closed_at", null)
    .maybeSingle();
  let sessionId = session?.id ?? null;

  // Scheduled auto-open: inside the meeting window (start − 15 min → end),
  // the first person to load this page opens the session — no professor
  // click needed. The unique (course_id, session_date) constraint makes
  // concurrent opens race-safe.
  if (
    !sessionId &&
    schedule &&
    course.auto_open &&
    isConfigured.supabaseAdmin &&
    isMeetingWindow(schedule, now)
  ) {
    const admin = createAdminClient();
    const { data: opened, error: openError } = await admin
      .from("class_sessions")
      .insert({ course_id: courseId, session_date: today })
      .select("id")
      .maybeSingle();
    if (opened) {
      sessionId = opened.id;
    } else if (openError?.code === "23505") {
      // Someone else opened it between our check and insert.
      const { data: raced } = await supabase
        .from("class_sessions")
        .select("id")
        .eq("course_id", courseId)
        .eq("session_date", today)
        .is("closed_at", null)
        .maybeSingle();
      sessionId = raced?.id ?? null;
    }
  }

  // Seats with geometry. Pre-migration rows without x/y fall back to their
  // grid coords so the map never comes up blank.
  const { data: seatRows } = await supabase
    .from("seats")
    .select("id, label, row_index, col_index, x, y, section, table_id, neighbors")
    .eq("course_id", courseId);
  const seats: SeatInfo[] = (seatRows ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    x: s.x ?? s.col_index ?? 0,
    y: s.y ?? (s.row_index ?? 0) * 1.25,
    section: s.section ?? "main",
    tableId: s.table_id ?? null,
    neighbors: s.neighbors ?? {},
  }));

  // Occupants + my enrollment + my score + who I've verified today.
  let initialOccupants: OccupantInfo[] = [];
  let myEnrollmentId: string | null = null;
  let networkingScore = 0;
  let verifiedByMe: string[] = [];

  const { data: myEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  myEnrollmentId = myEnrollment?.id ?? null;

  if (myEnrollmentId) {
    const { count } = await supabase
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", myEnrollmentId)
      .eq("is_new_seat", true);
    networkingScore = count ?? 0;
  }

  if (sessionId) {
    const { data: checkins } = await supabase
      .from("check_ins")
      .select("enrollment_id, seat_id, verified")
      .eq("session_id", sessionId);
    initialOccupants = (checkins ?? []).map((c) => ({
      enrollmentId: c.enrollment_id,
      seatId: c.seat_id,
      verified: c.verified,
    }));

    if (myEnrollmentId) {
      const { data: myVerifs } = await supabase
        .from("seat_verifications")
        .select("subject_enrollment_id")
        .eq("session_id", sessionId)
        .eq("verifier_enrollment_id", myEnrollmentId);
      verifiedByMe = (myVerifs ?? []).map((v) => v.subject_enrollment_id);
    }
  }

  // Directory (names + one photo, no emails) via admin — the RLS course
  // check above already proved membership.
  const directory: Record<string, DirectoryEntry> = {};
  if (isConfigured.supabaseAdmin) {
    const admin = createAdminClient();
    const { data: enrollments } = await admin
      .from("enrollments")
      .select("id, roster_name, profile_id, roster_photo_path")
      .eq("course_id", courseId);

    const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);
    for (const e of enrollments ?? []) {
      directory[e.id] = {
        name: e.roster_name,
        photoUrl: photoMap.get(e.id)?.[0] ?? null,
      };
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isProfessor ? "Today's session" : "Check in"}
          </h1>
          <p className="text-sm text-muted-foreground">{course.name}</p>
        </div>
        {isProfessor && (
          <SessionControls courseId={courseId} sessionId={sessionId} />
        )}
      </div>

      <CheckInLive
        courseId={courseId}
        sessionId={sessionId}
        seats={seats}
        initialOccupants={initialOccupants}
        directory={directory}
        myEnrollmentId={isProfessor ? null : myEnrollmentId}
        networkingScore={networkingScore}
        verifiedByMe={verifiedByMe}
        scheduleHint={
          schedule
            ? `Class meets ${formatSchedule(schedule)}${
                course.auto_open ? " — check-in opens automatically 15 minutes before class." : "."
              }`
            : null
        }
      />
    </div>
  );
}
