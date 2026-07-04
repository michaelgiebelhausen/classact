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
