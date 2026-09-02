/**
 * Self-service escape from the sign-in lockout.
 *
 * The Fall 2026 pilot stranded students with a confirmed email, no session,
 * and no password they had ever used — and the "Forgot password?" button was
 * no way out, because it went through Supabase's own recovery mail: a
 * `{{ .ConfirmationURL }}` PKCE link, sent by a throttled built-in mailer.
 * The link only worked in the browser that started sign-up, which is exactly
 * the condition that trapped them.
 *
 * This path mints a `token_hash` link instead — verified by `verifyOtp`, which
 * reads no local storage, so it opens on any device — and sends it through
 * Resend, which is not throttled at classroom volume.
 *
 * The pure decision logic lives here so the rule that matters can be tested
 * without a mail server: the answer a student sees must not depend on whether
 * the address has an account.
 */
import type { ActionResult } from "@/server/actions/auth";

/** Requests allowed per email address per window before going quiet. */
export const RECOVERY_LIMIT = 3;
export const RECOVERY_WINDOW_MS = 15 * 60_000;

/**
 * Shown for every request that isn't a server misconfiguration — whether or
 * not an account exists, whether or not anything was actually sent. Phrased
 * conditionally on purpose: "if" is what keeps it from confirming an address.
 */
export const RECOVERY_SENT_MESSAGE =
  "If that address has a ClassAct account, a sign-in link is on its way. It works on any device — open it and pick a password. Check your junk folder: university mail systems often file it there.";

/** Shown after a plain sign-in or join link. Same junk-folder warning. */
export const SIGN_IN_LINK_SENT_MESSAGE =
  "If that address has a ClassAct account, a sign-in link is on its way. It works on any device. Check your junk folder — university mail systems often file it there.";

/**
 * Build an `/auth/callback` URL from `generateLink`'s `hashed_token`.
 *
 * Every email link the app sends is minted here, and deliberately NOT from
 * `generateLink`'s `action_link`: that routes through Supabase's
 * `/auth/v1/verify`, which hands back a PKCE `code` bound to the browser that
 * requested it. A `token_hash` is verified by `verifyOtp`, which reads no
 * local storage, so it opens on any device.
 *
 * `next` is clamped rather than trusted: this URL is minted from an
 * unauthenticated request, and an open redirect on a link that carries a login
 * token hands the session to whoever chose the destination.
 */
export function buildAuthLinkUrl(
  siteUrl: string,
  input: {
    hashedToken: string;
    type: "recovery" | "magiclink";
    next: string;
    /** Where `next` lands if it isn't a safe in-app path. */
    fallbackNext: string;
  }
): string {
  const safeNext =
    input.next.startsWith("/") && !input.next.startsWith("//")
      ? input.next
      : input.fallbackNext;
  const url = new URL("/auth/callback", siteUrl);
  url.searchParams.set("token_hash", input.hashedToken);
  url.searchParams.set("type", input.type);
  url.searchParams.set("next", safeNext);
  return url.toString();
}

/** Where a recovery link points — always ends on the set-a-password page. */
export function buildRecoveryUrl(
  siteUrl: string,
  hashedToken: string,
  next: string
): string {
  return buildAuthLinkUrl(siteUrl, {
    hashedToken,
    type: "recovery",
    next,
    fallbackNext: "/update-password",
  });
}

export interface RecoveryInputs {
  accountExists: boolean;
  emailConfigured: boolean;
  /** Requests already made for this address inside the window. */
  recentRequests: number;
}

export interface RecoveryDecision {
  send: boolean;
  result: ActionResult;
}

/**
 * Decide whether to send, and what to say.
 *
 * Three cases, and only one of them is allowed to be distinguishable:
 *
 * - No mailer configured. Say so. This is about the server, not the account,
 *   so it leaks nothing — and a student told "check your email" when no
 *   mailer exists is stranded with no signal that anything went wrong.
 * - Over the limit. Go quiet, but answer exactly as if sent. Saying "slow
 *   down" would confirm the address to an enumerator and confirm to a pest
 *   that the mail bomb is landing.
 * - Everything else. Send only when there is an account; answer the same
 *   either way.
 */
export function recoveryOutcome(inputs: RecoveryInputs): RecoveryDecision {
  if (!inputs.emailConfigured) {
    return {
      send: false,
      result: {
        ok: false,
        error:
          "Email isn't configured on this server, so we can't send a sign-in link. Tell your professor.",
      },
    };
  }

  if (inputs.recentRequests >= RECOVERY_LIMIT) {
    return { send: false, result: { ok: true } };
  }

  return { send: inputs.accountExists, result: { ok: true } };
}
