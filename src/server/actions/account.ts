"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isConfigured } from "@/lib/env";
import { emailSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/ratelimit";
import { sendEmailChangeEmail } from "@/lib/email";
import type { ActionResult } from "@/server/actions/auth";

const CHANGE_LIMIT = 5;
const CHANGE_WINDOW_MS = 15 * 60_000;

/**
 * Where an email-change confirmation link points.
 *
 * Same shape as buildRecoveryUrl: a `token_hash` link to our own interstitial
 * callback, which `verifyOtp` accepts from any device — so a university mail
 * scanner fetching the link on GET cannot consume a browser-bound PKCE token
 * (the trap that broke magic links and recovery here twice). `next` lands them
 * back on the profile page; the callback clamps it to an in-app path anyway.
 */
function buildEmailChangeUrl(hashedToken: string): string {
  const url = new URL("/auth/callback", env.siteUrl);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", "email_change");
  url.searchParams.set("next", "/profile");
  return url.toString();
}

/**
 * The token_hash to verify, taken from GoTrue's own `action_link` rather than
 * `properties.hashed_token`.
 *
 * They are NOT the same for an email change. `properties.hashed_token` is
 * hashed from the address passed as `email` (the current address), but the
 * token GoTrue actually stores for the NEW-address side is hashed from the new
 * address — so a link built from `hashed_token` would match no one-time-token
 * row and verify as expired. `action_link` is the exact URL GoTrue would have
 * emailed, and its `token` query param is the correct hash for that side. We
 * only lift the token out and drop it into our own callback URL; the link's
 * Supabase host is never used, so the scanner-safe `token_hash` flow stands.
 */
function tokenFromActionLink(actionLink: string | undefined): string | null {
  if (!actionLink) return null;
  try {
    return new URL(actionLink).searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Change the email the account signs in with. Two-step by design: this only
 * STAGES the change and emails a confirmation link; the login email doesn't
 * move until the link is opened. Never uses supabase.auth.updateUser({email}),
 * whose confirmation link — under the SSR client's forced PKCE — is the same
 * device-bound `?code=` link that campus scanners burn on GET. We mint the
 * link ourselves via admin generateLink and send it through Resend, exactly
 * like requestPasswordReset.
 *
 * If the project has Supabase "Secure email change" ON (the default), both the
 * new AND the current address must confirm, so we send a link to each. With it
 * OFF, only the new-address link is needed; the current-address link is
 * best-effort and its absence changes nothing.
 *
 * The current email is read from the session, never from the caller — the
 * admin client bypasses RLS, so it must not trust client-supplied identity.
 */
export async function requestEmailChange(input: {
  newEmail: string;
}): Promise<ActionResult<{ newEmail: string; alsoEmailedCurrent: boolean }>> {
  const parsed = emailSchema.safeParse(input.newEmail);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) {
    return {
      ok: false,
      error:
        "ClassAct isn't connected to its database yet. Add the Supabase keys in .env.local (see HANDOFF.md).",
    };
  }
  if (!isConfigured.supabaseAdmin || !isConfigured.email) {
    return {
      ok: false,
      error: "This server can't send email-change links yet. Tell your professor.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "Sign in first." };

  const currentEmail = user.email.toLowerCase();
  const newEmail = parsed.data.toLowerCase();
  if (newEmail === currentEmail) {
    return { ok: false, error: "That's already your account email." };
  }

  const { allowed } = rateLimit(`email-change:${user.id}`, {
    limit: CHANGE_LIMIT,
    windowMs: CHANGE_WINDOW_MS,
  });
  if (!allowed) {
    return {
      ok: false,
      error: "Too many attempts just now — wait a few minutes and try again.",
    };
  }

  const admin = createAdminClient();

  // The new-address link is essential and staged first: this is what carries
  // the change. A failure here (most often the address already belongs to
  // another account) is the one we report.
  const { data: newData, error: newError } = await admin.auth.admin.generateLink({
    type: "email_change_new",
    email: currentEmail,
    newEmail,
  });
  const newToken = tokenFromActionLink(newData?.properties?.action_link);
  if (newError || !newToken) {
    return {
      ok: false,
      error:
        "Couldn't start the email change — that address may already be in use. Try another.",
    };
  }
  const newSent = await sendEmailChangeEmail(newEmail, buildEmailChangeUrl(newToken), {
    toCurrentAddress: false,
  });
  if (!newSent) {
    return { ok: false, error: "Couldn't send the confirmation email. Try again." };
  }

  // The current-address link only matters when "Secure email change" is ON,
  // where both sides must confirm. Best-effort: if generating it fails (the
  // setting is OFF), the new-address link alone completes the change.
  let alsoEmailedCurrent = false;
  const { data: curData } = await admin.auth.admin.generateLink({
    type: "email_change_current",
    email: currentEmail,
    newEmail,
  });
  const curToken = tokenFromActionLink(curData?.properties?.action_link);
  if (curToken) {
    alsoEmailedCurrent = await sendEmailChangeEmail(
      currentEmail,
      buildEmailChangeUrl(curToken),
      { toCurrentAddress: true }
    );
  }

  return { ok: true, data: { newEmail, alsoEmailedCurrent } };
}
