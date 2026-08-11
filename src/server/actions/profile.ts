"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { normalizeLinkedInUrl } from "@/lib/linkedin";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Save the signed-in user's profile-level icebreaker answers (0019). These
 * are how a professor joins the name games — students answer the same
 * questions per course against their enrollment instead.
 */

const MAX_VALUE_CHARS = 2000;
const VALID_KEYS = new Set(ICEBREAKER_CATALOG.map((f) => f.key));

export async function saveProfileAnswers(
  answers: Record<string, string>
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const filled: Array<{ profile_id: string; field_key: string; value: string }> = [];
  const cleared: string[] = [];
  for (const [key, raw] of Object.entries(answers)) {
    if (!VALID_KEYS.has(key)) continue;
    const value = (raw ?? "").trim().slice(0, MAX_VALUE_CHARS);
    if (value) {
      filled.push({ profile_id: user.id, field_key: key, value });
    } else {
      cleared.push(key);
    }
  }

  if (filled.length > 0) {
    const { error } = await supabase
      .from("profile_answers")
      .upsert(filled, { onConflict: "profile_id,field_key" });
    if (error) return { ok: false, error: "Couldn't save your answers." };
  }
  // Emptying a box removes the answer rather than storing a blank.
  if (cleared.length > 0) {
    await supabase
      .from("profile_answers")
      .delete()
      .eq("profile_id", user.id)
      .in("field_key", cleared);
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Save (or clear) the LinkedIn profile link. Stored canonicalized so every
 * paste style lands on the same URL; an empty value removes it.
 */
/**
 * Switch your own account to a professor account. Self-serve on purpose:
 * the professor role only lets you own courses you create — every policy is
 * scoped to `professor_id = auth.uid()`, so this grants no access to anyone
 * else's data. It's the recovery path for accounts created before sign-up
 * asked, and for anyone who picked the wrong option.
 */
export async function becomeProfessor(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("profiles")
    .update({ role: "professor", onboarding_complete: true })
    .eq("id", user.id);
  if (error) {
    return { ok: false, error: "Couldn't switch your account over." };
  }
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  return { ok: true };
}

export async function saveLinkedInUrl(
  raw: string
): Promise<ActionResult<{ url: string | null }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const trimmed = raw.trim();
  let url: string | null = null;
  if (trimmed) {
    url = normalizeLinkedInUrl(trimmed);
    if (!url) {
      return {
        ok: false,
        error: "That doesn't look like a LinkedIn profile — try your handle or the full linkedin.com/in/… link.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ linkedin_url: url })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save your LinkedIn link." };

  revalidatePath("/profile");
  return { ok: true, data: { url } };
}
