"use server";

import { createClient } from "@/lib/supabase/server";
import { env, isConfigured } from "@/lib/env";
import { loginSchema, joinSchema } from "@/lib/validators";
import { normalizeJoinCode } from "@/lib/joincode";

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
