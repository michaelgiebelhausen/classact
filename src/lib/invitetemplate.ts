/**
 * The invite email a professor sends to their roster.
 *
 * The body used to live inline in `sendInviteEmail`, which made it readable
 * and unchangeable at the same time. It lives here now so the professor's
 * saved version, the on-screen preview, and the message that actually leaves
 * Resend are all rendered by one function — the previous split let the
 * "ready-to-send message" on the setup page drift from the real email.
 *
 * Tokens are `{name}`-style rather than `${}` so a professor typing a dollar
 * sign or a stray brace can't produce something that looks like code.
 */

export const INVITE_TOKENS = [
  { token: "{name}", label: "Student's name", sample: "Jordan Rivera" },
  { token: "{course}", label: "Course name", sample: "Marketing 301" },
  { token: "{link}", label: "Join link", sample: "https://classact.college/join/ABC123" },
  { token: "{code}", label: "Join code", sample: "ABC123" },
] as const;

export type InviteVars = {
  name: string;
  course: string;
  link: string;
  code: string;
};

export const DEFAULT_INVITE_SUBJECT = "{course} is using ClassAct — activate your seat";

export const DEFAULT_INVITE_MESSAGE = [
  `Hi {name},`,
  ``,
  `Your class {course} uses ClassAct for seat check-in.`,
  `Join with this link — it takes about two minutes:`,
  ``,
  `{link}`,
  ``,
  `Your join code (if asked): {code}`,
  ``,
  `Tap your seat, meet the people next to you, and get on with your day.`,
].join("\n");

/** Generous enough for a chatty professor, tight enough to bound the payload. */
export const INVITE_SUBJECT_MAX = 200;
export const INVITE_MESSAGE_MAX = 5000;

/**
 * Substitute every token in one pass.
 *
 * One pass matters: replacing sequentially would let a value that itself
 * contains a token get expanded by a later replacement. A course literally
 * named "{code} Lab" should stay that, not turn into the join code.
 */
export function renderInvite(template: string, vars: InviteVars): string {
  return template.replace(
    /\{(name|course|link|code)\}/g,
    (_match, key: keyof InviteVars) => vars[key]
  );
}

/**
 * Validate a professor's draft before it's saved or sent.
 *
 * An empty body is rejected rather than silently swapped for the default:
 * clearing the box and hitting send should tell you something is wrong, not
 * quietly mail the stock text. A body with no {link} is rejected too — that
 * email cannot do its one job, and the failure would only surface later as
 * students who never activate.
 */
export function validateInvite(input: { subject: string; message: string }):
  | { ok: true; subject: string; message: string }
  | { ok: false; error: string } {
  const subject = input.subject.trim();
  const message = input.message.trim();

  if (!subject) return { ok: false, error: "The subject line can't be empty." };
  if (subject.length > INVITE_SUBJECT_MAX)
    return { ok: false, error: `Keep the subject under ${INVITE_SUBJECT_MAX} characters.` };
  if (!message) return { ok: false, error: "The message can't be empty." };
  if (message.length > INVITE_MESSAGE_MAX)
    return { ok: false, error: `Keep the message under ${INVITE_MESSAGE_MAX} characters.` };
  if (!message.includes("{link}"))
    return {
      ok: false,
      error: "Keep {link} somewhere in the message — it's how students join.",
    };

  return { ok: true, subject, message };
}
