import "server-only";
import { Resend } from "resend";
import { env, isConfigured } from "@/lib/env";

/** One student's invite, already rendered — no templating happens below. */
export type InviteRecipient = {
  /** Echoed back in the result so the caller can update the right row. */
  enrollmentId: string;
  to: string;
  subject: string;
  text: string;
};

export type InviteSendResult = {
  enrollmentId: string;
  sent: boolean;
  error?: string;
};

/**
 * Resend accepts 100 emails per batch call, and one batch call costs a single
 * request against the rate limit. That is the whole fix for "it only sent 45
 * of 60": the old code made one HTTP request per student, and Resend's
 * 2-requests-per-second limit rejected everything past the first few seconds.
 */
const BATCH_SIZE = 100;

/** Comfortably under 2 requests/sec even if the clock is unkind. */
const BATCH_GAP_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send every invite and report, per student, whether it left.
 *
 * Returns one result per recipient so the caller can write an accurate receipt
 * to each enrollment row. Nothing here throws: a half-sent roster is
 * information the professor needs, not an exception that discards the record
 * of what already went out.
 */
export async function sendInviteEmails(
  recipients: InviteRecipient[]
): Promise<InviteSendResult[]> {
  if (recipients.length === 0) return [];
  if (!isConfigured.email) {
    return recipients.map((r) => ({
      enrollmentId: r.enrollmentId,
      sent: false,
      error: "Email isn't configured yet (RESEND_API_KEY).",
    }));
  }

  const resend = new Resend(env.resendApiKey);
  const results: InviteSendResult[] = [];

  for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
    const chunk = recipients.slice(start, start + BATCH_SIZE);
    if (start > 0) await sleep(BATCH_GAP_MS);

    // 'permissive' is what makes per-student attribution possible: strict mode
    // rejects the entire batch when one address is malformed, punishing 99
    // good students for a single typo in the roster.
    let failures = new Map<number, string>();
    let batchError: string | undefined;
    try {
      const { data, error } = await resend.batch.send(
        chunk.map((r) => ({
          from: env.emailFrom,
          to: r.to,
          subject: r.subject,
          text: r.text,
        })),
        { batchValidation: "permissive" }
      );
      if (error) batchError = error.message;
      else failures = new Map((data?.errors ?? []).map((e) => [e.index, e.message]));
    } catch (err) {
      batchError = err instanceof Error ? err.message : "Send failed.";
    }

    // A batch-level error means nothing in this chunk was accepted. An
    // index-level error means everything *else* in the chunk was.
    for (const [i, r] of chunk.entries()) {
      const failure = batchError ?? failures.get(i);
      results.push(
        failure
          ? { enrollmentId: r.enrollmentId, sent: false, error: failure }
          : { enrollmentId: r.enrollmentId, sent: true }
      );
    }
  }

  return results;
}

/** One student's set-a-password rescue, before the copy is rendered. */
export type RecoveryRecipient = {
  enrollmentId: string;
  to: string;
  /** Greeting name; the same first-name rule as invites is applied by caller. */
  firstName: string;
  courseName: string;
  /** A /auth/callback?token_hash=… link — works on any device. */
  link: string;
};

/**
 * Email set-a-password links to students who are locked out.
 *
 * Deliberately routed through Resend rather than Supabase's built-in mailer.
 * Supabase's default SMTP is throttled hard enough that a class-sized rescue
 * would be silently dropped, and the link it generates is a PKCE link — the
 * exact thing that stranded these students in the first place. The caller
 * builds a `token_hash` link instead, which carries no device affinity.
 *
 * Shares the batch sender with invites, so it inherits the same per-student
 * receipt and the same rate-limit behaviour.
 */
export async function sendRecoveryEmails(
  recipients: RecoveryRecipient[],
  courseName: string
): Promise<InviteSendResult[]> {
  return sendInviteEmails(
    recipients.map((r) => ({
      enrollmentId: r.enrollmentId,
      to: r.to,
      subject: `Finish setting up ClassAct for ${courseName}`,
      text: [
        `Hi ${r.firstName},`,
        ``,
        `It looks like your ClassAct sign-in never finished for ${r.courseName}. That's on us, not you — the confirmation link only worked if you opened it on the same device you signed up on.`,
        ``,
        `This link works anywhere. Open it and pick a password:`,
        ``,
        r.link,
        ``,
        `That's the whole thing — you'll land in the class.`,
      ].join("\n"),
    }))
  );
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

/**
 * A student's own notes, sent wherever they keep things.
 *
 * Unlike the courtesy notifications around it, this one reports failure to the
 * caller instead of swallowing it: the student pressed send and is waiting to
 * hear, and "it quietly didn't go" is exactly the doubt that had them keeping
 * a private copy in Word.
 *
 * The Markdown rides as both the body and an attachment — the body so it is
 * readable on a phone without opening anything, the file so it can be dropped
 * straight into a notes vault.
 */
export async function sendNotesExport(input: {
  to: string;
  courseName: string;
  filename: string;
  markdown: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!isConfigured.email) {
    return { sent: false, error: "Email isn't set up yet — download instead." };
  }
  try {
    const resend = new Resend(env.resendApiKey);
    const { error } = await resend.emails.send({
      from: env.emailFrom,
      to: input.to,
      subject: `Your ${input.courseName} notes`,
      text: input.markdown,
      attachments: [
        {
          filename: input.filename,
          content: Buffer.from(input.markdown, "utf8").toString("base64"),
        },
      ],
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
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

/**
 * A student asked for a way back in themselves.
 *
 * Separate from `sendRecoveryEmails` because the situation is different: no
 * professor initiated this, there is no course context, and the person is
 * looking at the login page right now waiting for it. Deliberately says
 * nothing about why they were locked out — they asked a simple question and
 * want a link, not an incident report.
 */
export async function sendSelfRecoveryEmail(
  to: string,
  link: string
): Promise<boolean> {
  const [result] = await sendInviteEmails([
    {
      enrollmentId: "self-recovery",
      to,
      subject: "Your ClassAct sign-in link",
      text: [
        `You asked for a way into ClassAct.`,
        ``,
        `Open this link and pick a password. It works on any device or browser —`,
        `you don't have to use the one you signed up on:`,
        ``,
        link,
        ``,
        `If you didn't ask for this, you can ignore it. Nothing has changed on`,
        `your account, and the link expires on its own.`,
      ].join("\n"),
    },
  ]);
  return result?.sent ?? false;
}

/**
 * Confirm a change to the account's sign-in email.
 *
 * Routed through Resend and carrying a `token_hash` link (not Supabase's
 * built-in PKCE mail) for the same reason as recovery: the link must open on
 * any device, since a university mail scanner fetches it before the person
 * does. Two variants — the new address confirms it's really theirs; the
 * current address (only when "Secure email change" is on) approves the move
 * and is the security notice that someone is changing the login email.
 */
export async function sendEmailChangeEmail(
  to: string,
  link: string,
  opts: { toCurrentAddress: boolean }
): Promise<boolean> {
  const text = opts.toCurrentAddress
    ? [
        `Someone asked to change the sign-in email on your ClassAct account.`,
        ``,
        `If that was you, open this link to approve it. It works on any device:`,
        ``,
        link,
        ``,
        `If it wasn't you, don't open the link — your email stays as it is, and`,
        `you may want to change your password.`,
      ].join("\n")
    : [
        `You asked to use this address to sign in to ClassAct.`,
        ``,
        `Open this link to confirm it. It works on any device or browser:`,
        ``,
        link,
        ``,
        `Until you do, your account keeps its current email. If you didn't ask`,
        `for this, you can ignore it — the link expires on its own.`,
      ].join("\n");

  const [result] = await sendInviteEmails([
    {
      enrollmentId: "email-change",
      to,
      subject: "Confirm your ClassAct email change",
      text,
    },
  ]);
  return result?.sent ?? false;
}
