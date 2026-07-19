"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/env";
import type { ActionResult } from "@/server/actions/auth";
import type { ShoutOutContext } from "@/types/db";

/**
 * Shout-outs: students calling out good work. Private to the recipient
 * (professor sees all); peer-review shout-outs are anonymous to the
 * recipient and double as a bet — praising work that finishes top-quartile
 * feeds the giver's "spots excellence" statistic.
 */

async function myEnrollment(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, enrollmentId: null };
  const { data } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  return { supabase, enrollmentId: data?.id ?? null };
}

export async function giveShoutOut(input: {
  courseId: string;
  recipientEnrollmentId: string;
  context: ShoutOutContext;
  contextId?: string | null;
  message: string;
}): Promise<ActionResult> {
  const { supabase, enrollmentId } = await myEnrollment(input.courseId);
  if (!enrollmentId) return { ok: false, error: "You're not on this course's roster." };
  if (input.recipientEnrollmentId === enrollmentId) {
    return { ok: false, error: "Shout out someone else — self-praise is free." };
  }
  const message = input.message.trim().slice(0, 300);
  if (!message && input.context !== "peer_review") {
    return { ok: false, error: "Say what they did well — that's the point." };
  }

  // Context validation.
  const contextId: string | null = input.contextId ?? null;
  if (input.context === "peer_review") {
    if (!contextId || !isConfigured.supabaseAdmin) {
      return { ok: false, error: "Missing pair reference." };
    }
    const admin = createAdminClient();
    const { data: comparison } = await admin
      .from("comparisons")
      .select("judge_enrollment_id, left_submission_id, right_submission_id")
      .eq("id", contextId)
      .single();
    if (!comparison || comparison.judge_enrollment_id !== enrollmentId) {
      return { ok: false, error: "That's not your pair to praise." };
    }
    const { data: subs } = await admin
      .from("submissions")
      .select("id, enrollment_id")
      .in("id", [comparison.left_submission_id, comparison.right_submission_id]);
    const isOwnerOfPairSide = (subs ?? []).some(
      (s) => s.enrollment_id === input.recipientEnrollmentId
    );
    if (!isOwnerOfPairSide) {
      return { ok: false, error: "Shout-outs go to the work you just judged." };
    }
  }

  const { error } = await supabase.from("shout_outs").insert({
    course_id: input.courseId,
    giver_enrollment_id: enrollmentId,
    recipient_enrollment_id: input.recipientEnrollmentId,
    context: input.context,
    context_id: contextId,
    message,
  });
  if (error) return { ok: false, error: "Couldn't send the shout-out — try again." };
  revalidatePath(`/course/${input.courseId}/shoutouts`);
  return { ok: true };
}

/**
 * Peer-review convenience: shout out a side of a pair without knowing who
 * wrote it. Resolves the anonymous submission's owner server-side.
 */
export async function shoutOutPairSide(
  courseId: string,
  comparisonId: string,
  side: "left" | "right",
  message: string
): Promise<ActionResult> {
  const { enrollmentId } = await myEnrollment(courseId);
  if (!enrollmentId) return { ok: false, error: "You're not on this course's roster." };
  if (!isConfigured.supabaseAdmin) {
    return { ok: false, error: "Server isn't configured (service role missing)." };
  }
  const admin = createAdminClient();
  const { data: comparison } = await admin
    .from("comparisons")
    .select("judge_enrollment_id, left_submission_id, right_submission_id")
    .eq("id", comparisonId)
    .single();
  if (!comparison || comparison.judge_enrollment_id !== enrollmentId) {
    return { ok: false, error: "That's not your pair to praise." };
  }
  const submissionId =
    side === "left" ? comparison.left_submission_id : comparison.right_submission_id;
  const { data: submission } = await admin
    .from("submissions")
    .select("enrollment_id")
    .eq("id", submissionId)
    .single();
  if (!submission) return { ok: false, error: "Submission not found." };
  if (submission.enrollment_id === enrollmentId) {
    return { ok: false, error: "That one's yours — praise the other side." };
  }
  return giveShoutOut({
    courseId,
    recipientEnrollmentId: submission.enrollment_id,
    context: "peer_review",
    contextId: comparisonId,
    message,
  });
}
