import "server-only";
import { Resend } from "resend";
import { env, isConfigured } from "@/lib/env";

/**
 * Invite email for a student to activate their ClassAct account.
 * Returns { sent: false } (no throw) when Resend isn't configured — the UI
 * falls back to a copyable join link.
 */
export async function sendInviteEmail(input: {
  to: string;
  studentName: string;
  courseName: string;
  joinCode: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!isConfigured.email) {
    return { sent: false, error: "Email isn't configured yet (RESEND_API_KEY)." };
  }

  const joinUrl = `${env.siteUrl}/join/${encodeURIComponent(input.joinCode)}`;
  const resend = new Resend(env.resendApiKey);

  const { error } = await resend.emails.send({
    from: env.emailFrom,
    to: input.to,
    subject: `${input.courseName} is using ClassAct — activate your seat`,
    text: [
      `Hi ${input.studentName},`,
      ``,
      `Your class ${input.courseName} uses ClassAct for seat check-in.`,
      `Join with this link — it takes about two minutes:`,
      ``,
      joinUrl,
      ``,
      `Your join code (if asked): ${input.joinCode}`,
      ``,
      `Tap your seat, meet the people next to you, and get on with your day.`,
    ].join("\n"),
  });

  if (error) return { sent: false, error: error.message };
  return { sent: true };
}

/**
 * Notify founders that new feedback landed. Best-effort — never throws;
 * the feedback row is already stored before this is called.
 */
/** A student appealed an absence verdict — tell the professor, once. */
export async function sendAbsenceAppealNotification(input: {
  to: string;
  courseId: string;
  courseName: string;
  studentName: string;
  date: string;
  category: string;
  summary: string;
  note: string;
}): Promise<void> {
  if (!isConfigured.email) return;
  const resend = new Resend(env.resendApiKey!);
  try {
    await resend.emails.send({
      from: env.emailFrom,
      to: input.to,
      subject: `${input.courseName}: ${input.studentName} appealed an absence (${input.date})`,
      text: [
        `${input.studentName} is appealing the verdict on their ${input.category.toLowerCase()} absence for ${input.date}.`,
        ``,
        `ClassAct's read: ${input.summary}`,
        ``,
        `Their appeal:`,
        input.note,
        ``,
        `Decide with one click under Scheduled absences:`,
        `${env.siteUrl}/course/${input.courseId}/checkin`,
        ``,
        `— ClassAct`,
      ].join("\n"),
    });
  } catch {
    // Courtesy only; the appeal is already recorded.
  }
}

export async function sendFeedbackNotification(input: {
  to: string[];
  kind: string;
  body: string;
  submitterName: string;
}): Promise<void> {
  if (!isConfigured.email || input.to.length === 0) return;
  try {
    const resend = new Resend(env.resendApiKey);
    await resend.emails.send({
      from: env.emailFrom,
      to: input.to,
      subject: `ClassAct feedback — ${input.kind} from ${input.submitterName}`,
      text: [
        `${input.submitterName} filed a ${input.kind}:`,
        ``,
        input.body,
        ``,
        `Triage it: ${env.siteUrl}/feedback`,
      ].join("\n"),
    });
  } catch {
    // Courtesy email only — the feedback itself is safe in the database.
  }
}
