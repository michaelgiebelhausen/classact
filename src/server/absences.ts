import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";

/**
 * Absence helpers that must NOT be server actions.
 *
 * Anything exported from a "use server" module becomes a callable POST
 * endpoint, so a service-role write that takes an identity as a parameter
 * belongs here instead — this module is import-only, reachable from server
 * code and from nowhere else.
 */

/**
 * The caller checked into `courseId` on `date`; flag any absence they
 * reported for that date in their OTHER ClassAct courses. Which course they
 * attended is never recorded — only that they were somewhere.
 *
 * Trusts `profileId` completely, which is why it isn't an action: the only
 * caller has already authenticated the user and written their check-in.
 */
export async function flagAbsencesElsewhere(
  profileId: string,
  courseId: string,
  date: string
): Promise<void> {
  if (!isConfigured.supabaseAdmin) return;
  try {
    const admin = createAdminClient();
    const { data: others } = await admin
      .from("enrollments")
      .select("id")
      .eq("profile_id", profileId)
      .neq("course_id", courseId);
    const ids = (others ?? []).map((e) => e.id);
    if (ids.length === 0) return;
    await admin
      .from("absences")
      .update({ attended_elsewhere: true, updated_at: new Date().toISOString() })
      .in("enrollment_id", ids)
      .eq("absence_date", date)
      .eq("attended_elsewhere", false);
  } catch (e) {
    console.error("[absences] flagAbsencesElsewhere:", e);
  }
}

/**
 * Did this profile check into a class on `date` in any course other than
 * `courseId`? Enrollment ids are per-course, so this goes through the
 * profile. Service role, because RLS scopes check-ins to each course.
 */
export async function checkedInElsewhere(
  profileId: string,
  courseId: string,
  date: string
): Promise<boolean> {
  if (!isConfigured.supabaseAdmin) return false;
  const admin = createAdminClient();
  const { data: myEnrollments } = await admin
    .from("enrollments")
    .select("id")
    .eq("profile_id", profileId)
    .neq("course_id", courseId);
  const ids = (myEnrollments ?? []).map((e) => e.id);
  if (ids.length === 0) return false;
  const { data: rows } = await admin
    .from("check_ins")
    .select("id, class_sessions!inner(session_date)")
    .in("enrollment_id", ids)
    .eq("class_sessions.session_date", date)
    .limit(1);
  return (rows ?? []).length > 0;
}
