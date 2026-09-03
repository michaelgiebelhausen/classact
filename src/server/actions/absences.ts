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
  flagPolicyConflicts,
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
  isWithinTerm,
  meetingStartInstant,
  type CourseSchedule,
} from "@/lib/schedule";
import { resolveCourseAi } from "@/server/aicreds";
import { assessAbsence } from "@/server/absenceai";
import { checkedInElsewhere } from "@/server/absences";
import { describeQueryFailure } from "@/lib/dberror";
import {
  getCourseDirectory,
  type CourseDirectory,
} from "@/lib/coursedirectory";
import { rosterDisplayName } from "@/lib/names";
import { rateLimit } from "@/lib/ratelimit";
import { sendAbsenceAppealNotification } from "@/lib/email";
import type { AbsenceRow, AbsenceVerdict } from "@/types/db";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Self-reported absences.
 *
 * RLS on `absences` is PROFESSOR-ONLY — there is no student policy at all,
 * because the table carries the legitimacy and document-authenticity scores
 * and RLS can't scope by column. Students therefore never touch the table
 * directly: they go through these actions, which authenticate the caller
 * first and then use the service-role client, returning only the fields a
 * student is meant to see. Don't "simplify" listMyAbsences or submitAbsence
 * onto the user client — both would silently return or write nothing.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The regex only checks shape — "2026-13-45" passes it and then rolls over
 * into 2027 inside Date.UTC. Round-trip the parts to reject anything that
 * isn't a real calendar day.
 */
function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/** How far ahead a student may report, so the date picker can't be bypassed. */
const MAX_DAYS_AHEAD = 180;
/** How late a student may report a class they already missed. */
const MAX_DAYS_LATE = 14;

/** Whole days between today (UTC) and a date string; negative = past. */
function daysFromToday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * Why this date can't be reported, or null if it's fine. Keeps the student
 * out of the model when the answer is a plain calendar fact.
 */
function describeDateProblem(
  schedule: CourseSchedule,
  date: string
): string | null {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!schedule.days.includes(weekday)) {
    return "This class doesn't meet that day — pick a class date.";
  }
  if (!isWithinTerm(schedule, date)) {
    return "That date is outside this course's term.";
  }
  const drift = daysFromToday(date);
  if (drift > MAX_DAYS_AHEAD) {
    return "That's too far ahead to report — closer to the date, please.";
  }
  if (drift < -MAX_DAYS_LATE) {
    return "That class was more than two weeks ago — email your professor instead.";
  }
  return null;
}

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
  const { data: course, error: courseError } = await admin
    .from("courses")
    .select(
      "id, name, professor_id, meeting_days, meeting_start, meeting_end, timezone, term_start, term_end, attendance_policy"
    )
    .eq("id", courseId)
    .maybeSingle();
  // A null return here reads to callers as "no such course", so a select
  // broken by an unapplied migration would look like a missing course rather
  // than a missing column. Nothing in this shape can carry a message; the log
  // is what makes it findable.
  describeQueryFailure("absences.loadCourse", courseError);
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
): Promise<ActionResult<{ policy: AttendancePolicy }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Parse leniently (clamps numbers, drops unknown categories) then persist
  // the clean shape; RLS (courses_update → professor) guards the write.
  const policy = parseAttendancePolicy(input);
  const { data, error } = await supabase
    .from("courses")
    .update({ attendance_policy: policy as unknown as Record<string, unknown> })
    .eq("id", courseId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[absences] policy update failed:", error.message);
    return { ok: false, error: "Couldn't save the policy. Try again." };
  }
  // RLS filters rather than errors, so zero rows means "not your course" —
  // report that instead of a cheerful success for a write that never landed.
  if (!data) {
    return { ok: false, error: "That course isn't one you teach." };
  }
  revalidatePath(`/course/${courseId}/setup`);
  revalidatePath(`/course/${courseId}/checkin`);
  // Hand back what was actually stored: the numbers are clamped on the way
  // in, and the form should show the stored value, not the typed one.
  return { ok: true, data: { policy } };
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

  // Validate the report before spending anything on it. Every AI call here
  // is paid for by the platform, so nothing reaches the model until the
  // request is known to be well-formed, in-bounds, and not a flood.
  if (!DATE_RE.test(input.date) || !isRealDate(input.date)) {
    return { ok: false, error: "Pick the class date." };
  }
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
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "You're not on this course's active roster." };
  }

  // The date has to be a class this course actually holds. Without this, any
  // well-formed date buys a model call — 180 of them a year, per student.
  if (course.schedule) {
    const dateCheck = describeDateProblem(course.schedule, input.date);
    if (dateCheck) return { ok: false, error: dateCheck };
  } else {
    const drift = daysFromToday(input.date);
    if (drift > MAX_DAYS_AHEAD || drift < -MAX_DAYS_LATE) {
      return { ok: false, error: "Pick a date inside this term." };
    }
  }

  // Cheap flood guard on a platform-paid call. Generous enough that no real
  // student notices: a handful of reports an hour, one course at a time.
  const limit = rateLimit(`absence:${user.id}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return {
      ok: false,
      error:
        "That's a lot of absence reports at once — try again in an hour, or email your professor.",
    };
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
  const attendedElsewhere = await checkedInElsewhere(
    user.id,
    input.courseId,
    input.date
  );

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
    // Shape validation can't catch a verdict that disagrees with the policy
    // it was handed — flag it so the professor sees the disagreement.
    flags = flagPolicyConflicts(result.assessment, course.policy, {
      category: input.category,
      advanceHours: notice,
    });
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
          studentName:
            rosterDisplayName(owner?.roster_name ?? "") || "A student",
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

  // Class-visible names: a code-joiner's roster_name is the email they signed
  // up with, and this list gets read off a shared screen like any other.
  const directory = isConfigured.supabaseAdmin
    ? await getCourseDirectory(createAdminClient(), courseId)
    : {};

  // Embedded joins aren't typed in the hand-written Database map; the
  // dashboard page does the same unknown-cast for courses on enrollments.
  return rows.map((r) =>
    toView(
      r as unknown as AbsenceRow & { enrollments: { roster_name: string } },
      attended,
      directory
    )
  );
}

function toView(
  r: AbsenceRow & { enrollments: { roster_name: string } },
  attended: Set<string>,
  directory: CourseDirectory
): CourseAbsenceView {
  return {
    id: r.id,
    date: r.absence_date,
    studentName:
      directory[r.enrollment_id]?.name ??
      rosterDisplayName(r.enrollments.roster_name),
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
  if (!isConfigured.supabaseAdmin) return [];

  // Read through the service role and hand back only the student-safe
  // fields. The absences table is professor-only under RLS precisely so a
  // student can't select the legitimacy and authenticity scores.
  const admin = createAdminClient();
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return [];
  const { data: rows } = await admin
    .from("absences")
    .select(
      "id, absence_date, category, explanation, ai_verdict, ai_reason, professor_verdict, professor_note, appealed_at, decided_at, has_documentation"
    )
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
