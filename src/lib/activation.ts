/**
 * Where a student actually is between "on the roster" and "in the class".
 *
 * "Invited vs activated" turned out to be two labels for six situations, and
 * the difference matters because the remedies are opposites. A student who
 * never got an email needs one sent. A student who already has a confirmed
 * account but no session cannot be helped by another invite — the invite link
 * is not what's failing them — and re-sending one only looks like progress.
 *
 * Deliberately pure: it takes facts and returns a state, so the ordering rules
 * below are unit-testable without a database or a mail provider.
 */

export type EnrollmentFacts = {
  /** enrollments.status — "invited" until /auth/join links a profile. */
  status: string;
  /** enrollments.profile_id — set once an auth user claims the row. */
  profileId: string | null;
  invitedAt: string | null;
  inviteError: string | null;
};

/** What auth.users knows. `null` means no account exists for this address. */
export type AccountFacts = {
  emailConfirmed: boolean;
  everSignedIn: boolean;
};

export const ACTIVATION_STATES = [
  "active",
  "signed_in_not_joined",
  "stuck_no_session",
  "send_failed",
  "emailed_no_account",
  "not_emailed",
] as const;

export type ActivationState = (typeof ACTIVATION_STATES)[number];

/** What the professor can actually do about it. */
export type Remedy = "reinvite" | "set_password" | "none";

/**
 * Classify one roster row.
 *
 * Account facts are checked before invite receipts on purpose. Both can be
 * true at once — a student who was emailed, then signed up from a classmate's
 * link, carries an `invited_at` and an account — and the account is the later,
 * truer fact. Reading the receipt first would file them under "emailed" and
 * hide the thing actually blocking them.
 *
 * Within the receipts, a send failure outranks a send: migration 0026 writes
 * `invited_at` and `invite_error` independently, so a row can carry a stale
 * timestamp beside a live error.
 */
export function activationState(
  enrollment: EnrollmentFacts,
  account: AccountFacts | null
): ActivationState {
  if (enrollment.status === "active" && enrollment.profileId) return "active";

  if (account) {
    // Has a session history but no active enrollment: either an off-roster
    // joiner parked in a pending row, or someone who signed up and never
    // opened their class link.
    if (account.everSignedIn) return "signed_in_not_joined";
    // Confirmed the email, never obtained a session. Another invite is useless
    // here; they need a link that sets a password.
    return "stuck_no_session";
  }

  if (enrollment.inviteError) return "send_failed";
  if (enrollment.invitedAt) return "emailed_no_account";
  return "not_emailed";
}

export const ACTIVATION_META: Record<
  ActivationState,
  {
    label: string;
    blurb: string;
    remedy: Remedy;
    /** Maps onto the Badge variants already used in the setup tabs. */
    tone: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  active: {
    label: "In the class",
    blurb: "Signed in and enrolled.",
    remedy: "none",
    tone: "default",
  },
  signed_in_not_joined: {
    label: "Signed in, not enrolled",
    blurb:
      "Has an account and has signed in, but isn't in this class yet — usually a join link they never opened.",
    remedy: "reinvite",
    tone: "secondary",
  },
  stuck_no_session: {
    label: "Locked out",
    blurb:
      "Confirmed their email but never got signed in — their confirmation link was opened on a different device. Send a set-password link.",
    remedy: "set_password",
    tone: "destructive",
  },
  send_failed: {
    label: "Email failed",
    blurb: "The invite bounced or was rejected.",
    remedy: "reinvite",
    tone: "destructive",
  },
  emailed_no_account: {
    label: "Emailed, no account",
    blurb: "The invite went out but they haven't signed up yet.",
    remedy: "reinvite",
    tone: "secondary",
  },
  not_emailed: {
    label: "Never emailed",
    blurb: "Added to the roster after the last send.",
    remedy: "reinvite",
    tone: "outline",
  },
};

/** States worth acting on, in the order a professor should work through them. */
export const ACTIONABLE_STATES: ActivationState[] = [
  "stuck_no_session",
  "not_emailed",
  "send_failed",
  "emailed_no_account",
  "signed_in_not_joined",
];

export function summarize(
  states: ActivationState[]
): Record<ActivationState, number> {
  const counts = Object.fromEntries(
    ACTIVATION_STATES.map((s) => [s, 0])
  ) as Record<ActivationState, number>;
  for (const s of states) counts[s] += 1;
  return counts;
}
