import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { getCourseDirectory } from "@/lib/coursedirectory";
import {
  isScheduleComplete,
  meetingStartInstant,
  sessionDateFor,
  type CourseSchedule,
} from "@/lib/schedule";
import { socialModeEndsAt, isSocialMode, type ArrivalSeat } from "@/lib/arrivals";
import { NeighborArrivalListener } from "@/components/features/course/NeighborArrivalListener";

/**
 * Course-level layout, and the reason it exists: mounting the neighbor
 * arrival listener OUTSIDE any one page, so a seated student who wandered
 * off to the name games still gets the "Alex just sat down to your left —
 * say hi!" toast during arrival.
 *
 * It stays deliberately cheap and deliberately inert. Every gate below must
 * pass before it loads anything beyond one enrollment probe, and it NEVER
 * opens a session (auto-open belongs to the check-in page alone):
 *
 *   - enrolled students only — professors have no enrollment, so the
 *     projected screen mounts nothing;
 *   - an open session today;
 *   - the social window still running: from the scheduled start (sharp),
 *     arrivals are confirmed silently from the card, so the whole listener
 *     is withheld rather than muted.
 */
export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bare = <>{children}</>;

  const profile = await getProfile();
  if (!profile) return bare;

  const supabase = await createClient();
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return bare;

  const { data: course } = await supabase
    .from("courses")
    .select(
      "id, meeting_days, meeting_start, meeting_end, timezone, term_start, term_end"
    )
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return bare;

  const schedule: CourseSchedule | null = isScheduleComplete({
    days: course.meeting_days,
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

  const now = new Date();
  const today = schedule
    ? sessionDateFor(schedule, now)
    : now.toISOString().slice(0, 10);

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, opened_at")
    .eq("course_id", courseId)
    .eq("session_date", today)
    .is("closed_at", null)
    .maybeSingle();
  if (!session) return bare;

  const socialEndsAt = socialModeEndsAt(
    schedule ? meetingStartInstant(schedule, today)?.toISOString() ?? null : null,
    session.opened_at
  );
  if (!isSocialMode(socialEndsAt, now)) return bare;

  const [{ data: seatRows }, { data: checkins }, { data: myVerifs }] =
    await Promise.all([
      supabase.from("seats").select("id, label, neighbors").eq("course_id", courseId),
      supabase
        .from("check_ins")
        .select("id, enrollment_id, seat_id")
        .eq("session_id", session.id),
      supabase
        .from("seat_verifications")
        .select("verifier_enrollment_id, subject_enrollment_id")
        .or(
          `verifier_enrollment_id.eq.${enrollment.id},subject_enrollment_id.eq.${enrollment.id}`
        ),
    ]);

  const seats: ArrivalSeat[] = (seatRows ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    neighbors: s.neighbors ?? {},
  }));
  const metBeforeIds = [
    ...new Set(
      (myVerifs ?? []).map((v) =>
        v.verifier_enrollment_id === enrollment.id
          ? v.subject_enrollment_id
          : v.verifier_enrollment_id
      )
    ),
  ];

  // Names only — the per-course directory is TTL-cached, so this is the
  // same object the check-in page shares; photos are deliberately dropped.
  let names: Record<string, string> = {};
  if (isConfigured.supabaseAdmin) {
    const directory = await getCourseDirectory(createAdminClient(), courseId);
    names = Object.fromEntries(
      Object.entries(directory).map(([id, entry]) => [id, entry.name])
    );
  }

  return (
    <>
      <NeighborArrivalListener
        sessionId={session.id}
        myEnrollmentId={enrollment.id}
        seats={seats}
        initialOccupants={(checkins ?? []).map((c) => ({
          id: c.id,
          enrollmentId: c.enrollment_id,
          seatId: c.seat_id,
        }))}
        metBeforeIds={metBeforeIds}
        names={names}
        socialEndsAt={socialEndsAt!.toISOString()}
      />
      {children}
    </>
  );
}
