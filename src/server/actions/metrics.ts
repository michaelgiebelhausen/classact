import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";

export interface StudentMetrics {
  sessionsAttended: number;
  verifiedAttendances: number;
  seatsVisited: number;
  peopleMet: number;
  networkingScore: number;
  bestMemoryTiles: number | null;
  bestFlashCards: number | null;
  gamesPlayed: number;
}

export interface CourseStudentRow {
  enrollmentId: string;
  name: string;
  checkIns: number;
  verified: number;
  gamesPlayed: number;
  networkingScore: number;
}

export interface CourseMetrics {
  sessionCount: number;
  totalCheckIns: number;
  verificationRate: number; // 0..1
  students: CourseStudentRow[];
}

/** Metrics for the signed-in student in a course (FR-015). */
export async function getStudentMetrics(
  courseId: string
): Promise<StudentMetrics | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) return null;

  const [{ data: checkins }, { data: verifs }, { data: scores }] =
    await Promise.all([
      supabase
        .from("check_ins")
        .select("seat_id, verified, is_new_seat")
        .eq("enrollment_id", enrollment.id),
      supabase
        .from("seat_verifications")
        .select("subject_enrollment_id, verifier_enrollment_id")
        .or(
          `verifier_enrollment_id.eq.${enrollment.id},subject_enrollment_id.eq.${enrollment.id}`
        ),
      supabase
        .from("name_game_scores")
        .select("game_type, score")
        .eq("enrollment_id", enrollment.id),
    ]);

  const met = new Set<string>();
  for (const v of verifs ?? []) {
    met.add(
      v.verifier_enrollment_id === enrollment.id
        ? v.subject_enrollment_id
        : v.verifier_enrollment_id
    );
  }
  met.delete(enrollment.id);

  const memory = (scores ?? []).filter((s) => s.game_type === "memory_tiles");
  const flash = (scores ?? []).filter((s) => s.game_type === "flash_cards");

  return {
    sessionsAttended: (checkins ?? []).length,
    verifiedAttendances: (checkins ?? []).filter((c) => c.verified).length,
    seatsVisited: new Set((checkins ?? []).map((c) => c.seat_id)).size,
    peopleMet: met.size,
    networkingScore: (checkins ?? []).filter((c) => c.is_new_seat).length,
    bestMemoryTiles:
      memory.length > 0 ? Math.max(...memory.map((s) => s.score)) : null,
    bestFlashCards:
      flash.length > 0 ? Math.max(...flash.map((s) => s.score)) : null,
    gamesPlayed: (scores ?? []).length,
  };
}

/** Participation overview for the owning professor (FR-016). */
export async function getCourseMetrics(
  courseId: string
): Promise<CourseMetrics | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) return null;

  // Professor passes RLS for these tables; admin only as fallback safety.
  const client =
    isConfigured.supabaseAdmin ? createAdminClient() : supabase;

  const [{ data: sessions }, { data: enrollments }] = await Promise.all([
    client.from("class_sessions").select("id").eq("course_id", courseId),
    client
      .from("enrollments")
      .select("id, roster_name")
      .eq("course_id", courseId)
      .eq("status", "active")
      .order("roster_name"),
  ]);

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);
  const [{ data: checkins }, { data: scores }] = await Promise.all([
    enrollmentIds.length > 0
      ? client
          .from("check_ins")
          .select("enrollment_id, verified, is_new_seat")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] as { enrollment_id: string; verified: boolean; is_new_seat: boolean }[] }),
    enrollmentIds.length > 0
      ? client
          .from("name_game_scores")
          .select("enrollment_id")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] as { enrollment_id: string }[] }),
  ]);

  const byEnrollment = new Map<
    string,
    { checkIns: number; verified: number; games: number; networking: number }
  >();
  for (const id of enrollmentIds) {
    byEnrollment.set(id, { checkIns: 0, verified: 0, games: 0, networking: 0 });
  }
  for (const c of checkins ?? []) {
    const agg = byEnrollment.get(c.enrollment_id);
    if (!agg) continue;
    agg.checkIns++;
    if (c.verified) agg.verified++;
    if (c.is_new_seat) agg.networking++;
  }
  for (const s of scores ?? []) {
    const agg = byEnrollment.get(s.enrollment_id);
    if (agg) agg.games++;
  }

  const totalCheckIns = (checkins ?? []).length;
  const totalVerified = (checkins ?? []).filter((c) => c.verified).length;

  return {
    sessionCount: (sessions ?? []).length,
    totalCheckIns,
    verificationRate: totalCheckIns > 0 ? totalVerified / totalCheckIns : 0,
    students: (enrollments ?? []).map((e) => {
      const agg = byEnrollment.get(e.id)!;
      return {
        enrollmentId: e.id,
        name: e.roster_name,
        checkIns: agg.checkIns,
        verified: agg.verified,
        gamesPlayed: agg.games,
        networkingScore: agg.networking,
      };
    }),
  };
}
