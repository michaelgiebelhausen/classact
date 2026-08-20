import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmails, type InviteRecipient } from "@/lib/email";
import { rateLimit } from "@/lib/ratelimit";
import { describeQueryFailure } from "@/lib/dberror";
import { env } from "@/lib/env";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_INVITE_SUBJECT,
  INVITE_MESSAGE_MAX,
  INVITE_SUBJECT_MAX,
  renderInvite,
  validateInvite,
} from "@/lib/invitetemplate";

const bodySchema = z.object({
  courseId: z.string().uuid(),
  enrollmentIds: z.array(z.string().uuid()).optional(),
  // Present when the professor edited the message before sending. Sending the
  // draft along with the send — rather than requiring a separate save first —
  // is what guarantees the email that goes out is the one they were looking at.
  subject: z.string().max(INVITE_SUBJECT_MAX).optional(),
  message: z.string().max(INVITE_MESSAGE_MAX).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit(`invites:${user.id}`, { limit: 5, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, name, join_code, professor_id, invite_subject, invite_message")
    .eq("id", parsed.data.courseId)
    .single();
  // invite_subject/invite_message are the newest columns in the schema, so
  // this select is the one most likely to outrun a database. A 403 would send
  // the professor looking for a permissions problem that isn't there.
  const courseFailure = describeQueryFailure("invites.send", courseError);
  if (courseFailure) {
    return NextResponse.json({ error: courseFailure }, { status: 500 });
  }
  if (!course || course.professor_id !== user.id) {
    return NextResponse.json({ error: "Not course owner" }, { status: 403 });
  }

  // Precedence: what they just typed, then what they saved earlier, then the
  // shipped default.
  const checked = validateInvite({
    subject: parsed.data.subject ?? course.invite_subject ?? DEFAULT_INVITE_SUBJECT,
    message: parsed.data.message ?? course.invite_message ?? DEFAULT_INVITE_MESSAGE,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  // Persist the edit before sending. If the send then fails partway, the
  // professor's wording still survives the page reload they're about to do.
  const edited =
    parsed.data.subject !== undefined || parsed.data.message !== undefined;
  if (edited) {
    await supabase
      .from("courses")
      .update({ invite_subject: checked.subject, invite_message: checked.message })
      .eq("id", course.id);
  }

  let query = supabase
    .from("enrollments")
    .select("id, roster_name, roster_email")
    .eq("course_id", course.id)
    .eq("status", "invited");
  if (parsed.data.enrollmentIds && parsed.data.enrollmentIds.length > 0) {
    query = query.in("id", parsed.data.enrollmentIds);
  }
  const { data: targets } = await query;

  if (!targets || targets.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, results: [] });
  }

  const joinUrl = `${env.siteUrl}/join/${encodeURIComponent(course.join_code)}`;
  const recipients: InviteRecipient[] = targets.map((t) => {
    const vars = {
      name: t.roster_name,
      course: course.name,
      link: joinUrl,
      code: course.join_code,
    };
    return {
      enrollmentId: t.id,
      to: t.roster_email,
      subject: renderInvite(checked.subject, vars),
      text: renderInvite(checked.message, vars),
    };
  });

  const results = await sendInviteEmails(recipients);

  // Write the receipts in bulk. One update for everyone who made it, then one
  // per distinct error — which in the common case (a rate limit, a bad API
  // key) is a single extra query rather than one per student.
  const sentIds = results.filter((r) => r.sent).map((r) => r.enrollmentId);
  if (sentIds.length > 0) {
    await supabase
      .from("enrollments")
      .update({ invited_at: new Date().toISOString(), invite_error: null })
      .in("id", sentIds);
  }

  const byError = new Map<string, string[]>();
  for (const r of results) {
    if (r.sent) continue;
    const reason = r.error ?? "Send failed.";
    byError.set(reason, [...(byError.get(reason) ?? []), r.enrollmentId]);
  }
  for (const [reason, ids] of byError) {
    await supabase.from("enrollments").update({ invite_error: reason }).in("id", ids);
  }

  const nameById = new Map(targets.map((t) => [t.id, t.roster_name]));
  return NextResponse.json({
    sent: sentIds.length,
    failed: results.length - sentIds.length,
    // Named, per student — so "who got it and who didn't" has an answer that
    // doesn't require inferring it from a count.
    results: results.map((r) => ({
      enrollmentId: r.enrollmentId,
      name: nameById.get(r.enrollmentId) ?? "",
      sent: r.sent,
      error: r.error,
    })),
  });
}
