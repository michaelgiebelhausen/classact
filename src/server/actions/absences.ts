"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import {
  ALLOWED_DOC_MIME,
  MAX_DOC_BASE64_CHARS,
  advanceHours,
  categoryLabel,
  finalVerdict,
  isAbsenceCategory,
  isVerdict,
  noticeLabel,
  parseAttendancePolicy,
  policyOverride,
  type AttendancePolicy,
} from "@/lib/absences";
import {
  formatSchedule,
  isScheduleComplete,
  meetingStartInstant,
  type CourseSchedule,
} from "@/lib/schedule";
import { resolveCourseAi } from "@/server/aicreds";
import { assessAbsence } from "@/server/absenceai";
import { sendAbsenceAppealNotification } from "@/lib/email";
import type { AbsenceRow, AbsenceVerdict } from "@/types/db";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Self-reported absences. Every write here goes through the service-role
 * client after this file has checked who's asking — RLS on `absences` is
 * deliberately read-only for students, so the browser can't file an absence
 * or touch a verdict except through these actions.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function needsAdmin(): { ok: false; error: string } | null {
  if (isConfigured.supabaseAdmin) return null;
  return {
    ok: false,
    error:
      "Absence reporting isn't available on this server yet (missing SUPABASE_SERVICE_ROLE_KEY).",
  };
}

async function loadCourse(courseId: string) {
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select(
      "id, name, professor_id, meeting_days, meeting_start, meeting_end, timezone, term_start, term_end, attendance_policy"
    )
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;
  const schedule: CourseSchedule | null = isScheduleComplete({
    days: (course.meeting_days as number[]) ?? [],
    start: course.meeting_start,
    end: course.meeting_end,
    timezone: course.timezone,
  })
    ? {
        days: course.meeting_days as number[],
        start: course.meeting_start!,
        end: course.meeting_end!,
        timezone: course.timezone!,
        termStart: course.term_start,
        termEnd: course.term_end,
      }
    : null;
  return {
    ...course,
    schedule,
    policy: parseAttendancePolicy(course.attendance_policy),
  };
}

/* ---------------- Policy (professor) ---------------- */

export async function updateAttendancePolicy(
  courseId: string,
  input: Partial<AttendancePolicy>
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Parse leniently (clamps numbers, drops unknown categories) then persist
  // the clean shape; RLS (courses_update → professor) guards the write.
  const policy = parseAttendancePolicy(input);
  const { error } = await supabase
    .from("courses")
    .update({ attendance_policy: policy as unknown as Record<string, unknown> })
    .eq("id", courseId);
  if (error) {
    console.error("[absences] policy update failed:", error.message);
    return { ok: false, error: "Couldn't save the policy. Try again." };
  }
  revalidatePath(`/course/${courseId}/setup`);
  revalidatePath(`/course/${courseId}/checkin`);
  return { ok: true };
}

/* ---------------- Submit (student) ---------------- */

export interface SubmitAbsenceInput {
  courseId: string;
  date: string;
  category: string;
  explanation: string;
  document: { mimeType: string; base64: string } | null;
}

export interface SubmitAbsenceResult {
  id: string;
  verdict: AbsenceVerdict;
  reason: string;
  date: string;
}

export async function submitAbsence(
  input: SubmitAbsenceInput
): Promise<ActionResult<SubmitAbsenceResult>> {
  const gate = needsAdmin();
  if (gate) return gate;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Validate the report before spending anything on it.
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Pick the class date." };
  if (!isAbsenceCategory(input.category)) {
    return { ok: false, error: "Pick the reason that fits best." };
  }
  const explanation = input.explanation.trim();
  if (explanation.length < 10) {
    return { ok: false, error: "Say a sentence or two about what's going on." };
  }
  if (explanation.length > 2000) {
    return { ok: false, error: "Keep the explanation under 2,000 characters." };
  }
  let document: { mimeType: string; base64: string } | null = null;
  if (input.document) {
    if (!ALLOWED_DOC_MIME.has(input.document.mimeType)) {
      return { ok: false, error: "Attach a JPEG, PNG, WebP, or PDF." };
    }
    if (input.document.base64.length > MAX_DOC_BASE64_CHARS) {
      return { ok: false, error: "That file is too large — keep it under about 6 MB." };
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(input.document.base64.slice(0, 2000))) {
      return { ok: false, error: "That attachment couldn't be read." };
    }
    document = input.document;
  }

  const admin = createAdminClient();
  const course = await loadCourse(input.courseId);
  if (!course) return { ok: false, error: "Course not found." };

  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, roster_name")
    .eq("course_id", input.courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "You're not on this course's active roster." };
  }

  // One report per class date; point at the existing one rather than fail.
  const { data: existing } = await admin
    .from("absences")
    .select("id, ai_verdict, professor_verdict, ai_reason")
    .eq("enrollment_id", enrollment.id)
    .eq("absence_date", input.date)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `You already reported an absence for ${input.date} — it's ${finalVerdict(
        existing
      )}. Appeal that one if you need to.`,
    };
  }

  // Notice: submission vs. the class start on that date, course timezone.
  const submittedAt = new Date();
  const meetingStart = course.schedule
    ? meetingStartInstant(course.schedule, input.date)
    : null;
  const notice = advanceHours(submittedAt, meetingStart);
  const meetingLabel = course.schedule ? formatSchedule(course.schedule) : null;

  // History this term (for the model's "repeat pattern" judgment).
  const { data: priors } = await admin
    .from("absences")
    .select("ai_verdict, professor_verdict")
    .eq("enrollment_id", enrollment.id);
  let priorExcused = 0;
  let priorUnexcused = 0;
  for (const p of priors ?? []) {
    if (finalVerdict(p) === "excused") priorExcused++;
    else priorUnexcused++;
  }

  // Already checked into another ClassAct class on this date?
  const attendedElsewhere = await checkedInElsewhere(admin, user.id, input.courseId, input.date);

  // Policy facts first; the model only rules on what's genuinely a judgment.
  const override = policyOverride(course.policy, {
    category: input.category,
    hasDocumentation: document !== null,
  });

  let verdict: AbsenceVerdict;
  let legitimacy: number;
  let summary: string;
  let reason: string;
  let docKind: string | null = null;
  let docAuthenticity: number | null = null;
  let flags: string[] = [];

  if (override) {
    verdict = override.verdict;
    legitimacy = 50;
    summary = override.summary;
    reason = override.reason;
    flags = ["contradicts_policy"];
  } else {
    const creds = await resolveCourseAi(input.courseId, "absence");
    if (!creds) {
      return {
        ok: false,
        error:
          "Absence assessment isn't available right now — the server has no AI key configured. Email your professor instead.",
      };
    }
    const result = await assessAbsence(
      {
        courseName: course.name,
        policy: course.policy,
        category: input.category,
        explanation,
        absenceDate: input.date,
        meetingLabel,
        advanceHours: notice,
        priorExcused,
        priorUnexcused,
        attendedElsewhere,
        document,
      },
      creds
    );
    if (!result.ok) return { ok: false, error: result.error };
    verdict = result.assessment.verdict;
    legitimacy = result.assessment.legitimacy;
    summary = result.assessment.summary;
    reason = result.assessment.reason;
    docKind = result.assessment.docKind;
    docAuthenticity = result.assessment.docAuthenticity;
    flags = result.assessment.flags;
  }

  // The document is out of scope from here on — nothing below touches it.
  const { data: created, error } = await admin
    .from("absences")
    .insert({
      course_id: input.courseId,
      enrollment_id: enrollment.id,
      absence_date: input.date,
      category: input.category,
      explanation,
      submitted_at: submittedAt.toISOString(),
      advance_hours: notice,
      has_documentation: document !== null,
      documentation_kind: docKind,
      ai_doc_authenticity: docAuthenticity,
      ai_verdict: verdict,
      ai_legitimacy: legitimacy,
      ai_summary: summary,
      ai_reason: reason,
      ai_flags: flags,
      attended_elsewhere: attendedElsewhere,
    })
    .select("id")
    .single();
  if (error || !created) {
    if (error?.code === "23505") {
      return { ok: false, error: `You already reported an absence for ${input.date}.` };
    }
    console.error("[absences] insert failed:", error?.message);
    return { ok: false, error: "Couldn't save your report. Try again." };
  }

  revalidatePath(`/course/${input.courseId}/checkin`);
  revalidatePath(`/course/${input.courseId}/metrics`);
  return {
    ok: true,
    data: { id: created.id, verdict, reason, date: input.date },
  };
}

/**
 * Did this profile check into a class_session dated `date` in any course
 * other than `courseId`? Enrollment ids are per-course, so we go through
 * profile_id. Service role: RLS scopes check_ins to each course's members.
 */
async function checkedInElsewhere(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  courseId: string,
  date: string
): Promise<boolean> {
  const { data: myEnrollments } = await admin
    .from("enrollments")
    .select("id, course_id")
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

/**
 * Called after a successful check-in: if this student reported an absence
 * for today in another ClassAct course, mark it. Best-effort — never blocks
 * the check-in.
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

/* ---------------- Appeal (student) ---------------- */

export async function appealAbsence(
  absenceId: string,
  note: string
): Promise<ActionResult> {
  const gate = needsAdmin();
  if (gate) return gate;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const trimmed = note.trim();
  if (trimmed.length < 10) {
    return { ok: false, error: "Tell your professor, in a sentence or two, why this should be excused." };
  }
  if (trimmed.length > 2000) return { ok: false, error: "Keep it under 2,000 characters." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("absences")
    .select("id, course_id, enrollment_id, absence_date, category, ai_summary, appealed_at, professor_verdict, enrollments!inner(profile_id, roster_name)")
    .eq("id", absenceId)
    .maybeSingle();
  const owner = (row?.enrollments as unknown as { profile_id: string | null; roster_name: string } | null);
  if (!row || owner?.profile_id !== user.id) {
    return { ok: false, error: "That absence isn't yours to appeal." };
  }
  if (row.professor_verdict) {
    return { ok: false, error: "Your professor has already ruled on this one." };
  }
  if (row.appealed_at) {
    return { ok: false, error: "You've already appealed this absence — your professor will see it." };
  }

  const { error } = await admin
    .from("absences")
    .update({
      appeal_note: trimmed,
      appealed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", absenceId);
  if (error) return { ok: false, error: "Couldn't file the appeal. Try again." };

  // Best-effort professor email.
  try {
    const { data: course } = await admin
      .from("courses")
      .select("name, professor_id")
      .eq("id", row.course_id)
      .single();
    if (course) {
      const { data: prof } = await admin.auth.admin.getUserById(course.professor_id);
      if (prof.user?.email) {
        await sendAbsenceAppealNotification({
          to: prof.user.email,
          courseId: row.course_id,
          courseName: course.name,
          studentName: owner?.roster_name ?? "A student",
          date: row.absence_date,
          category: categoryLabel(row.category),
          summary: row.ai_summary,
          note: trimmed,
        });
      }
    }
  } catch {
    // Courtesy only.
  }

  revalidatePath(`/course/${row.course_id}/checkin`);
  return { ok: true };
}

/* ---------------- Decide (professor) ---------------- */

export async function decideAbsence(
  absenceId: string,
  verdict: string,
  note?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isVerdict(verdict)) return { ok: false, error: "Pick excused or unexcused." };

  // The professor's own RLS (absences_professor_all) scopes this update to
  // their courses — a non-owner simply matches zero rows.
  const { data, error } = await supabase
    .from("absences")
    .update({
      professor_verdict: verdict,
      professor_note: (note ?? "").trim().slice(0, 2000) || null,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", absenceId)
    .select("course_id")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't save the decision. Try again." };
  if (!data) return { ok: false, error: "That absence isn't in a course you teach." };
  revalidatePath(`/course/${data.course_id}/checkin`);
  revalidatePath(`/course/${data.course_id}/metrics`);
  return { ok: true };
}

/* ---------------- Lists ---------------- */

/** One row of the professor's table. Computed fields are done here once. */
export interface CourseAbsenceView {
  id: string;
  date: string;
  studentName: string;
  enrollmentId: string;
  category: string;
  categoryLabel: string;
  summary: string;
  explanation: string;
  notice: string;
  advanceHours: number | null;
  hasDocumentation: boolean;
  documentationKind: string | null;
  docAuthenticity: number | null;
  legitimacy: number;
  aiVerdict: AbsenceVerdict;
  professorVerdict: AbsenceVerdict | null;
  finalVerdict: AbsenceVerdict;
  flags: string[];
  attendedElsewhere: boolean;
  /** They reported an absence but checked into THIS course that day anyway. */
  attendedHere: boolean;
  appealNote: string | null;
  appealedAt: string | null;
  professorNote: string | null;
  submittedAt: string;
}

export async function listCourseAbsences(
  courseId: string
): Promise<CourseAbsenceView[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("absences")
    .select("*, enrollments!inner(roster_name)")
    .eq("course_id", courseId)
    .order("absence_date", { ascending: false })
    .order("submitted_at", { ascending: false });
  if (!rows || rows.length === 0) return [];

  // Which of these dates did the student actually check in here?
  const dates = Array.from(new Set(rows.map((r) => r.absence_date)));
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id, session_date")
    .eq("course_id", courseId)
    .in("session_date", dates);
  const sessionIds = (sessions ?? []).map((s) => s.id);
  const sessionDate = new Map((sessions ?? []).map((s) => [s.id, s.session_date]));
  const attended = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: checkins } = await supabase
      .from("check_ins")
      .select("session_id, enrollment_id")
      .in("session_id", sessionIds);
    for (const c of checkins ?? []) {
      attended.add(`${c.enrollment_id}|${sessionDate.get(c.session_id)}`);
    }
  }

  // Embedded joins aren't typed in the hand-written Database map; the
  // dashboard page does the same unknown-cast for courses on enrollments.
  return rows.map((r) =>
    toView(r as unknown as AbsenceRow & { enrollments: { roster_name: string } }, attended)
  );
}

function toView(
  r: AbsenceRow & { enrollments: { roster_name: string } },
  attended: Set<string>
): CourseAbsenceView {
  return {
    id: r.id,
    date: r.absence_date,
    studentName: r.enrollments.roster_name,
    enrollmentId: r.enrollment_id,
    category: r.category,
    categoryLabel: categoryLabel(r.category),
    summary: r.ai_summary,
    explanation: r.explanation,
    notice: noticeLabel(r.advance_hours),
    advanceHours: r.advance_hours,
    hasDocumentation: r.has_documentation,
    documentationKind: r.documentation_kind,
    docAuthenticity: r.ai_doc_authenticity,
    legitimacy: r.ai_legitimacy,
    aiVerdict: r.ai_verdict,
    professorVerdict: r.professor_verdict,
    finalVerdict: finalVerdict(r),
    flags: r.ai_flags ?? [],
    attendedElsewhere: r.attended_elsewhere,
    attendedHere: attended.has(`${r.enrollment_id}|${r.absence_date}`),
    appealNote: r.appeal_note,
    appealedAt: r.appealed_at,
    professorNote: r.professor_note,
    submittedAt: r.submitted_at,
  };
}

/** The student's own reports in a course — verdict and reason, no scores. */
export interface MyAbsenceView {
  id: string;
  date: string;
  categoryLabel: string;
  explanation: string;
  verdict: AbsenceVerdict;
  reason: string;
  overridden: boolean;
  professorNote: string | null;
  appealedAt: string | null;
  decidedAt: string | null;
  hasDocumentation: boolean;
}

export async function listMyAbsences(courseId: string): Promise<MyAbsenceView[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!enrollment) return [];
  const { data: rows } = await supabase
    .from("absences")
    .select("*")
    .eq("enrollment_id", enrollment.id)
    .order("absence_date", { ascending: false });
  return (rows ?? []).map((r) => ({
    id: r.id,
    date: r.absence_date,
    categoryLabel: categoryLabel(r.category),
    explanation: r.explanation,
    verdict: finalVerdict(r),
    reason: r.ai_reason,
    overridden: r.professor_verdict !== null,
    professorNote: r.professor_note,
    appealedAt: r.appealed_at,
    decidedAt: r.decided_at,
    hasDocumentation: r.has_documentation,
  }));
}
