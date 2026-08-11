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
import { normalizeJoinCode } from "@/lib/joincode";

const NOT_CONFIGURED =
  "ClassAct isn't connected to its database yet. Add the Supabase keys in .env.local (see HANDOFF.md).";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Send a magic link for a plain sign-in (professors, returning students). */
export async function sendLoginLink(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=/dashboard`,
    },
  });
  if (error) {
    return { ok: false, error: "Couldn't send the sign-in link. Try again." };
  }
  return { ok: true };
}

/** Send a magic link for a student joining a course by code. */
export async function sendJoinLink(input: {
  code: string;
  email: string;
}): Promise<ActionResult> {
  const parsed = joinSchema.safeParse(input);
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

  const code = normalizeJoinCode(parsed.data.code);
  const next = `/auth/join?code=${encodeURIComponent(code)}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    return { ok: false, error: "Couldn't send the join link. Try again." };
  }
  return { ok: true };
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
  /** "professor" creates a course-owning account; anything else = student. */
  role?: string;
}): Promise<ActionResult<{ confirmationNeeded: boolean }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const role = input.role === "professor" ? "professor" : "student";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the handle_new_user() trigger (migration 0023).
      data: { role },
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=${
        role === "professor" ? "/course/new" : "/dashboard"
      }`,
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

/** Send the set-a-new-password email. Always succeeds (no enumeration). */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  if (!isConfigured.supabase) return { ok: false, error: NOT_CONFIGURED };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.siteUrl}/auth/callback?next=/update-password`,
  });
  return { ok: true };
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
