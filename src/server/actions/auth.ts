"use server";

import { createClient } from "@/lib/supabase/server";
import { env, isConfigured } from "@/lib/env";
import {
  joinPasswordSchema,
  joinSchema,
  loginSchema,
  passwordLoginSchema,
  passwordSchema,
  signUpSchema,
} from "@/lib/validators";
import { isValidJoinCodeFormat, normalizeJoinCode } from "@/lib/joincode";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { sendSelfRecoveryEmail, sendSignInLinkEmail } from "@/lib/email";
import {
  buildAuthLinkUrl,
  buildRecoveryUrl,
  recoveryOutcome,
  RECOVERY_LIMIT,
  RECOVERY_WINDOW_MS,
} from "@/lib/recovery";

const NOT_CONFIGURED =
  "ClassAct isn't connected to its database yet. Add the Supabase keys in .env.local (see HANDOFF.md).";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Mint a `token_hash` sign-in link and send it ourselves.
 *
 * Shared by the two link buttons. Both used to call `signInWithOtp`, which
 * hands the job to Supabase's built-in mailer and its dashboard-managed
 * template — the only auth mail the app still didn't control. That path is
 * rate-limited per IP (30 / 5 min; a classroom is one IP) and project-wide
 * (30 / hour, an *hourly* ceiling that outlasts a class period), and whether
 * its link is device-independent depends on a dashboard setting invisible to
 * this repo. On 2026-09-01 a student on that path received a delivered email
 * he could not use while students on the Resend path signed in within seconds.
 *
 * `createIfMissing` is the one difference between the two callers: joining a
 * class legitimately creates an account, signing in never should.
 */
async function issueSignInLink(input: {
  email: string;
  next: string;
  fallbackNext: string;
  context: "login" | "join";
  createIfMissing: boolean;
}): Promise<ActionResult> {
  if (!isConfigured.supabaseAdmin) {
    return {
      ok: false,
      error: "This server can't issue sign-in links. Tell your professor.",
    };
  }

  const email = input.email.trim().toLowerCase();

  // Counted before we know whether the address is real, so the limit cannot
  // itself become an oracle — same rule as recovery.
  const { remaining } = rateLimit(`signinlink:${email}`, {
    limit: RECOVERY_LIMIT,
    windowMs: RECOVERY_WINDOW_MS,
  });

  // The link type is load-bearing, and not for the reason its name suggests.
  // `magiclink` CREATES an account when the address has none — verified
  // against the live project, which is how a typo in the login form used to
  // become a second, empty account that then "didn't work". `recovery` mints
  // only for an existing user and errors otherwise. Both verify through
  // `verifyOtp` and both just sign the person in; `next` decides where they
  // land, so a recovery-type token is a perfectly ordinary sign-in link.
  const linkType = input.createIfMissing ? "magiclink" : "recovery";

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: linkType,
    email,
  });

  const hashed = data?.properties?.hashed_token;

  const decision = recoveryOutcome({
    accountExists: !error && Boolean(hashed),
    emailConfigured: isConfigured.email,
    recentRequests: RECOVERY_LIMIT - remaining,
  });

  if (decision.send && hashed) {
    // Not reported back: distinguishing a send failure from a missing account
    // would turn this into an account-existence oracle. Logged so a silent
    // outage is still visible to us.
    const sent = await sendSignInLinkEmail(
      email,
      buildAuthLinkUrl(env.siteUrl, {
        hashedToken: hashed,
        type: linkType,
        next: input.next,
        fallbackNext: input.fallbackNext,
      }),
      input.context
    );
    if (!sent) console.error("[signinlink] send failed for a requested address");
  }

  return decision.result;
}

/** Send a sign-in link (professors, returning students). */
export async function sendLoginLink(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  // No `createIfMissing`: the old `signInWithOtp` default created an account
  // for any address typed into the login form, which is how a typo became a
  // second, empty account that then "didn't work".
  return issueSignInLink({
    email: parsed.data.email,
    next: "/dashboard",
    fallbackNext: "/dashboard",
    context: "login",
    createIfMissing: false,
  });
}

/** Send a sign-in link for a student joining a course by code. */
export async function sendJoinLink(input: {
  code: string;
  email: string;
}): Promise<ActionResult> {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const code = normalizeJoinCode(parsed.data.code);
  // Both checks happen before anything can create an account: this is the one
  // unauthenticated path that mints users, so the join code has to be real
  // first, or the form becomes a way to fill auth.users with arbitrary
  // addresses. Unlike the email, a wrong code is safe to report plainly —
  // it says nothing about who has an account.
  if (!isValidJoinCodeFormat(code)) {
    return {
      ok: false,
      error: "That doesn't look like a join code — check it with your professor.",
    };
  }
  if (!isConfigured.supabaseAdmin) {
    return {
      ok: false,
      error: "This server can't issue sign-in links. Tell your professor.",
    };
  }
  const { data: course } = await createAdminClient()
    .from("courses")
    .select("id")
    .eq("join_code", code)
    .maybeSingle();
  if (!course) {
    return {
      ok: false,
      error: "That join code didn't match a class — double-check it with your professor.",
    };
  }

  return issueSignInLink({
    email: parsed.data.email,
    next: `/auth/join?code=${encodeURIComponent(code)}`,
    fallbackNext: "/dashboard",
    context: "join",
    createIfMissing: true,
  });
}

/**
 * Password sign-in. The SSR client writes the session cookies, so a
 * successful call means the caller can route straight to the dashboard —
 * no email round-trip.
 */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<ActionResult> {
  const parsed = passwordLoginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return {
      ok: false,
      error:
        "That email and password didn't match. If you used to sign in by email link, use Forgot password to set one.",
    };
  }
  return { ok: true };
}

/**
 * Password sign-up. Email confirmation stays on (roster activation trusts
 * the address), so this sends one confirmation email; after that, sign-ins
 * are instant.
 */
export async function signUpWithPassword(input: {
  email: string;
  password: string;
}): Promise<ActionResult<{ confirmationNeeded: boolean }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // No role. Sign-up used to send one, the handle_new_user() trigger used
      // to store it, and the form's toggle defaulted to "A professor" — so
      // students who never made a choice were filed as professors. Whether
      // you teach a course or attend one is now derived from what you belong
      // to (src/lib/membership.ts), asked at the moment it matters instead of
      // guessed here. Migration 0035 makes the trigger ignore it either way.
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=/dashboard`,
    },
  });
  if (error) {
    return { ok: false, error: "Couldn't create the account. Try again." };
  }
  // Supabase anti-enumeration: an existing confirmed email returns a stub
  // user with no identities instead of an error.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return {
      ok: false,
      error: "An account with this email already exists — sign in instead.",
    };
  }
  return { ok: true, data: { confirmationNeeded: !data.session } };
}

/**
 * Send a set-a-new-password link. Always answers the same (no enumeration).
 *
 * Deliberately does NOT use `supabase.auth.resetPasswordForEmail`, which is
 * what this used to do and why it was no help to the students who needed it
 * most. That path sends through Supabase's built-in mailer — throttled well
 * below a 40-student class — using the stock recovery template, whose
 * `{{ .ConfirmationURL }}` is a PKCE link bound to the browser that requested
 * it. Locked-out students are precisely the ones who cannot satisfy that
 * condition, so the escape hatch failed in the same way as the trap.
 *
 * `generateLink` gives us the `hashed_token` directly. We build our own
 * `/auth/callback?token_hash=…` URL, which `verifyOtp` accepts from any
 * device, and send it via Resend.
 */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };
  if (!isConfigured.supabaseAdmin) {
    return {
      ok: false,
      error: "This server can't issue sign-in links. Tell your professor.",
    };
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Counted before we know whether the address is real, so the rate limit
  // cannot itself become an oracle: probing an unknown address costs the same
  // as probing a known one.
  const { remaining } = rateLimit(`recovery:${email}`, {
    limit: RECOVERY_LIMIT,
    windowMs: RECOVERY_WINDOW_MS,
  });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hashed = data?.properties?.hashed_token;

  const decision = recoveryOutcome({
    accountExists: !error && Boolean(hashed),
    emailConfigured: isConfigured.email,
    recentRequests: RECOVERY_LIMIT - remaining,
  });

  if (decision.send && hashed) {
    // Failure to send is not reported back: it would distinguish a real
    // address from a fake one. It is logged so a silent outage is still
    // visible to us.
    const sent = await sendSelfRecoveryEmail(
      email,
      buildRecoveryUrl(env.siteUrl, hashed, "/update-password")
    );
    if (!sent) console.error("[recovery] send failed for a requested address");
  }

  return decision.result;
}

/** Set a new password — requires the session from a reset (or normal) link. */
export async function updatePassword(input: {
  password: string;
}): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input.password);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: "Open the reset link from your email first — it signs you in so you can set a password.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    return { ok: false, error: "Couldn't set that password. Try another." };
  }
  return { ok: true };
}

/**
 * Student joining by code, password-first. New email → account created (one
 * confirmation email whose link finishes the join). Existing email + right
 * password → signed in now; the caller sends them to /auth/join.
 */
export async function signUpAndJoin(input: {
  code: string;
  email: string;
  password: string;
}): Promise<ActionResult<{ mode: "confirm_sent" | "signed_in" }>> {
  const parsed = joinPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const code = normalizeJoinCode(parsed.data.code);
  const next = `/auth/join?code=${encodeURIComponent(code)}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    return { ok: false, error: "Couldn't create the account. Try again." };
  }
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    // Account already exists — treat the password as a sign-in attempt so
    // returning students can join a second course with the same form.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (signInError) {
      return {
        ok: false,
        error:
          "You already have an account, but that password didn't match — sign in first, or use the email link below.",
      };
    }
    return { ok: true, data: { mode: "signed_in" } };
  }
  if (data.session) return { ok: true, data: { mode: "signed_in" } };
  return { ok: true, data: { mode: "confirm_sent" } };
}
