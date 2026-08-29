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
  meetingStartInstant,
  sessionDateFor,
  type CourseSchedule,
} from "@/lib/schedule";
import { socialModeEndsAt } from "@/lib/arrivals";
import { flashcardHintFields } from "@/lib/icebreakers";
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
import { loadCourseSeats } from "@/server/courseseats";
import { checkSchema } from "@/server/schemaguard";
import {
  CHECKIN_TABLES,
  gapsForTables,
  migrationsToRun,
} from "@/lib/schemacontract";
import { SchemaBehindNotice } from "@/components/features/checkin/SchemaBehindNotice";

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
      "id, name, professor_id, room_id, meeting_days, meeting_start, meeting_end, timezone, auto_open, term_start, term_end, attendance_policy, icebreaker_fields"
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
    .select("id, closed_at, opened_at")
    .eq("course_id", courseId)
    .eq("session_date", today)
    .is("closed_at", null)
    .maybeSingle();
  let sessionId = session?.id ?? null;
  let sessionOpenedAt = session?.opened_at ?? null;

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
      sessionOpenedAt = new Date().toISOString();
    } else if (openError?.code === "23505") {
      // Someone else opened it between our check and insert.
      const { data: raced } = await supabase
        .from("class_sessions")
        .select("id, opened_at")
        .eq("course_id", courseId)
        .eq("session_date", today)
        .is("closed_at", null)
        .maybeSingle();
      sessionId = raced?.id ?? null;
      sessionOpenedAt = raced?.opened_at ?? null;
    }
  }

  // The social/quiet boundary: "introduce yourself" framing until the
  // scheduled start, silent confirmations after. Computed once, server-side,
  // so every client agrees on the minute. Courses without a schedule get a
  // bounded window after the session opened instead.
  const socialEndsAt = socialModeEndsAt(
    schedule ? meetingStartInstant(schedule, today)?.toISOString() ?? null : null,
    sessionOpenedAt
  );

  // Is the database actually carrying the columns this page reads? If not,
  // the occupants query below returns nothing and the room draws empty —
  // indistinguishable from a class nobody came to. Cached per instance, so
  // this costs a healthy deployment one probe at boot and nothing after.
  //
  // Narrowed to check-in's OWN tables: a missing column in assignments or
  // profile_documents says nothing about whether this seat map can be drawn,
  // and blocking attendance over it would make the guard more dangerous than
  // the failure it exists to catch.
  const schema = await checkSchema();
  const checkinGaps = gapsForTables(schema.gaps, CHECKIN_TABLES);
  const schemaGap =
    checkinGaps.length > 0 ? migrationsToRun(checkinGaps) : null;

  // Seats with geometry and adjacency, shared with every other page that
  // draws this room.
  const seats: SeatInfo[] = await loadCourseSeats(
    supabase,
    courseId,
    course.room_id
  );

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
  // classmates I've met — surfaced at the moment of choosing a seat. The
  // same verifications query also yields WHO I've met, which decides whether
  // a neighbor gets the full introduction treatment or a quiet one-tap
  // re-confirm.
  let mySeatIds: string[] = [];
  let peopleMet = 0;
  let metBeforeIds: string[] = [];
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
    metBeforeIds = [
      ...new Set(
        (myVerifs ?? []).map((v) =>
          v.verifier_enrollment_id === myEnrollmentId
            ? v.subject_enrollment_id
            : v.verifier_enrollment_id
        )
      ),
    ];
    peopleMet = metBeforeIds.length;
  }

  if (sessionId) {
    const { data: checkins } = await supabase
      .from("check_ins")
      .select(
        "id, enrollment_id, seat_id, verified, denied_count, professor_confirmed_at"
      )
      .eq("session_id", sessionId);
    initialOccupants = (checkins ?? []).map((c) => ({
      id: c.id,
      enrollmentId: c.enrollment_id,
      seatId: c.seat_id,
      verified: c.verified,
      deniedCount: c.denied_count ?? 0,
      professorConfirmed: c.professor_confirmed_at != null,
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

  // One icebreaker fact per classmate, for the introduction rows: the FIRST
  // answered flashcard-eligible field in catalog order — the same selection
  // rule the name-game flash cards use, so the fact a student reads at
  // check-in matches the one on that person's card in the games.
  let neighborFacts: Record<string, { label: string; value: string }> = {};
  if (!isProfessor && myEnrollmentId && sessionId && isConfigured.supabaseAdmin) {
    const hintFields = flashcardHintFields(
      (course.icebreaker_fields as string[] | null) ?? []
    );
    if (hintFields.length > 0) {
      const admin = createAdminClient();
      const { data: answers } = await admin
        .from("student_answers")
        .select("enrollment_id, field_key, value, enrollments!inner(course_id)")
        .eq("enrollments.course_id", courseId);
      const byEnrollment = new Map<string, Map<string, string>>();
      for (const a of answers ?? []) {
        const value = (a.value ?? "").trim();
        if (!value) continue;
        let m = byEnrollment.get(a.enrollment_id);
        if (!m) {
          m = new Map();
          byEnrollment.set(a.enrollment_id, m);
        }
        m.set(a.field_key, value);
      }
      const facts: Record<string, { label: string; value: string }> = {};
      for (const [enrollmentId, m] of byEnrollment) {
        for (const f of hintFields) {
          const value = m.get(f.key);
          if (value) {
            facts[enrollmentId] = { label: f.label, value };
            break;
          }
        }
      }
      neighborFacts = facts;
    }
  }

  // Names and faces come from the same per-course directory the live map uses,
  // so the two maps agree and this costs no extra queries.
  const lastSessionOccupants: LastSessionOccupant[] = (lastSession?.rows ?? [])
    .map((r) => ({
      seatId: r.seatId,
      name: directory[r.enrollmentId]?.name ?? null,
      firstName: directory[r.enrollmentId]?.firstName ?? null,
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

      {schemaGap ? (
        <SchemaBehindNotice
          migrations={schemaGap}
          isProfessor={isProfessor}
        />
      ) : (
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
        metBeforeIds={metBeforeIds}
        neighborFacts={neighborFacts}
        socialEndsAt={socialEndsAt ? socialEndsAt.toISOString() : null}
        scheduleHint={
          schedule
            ? `Class meets ${formatSchedule(schedule)}${
                course.auto_open ? " — check-in opens automatically 15 minutes before class." : "."
              }`
            : null
        }
      />
      )}

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
