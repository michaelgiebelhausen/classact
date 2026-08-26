/**
 * Why an email auth link failed, in words a student can act on.
 *
 * The callback used to collapse every failure into `?error=expired`, and the
 * login page only rendered a message for that one value — so the most common
 * failure of all (`?error=missing`) drew a blank sign-in form with no
 * explanation. A student who had just clicked a link forty seconds earlier was
 * told nothing at all, retried, and concluded their account was broken.
 *
 * Reasons live here rather than inline so the route that *detects* the failure
 * and the page that *explains* it cannot drift apart: adding a reason without
 * adding its copy is a type error.
 */

export const CALLBACK_REASONS = [
  "wrong_browser",
  "link_expired",
  "link_invalid",
  "no_token",
  "provider_error",
] as const;

export type CallbackReason = (typeof CALLBACK_REASONS)[number];

export function isCallbackReason(value: unknown): value is CallbackReason {
  return (
    typeof value === "string" &&
    (CALLBACK_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Map a Supabase auth error onto a reason.
 *
 * `pkce_code_verifier_not_found` is the one that matters. @supabase/ssr pins
 * `flowType: "pkce"` after its own options spread, so it can't be turned off,
 * and PKCE keeps a `code_verifier` cookie in the browser that *started* the
 * sign-up. Open the confirmation email on a phone after signing up on a laptop
 * and that cookie isn't there, so the exchange cannot complete — no matter how
 * fresh the link is. Calling that "expired" sends the student to request
 * another link, which fails in exactly the same way.
 *
 * The flow_state codes are the genuinely-expired cases: a link that timed out,
 * or one that was already spent.
 */
export function reasonFromAuthError(
  error: { code?: string | null; name?: string | null } | null | undefined
): CallbackReason {
  if (!error) return "link_invalid";

  if (
    error.code === "pkce_code_verifier_not_found" ||
    error.name === "AuthPKCECodeVerifierMissingError"
  ) {
    return "wrong_browser";
  }

  if (
    error.code === "flow_state_expired" ||
    error.code === "flow_state_not_found" ||
    error.code === "otp_expired"
  ) {
    return "link_expired";
  }

  return "link_invalid";
}

/**
 * What the student reads.
 *
 * `help` carries the action. For `wrong_browser` that action is *not* "get a
 * new link" — their email is already confirmed by the time the exchange fails
 * (Supabase verifies server-side first), so their account is live and a plain
 * password sign-in works right now. Telling them to sign in is both true and
 * the fastest way out.
 */
export const CALLBACK_MESSAGES: Record<
  CallbackReason,
  { headline: string; help: string }
> = {
  wrong_browser: {
    headline: "You opened that link on a different device or browser.",
    help: "Your email is confirmed and your account is ready — just sign in below with the password you chose. (Opening the link in the same browser you signed up in also works.)",
  },
  // "Open it in this same browser" was the old advice, and it was the trap
  // restated: the students who see this are the ones who cannot satisfy that
  // condition. Point them at the device-independent link instead.
  link_expired: {
    headline: "That link has expired or was already used.",
    help: "Get a fresh one below — the new link works on any device, so it doesn't matter which browser you open it in.",
  },
  link_invalid: {
    headline: "We couldn't finish signing you in with that link.",
    help: "Try signing in with your email and password. If you've never set one, use Forgot password.",
  },
  no_token: {
    headline: "That link is missing its sign-in token.",
    help: "Your email app may have broken it across two lines. Sign in with your password below, or get a fresh link that works on any device.",
  },
  provider_error: {
    headline: "Your email provider reported a problem with that link.",
    help: "Some university mail systems open links to scan them, which spends a one-time link before you ever click it. Get a fresh one below and open it right away.",
  },
};

/**
 * Legacy query values still in the wild — old emails and bookmarks point at
 * `?error=expired` / `?error=missing`. Translate rather than ignore.
 */
export function reasonFromQuery(
  reason: string | null,
  legacyError: string | null
): CallbackReason | null {
  if (isCallbackReason(reason)) return reason;
  if (legacyError === "expired") return "link_expired";
  if (legacyError === "missing") return "no_token";
  return null;
}
