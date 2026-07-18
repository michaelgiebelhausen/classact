import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth";
import { resolveEnrollmentPhotos } from "@/lib/storage";
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
    .select("id, name, professor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();
  const isProfessor = course.professor_id === profile.id;

  // Today's open session (if any).
  const today = new Date().toISOString().slice(0, 10);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, closed_at")
    .eq("course_id", courseId)
    .eq("session_date", today)
    .is("closed_at", null)
    .maybeSingle();
  const sessionId = session?.id ?? null;

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
      />
    </div>
  );
}
