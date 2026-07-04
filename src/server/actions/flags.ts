"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_TASK_TITLE } from "@/lib/projects";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Accountability flags (the anti-slacker mechanism, from the TeamSlice prior
 * art). Any teammate can flag a card in Done that wasn't really finished.
 * While a flag is unresolved, that card's minutes don't count toward the
 * assignee's contribution. The professor settles it:
 *  - dismiss — the work was fine; credit comes back.
 *  - uphold  — the card reopens into the member's column to actually finish
 *              (and only counts once it's honestly done).
 */

const MAX_REASON_CHARS = 1000;

/** Student: flag a done task on your own team's board. */
export async function flagTask(
  courseId: string,
  taskId: string,
  reason: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "You're not on this course's active roster." };
  }

  const trimmed = reason.trim().slice(0, MAX_REASON_CHARS);
  if (trimmed.length < 5) {
    return {
      ok: false,
      error: "Say what's wrong — the flag needs a concrete reason.",
    };
  }

  // RLS hides tasks on boards you're not part of, so this doubles as the
  // membership gate.
  const { data: task } = await supabase
    .from("team_tasks")
    .select("id, team_id, title, status, assigned_enrollment_id")
    .eq("id", taskId)
    .eq("course_id", courseId)
    .single();
  if (!task) return { ok: false, error: "Task not found." };
  if (task.title === CONTRACT_TASK_TITLE) {
    return { ok: false, error: "Contract cards can't be flagged." };
  }
  if (task.status !== "done") {
    return { ok: false, error: "Only cards in Done can be flagged." };
  }
  if (task.assigned_enrollment_id === enrollment.id) {
    return {
      ok: false,
      error: "That's your own card — reopen it instead of flagging it.",
    };
  }

  const { data: existing } = await supabase
    .from("task_flags")
    .select("id")
    .eq("team_task_id", taskId)
    .eq("flagged_by_enrollment_id", enrollment.id)
    .is("resolved_at", null)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "You've already flagged this task." };
  }

  const { error: insertError } = await supabase.from("task_flags").insert({
    team_task_id: taskId,
    course_id: courseId,
    flagged_by_enrollment_id: enrollment.id,
    reason: trimmed,
  });
  if (insertError) return { ok: false, error: "Couldn't flag the task." };

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}

/**
 * Professor: settle a flag. Upholding also reopens the card into the
 * assignee's column so the work actually gets finished.
 */
export async function resolveFlag(
  courseId: string,
  flagId: string,
  outcome: "dismiss" | "uphold"
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can settle flags." };
  }

  const { data: flag } = await supabase
    .from("task_flags")
    .select("id, team_task_id, resolved_at")
    .eq("id", flagId)
    .eq("course_id", courseId)
    .single();
  if (!flag) return { ok: false, error: "Flag not found." };
  if (flag.resolved_at) {
    return { ok: false, error: "That flag is already settled." };
  }

  const { error: updateError } = await supabase
    .from("task_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", flagId)
    .eq("course_id", courseId);
  if (updateError) return { ok: false, error: "Couldn't settle the flag." };

  if (outcome === "uphold") {
    // Back to the assignee's column; the logged minutes are wiped so credit
    // only returns when the work is honestly re-completed.
    const { error: reopenError } = await supabase
      .from("team_tasks")
      .update({ status: "assigned", actual_minutes: null, done_at: null })
      .eq("id", flag.team_task_id)
      .eq("course_id", courseId)
      .eq("status", "done");
    if (reopenError) {
      return {
        ok: false,
        error: "Flag settled, but the task couldn't be reopened.",
      };
    }
  }

  revalidatePath(`/course/${courseId}/projects`);
  return { ok: true };
}
