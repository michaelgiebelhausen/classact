"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import { studentViewPath } from "@/lib/studentview";
import type { ActionResult } from "@/server/actions/auth";

/** Source ownership is checked on EVERY entry/reset, before any admin access. */
export async function enterStudentView(sourceId: string, path: string, reset = false, expectedPracticeId?: string): Promise<ActionResult<{ path: string }>> {
  if (!isConfigured.supabaseAdmin) return { ok: false, error: "Student View needs the server database connection." };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: source, error } = await client.from("courses").select("id, professor_id, practice_source_id").eq("id", sourceId).single();
  if (error || !source || source.professor_id !== user.id || source.practice_source_id) return { ok: false, error: "Only the current instructor can preview this course. Check that migration 0054 is installed." };
  const admin = createAdminClient();
  let { data: practice } = await admin.from("courses").select("id, professor_id, practice_routes, practice_instructor_id").eq("practice_source_id", sourceId).maybeSingle();
  if (practice && practice.practice_instructor_id !== user.id) return { ok: false, error: "This course changed owners. Its old practice copy needs administrator cleanup." };
  if (reset && (!practice || practice.id !== expectedPracticeId)) return { ok: false, error: "The practice copy changed. Exit and reopen Student View before resetting." };
  if (!practice || reset) {
    let ownerId = practice?.professor_id;
    let newOwner = false;
    if (!ownerId) {
      // No password and no delivered email; nobody signs in as this hidden owner.
      const created = await admin.auth.admin.createUser({ email: `practice-${randomUUID()}@classact.invalid`, email_confirm: true, app_metadata: { practice_owner_for: user.id }, user_metadata: { full_name: "Practice instructor" } });
      if (created.error || !created.data.user) return { ok: false, error: "Could not prepare the practice course. Try again." };
      ownerId = created.data.user.id;
      newOwner = true;
    }
    const { data: id, error: copyError } = await admin.rpc("create_practice_course", { p_source: sourceId, p_instructor: user.id, p_owner: ownerId, p_reset: reset, p_expected: expectedPracticeId ?? null });
    if (copyError || !id) {
      if (newOwner) await admin.auth.admin.deleteUser(ownerId);
      // A concurrent click may have won the unique source lock. Reuse its copy.
      const { data: winner } = await admin.from("courses").select("id, professor_id, practice_routes, practice_instructor_id").eq("practice_source_id", sourceId).eq("practice_instructor_id", user.id).maybeSingle();
      if (!winner || reset) return { ok: false, error: "Could not create the practice snapshot. Your existing work is unchanged. Check migration 0054 and try again." };
      practice = winner;
    } else {
      const result = await admin.from("courses").select("id, professor_id, practice_routes, practice_instructor_id").eq("id", id).single();
      practice = result.data;
    }
  }
  if (!practice) return { ok: false, error: "Could not load the practice copy." };
  // Refresh only the practice session so check-in works on a later visit too.
  const { data: course } = await admin.from("courses").select("timezone").eq("id", practice.id).single();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: course?.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const session = await admin.from("class_sessions").upsert({ course_id: practice.id, session_date: date, closed_at: null }, { onConflict: "course_id,session_date" });
  if (session.error) return { ok: false, error: "The practice copy is ready, but its attendance session could not open. Try again." };
  return { ok: true, data: { path: studentViewPath(path, sourceId, practice.id, practice.practice_routes) } };
}

/** Explicit practice control; deadlines in the live course never change. */
export async function reopenPracticeAssignments(courseId: string): Promise<ActionResult> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { data: course } = await client.from("courses").select("practice_source_id, practice_instructor_id").eq("id", courseId).single();
  if (!course?.practice_source_id || course.practice_instructor_id !== user.id) return { ok: false, error: "This is not your practice course." };
  const { data: source } = await client.from("courses").select("professor_id").eq("id", course.practice_source_id).single();
  if (source?.professor_id !== user.id) return { ok: false, error: "Only the current instructor can change practice settings." };
  const deadline = new Date(Date.now() + 7 * 86400000).toISOString();
  const { error } = await createAdminClient().from("assignments").update({ state: "open", deadline, peer_close_at: deadline, published_at: null, analysis: {} }).eq("course_id", courseId);
  return error ? { ok: false, error: "Could not reopen practice assignments." } : { ok: true };
}
