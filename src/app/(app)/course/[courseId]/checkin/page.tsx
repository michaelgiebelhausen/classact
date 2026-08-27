import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getCourseDirectory } from "@/lib/coursedirectory";
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
import { ReportAbsence } from "@/components/features/checkin/ReportAbsence";
import { ScheduledAbsences } from "@/components/features/checkin/ScheduledAbsences";
import { CollapsedAbsences } from "@/components/features/checkin/CollapsedAbsences";
import {
  LastSessionMap,
  type LastSessionOccupant,
} from "@/components/features/checkin/LastSessionMap";
import {
  listCourseAbsences,
  listMyAbsences,
  type CourseAbsenceView,
  type MyAbsenceView,
} from "@/server/actions/absences";
import { parseAttendancePolicy } from "@/lib/absences";
import { recentMeetingDates, upcomingMeetingDates } from "@/lib/schedule";
import { timed } from "@/server/loadmetrics";

/**
 * Absence assessment posts to this route and waits on a model call (60s
 * client-side timeout). The platform default is shorter than that, so the
 * function would be killed before the fetch could give up gracefully.
 */
export const maxDuration = 90;
import { tableFootprint, type RoomLayout, type TableFootprint } from "@/lib/roomlayout";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  // Every `router.refresh()` from every phone in the room re-runs the whole
  // render below. Measuring it is how we find out what one refresh costs.
  // Timed from out here rather than inside: reading the clock during render
  // is impure, and the render itself must stay pure.
  return timed("checkin_page", { courseId }, () => renderCheckIn(courseId));
}

async function renderCheckIn(courseId: string) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // RLS membership gate — non-members get null.
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select(
      "id, name, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, auto_open, term_start, term_end, attendance_policy"
    )
    .eq("id", courseId)
    .single();
  // PGRST116 = no row (not a member, or no such course). Anything else — e.g.
  // 42703 from an unapplied migration — is a real failure, not a 404.
  if (courseError && courseError.code !== "PGRST116") {
    console.error("[checkin] course query failed:", {
      code: courseError.code,
      message: courseError.message,
      hint: courseError.hint,
    });
    throw new Error(
      `Check-in couldn't load: ${courseError.message}. If that names a missing column, run the migrations that haven't been applied yet in the Supabase SQL editor (supabase/catchup_0019_to_0023.sql, then 0024 and 0025 — attendance_policy comes from 0025).`
    );
  }
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
        termStart: course.term_start,
        termEnd: course.term_end,
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
  // Table furniture lives in the room's layout, not on the seat rows —
  // without it every table draws as an oval however it was designed, and a
  // table against a wall draws centered on its chairs instead of on the wall.
  const tableShapes = new Map<string, "rect" | "oval" | "ushape">();
  const tableFootprints = new Map<string, TableFootprint>();
  if (course.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("layout")
      .eq("id", course.room_id)
      .maybeSingle();
    const layout = room?.layout as unknown as RoomLayout | null;
    for (const section of layout?.sections ?? []) {
      if (section.kind !== "table") continue;
      tableShapes.set(section.id, section.shape);
      const footprint = tableFootprint(section);
      if (footprint) tableFootprints.set(section.id, footprint);
    }
  }

  const seats: SeatInfo[] = (seatRows ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    x: s.x ?? s.col_index ?? 0,
    y: s.y ?? (s.row_index ?? 0) * 1.25,
    section: s.section ?? "main",
    tableId: s.table_id ?? null,
    tableShape: s.table_id ? tableShapes.get(s.table_id) : undefined,
    tableFootprint: s.table_id ? tableFootprints.get(s.table_id) : undefined,
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

  // Seat-variety nudge data: which seats I've already tried and how many
  // classmates I've met — surfaced at the moment of choosing a seat.
  let mySeatIds: string[] = [];
  let peopleMet = 0;
  if (myEnrollmentId) {
    const [{ data: myCheckIns }, { data: myVerifs }] = await Promise.all([
      supabase
        .from("check_ins")
        .select("seat_id, is_new_seat")
        .eq("enrollment_id", myEnrollmentId),
      supabase
        .from("seat_verifications")
        .select("verifier_enrollment_id, subject_enrollment_id")
        .or(
          `verifier_enrollment_id.eq.${myEnrollmentId},subject_enrollment_id.eq.${myEnrollmentId}`
        ),
    ]);
    networkingScore = (myCheckIns ?? []).filter((c) => c.is_new_seat).length;
    mySeatIds = [...new Set((myCheckIns ?? []).map((c) => c.seat_id))];
    peopleMet = new Set(
      (myVerifs ?? []).map((v) =>
        v.verifier_enrollment_id === myEnrollmentId
          ? v.subject_enrollment_id
          : v.verifier_enrollment_id
      )
    ).size;
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

  // The most recent class that actually happened, for the reference map under
  // the live one. "Most recent" means most recent WITH check-ins: a cancelled
  // or unopened day would otherwise render as an empty room and read as a
  // class where nobody came.
  let lastSession:
    | { date: string; rows: Array<{ seatId: string; enrollmentId: string }> }
    | null = null;
  if (isProfessor) {
    const { data: priorSessions } = await supabase
      .from("class_sessions")
      .select("id, session_date")
      .eq("course_id", courseId)
      .lt("session_date", today)
      .order("session_date", { ascending: false })
      .limit(8);

    for (const prior of priorSessions ?? []) {
      const { data: rows } = await supabase
        .from("check_ins")
        .select("enrollment_id, seat_id")
        .eq("session_id", prior.id);
      if ((rows ?? []).length === 0) continue;
      lastSession = {
        date: prior.session_date,
        rows: (rows ?? []).map((r) => ({
          seatId: r.seat_id,
          enrollmentId: r.enrollment_id,
        })),
      };
      break;
    }
  }

  // Directory (names + one photo, no emails) via admin — the RLS course
  // check above already proved membership.
  //
  // Shared per course rather than rebuilt per viewer: the result is identical
  // for everyone in the room, and it costs two queries plus a storage call
  // that signs a URL for every photo in the class. Thirty students arriving
  // at once used to run thirty copies of that inside the same few seconds.
  const directory: Record<string, DirectoryEntry> = isConfigured.supabaseAdmin
    ? await getCourseDirectory(createAdminClient(), courseId)
    : {};

  // Names and faces come from the same per-course directory the live map uses,
  // so the two maps agree and this costs no extra queries.
  const lastSessionOccupants: LastSessionOccupant[] = (lastSession?.rows ?? [])
    .map((r) => ({
      seatId: r.seatId,
      name: directory[r.enrollmentId]?.name ?? null,
      photoUrl: directory[r.enrollmentId]?.photoUrl ?? null,
    }));

  // Absences. The professor gets the whole judged list; a student gets their
  // own reports plus the next few class dates to pick from.
  const [courseAbsences, myAbsences]: [CourseAbsenceView[], MyAbsenceView[]] =
    isProfessor
      ? [await listCourseAbsences(courseId), []]
      : [[], await listMyAbsences(courseId)];
  const upcomingDates =
    !isProfessor && schedule ? upcomingMeetingDates(schedule, new Date(), 8) : [];
  // Illness is usually reported after the fact, so recent classes have to be
  // offerable too — bounded by the same 14 days the server accepts.
  const pastDates =
    !isProfessor && schedule ? recentMeetingDates(schedule, new Date(), 14) : [];
  const policy = parseAttendancePolicy(course.attendance_policy);
  // Has the professor actually set a policy, or are we running on defaults?
  // Only quote expectations to students when they're really the professor's.
  const policySet =
    !!course.attendance_policy &&
    Object.keys(course.attendance_policy as Record<string, unknown>).length > 0;
  const policyNote = isProfessor
    ? null
    : policySet
      ? `Your professor expects ${policy.advanceNoticeHours} hours' notice for planned absences.`
      : "Give as much notice as you can — planned absences reported early are the easiest to excuse.";

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
        canReassign={isProfessor}
        networkingScore={networkingScore}
        verifiedByMe={verifiedByMe}
        mySeatIds={mySeatIds}
        peopleMet={peopleMet}
        scheduleHint={
          schedule
            ? `Class meets ${formatSchedule(schedule)}${
                course.auto_open ? " — check-in opens automatically 15 minutes before class." : "."
              }`
            : null
        }
      />

      {/* Absences: report one instead of emailing (student), or read the
          already-judged list (professor). */}
      {/* Last class, under the live map. Doubles as the thing that pushes the
          absence list below the fold on a projected screen. */}
      {isProfessor && lastSession && lastSessionOccupants.length > 0 && (
        <LastSessionMap
          seats={seats}
          occupants={lastSessionOccupants}
          date={lastSession.date}
        />
      )}

      {isProfessor ? (
        <CollapsedAbsences count={courseAbsences.length}>
          <ScheduledAbsences rows={courseAbsences} policySet={policySet} />
        </CollapsedAbsences>
      ) : myEnrollmentId ? (
        <ReportAbsence
          courseId={courseId}
          upcomingDates={upcomingDates}
          pastDates={pastDates}
          mine={myAbsences}
          policyNote={policyNote}
        />
      ) : null}
    </div>
  );
}
