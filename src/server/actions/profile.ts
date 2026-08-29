"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { normalizeLinkedInUrl } from "@/lib/linkedin";
import { validateUserDoc, byteLength } from "@/lib/usermd";
import { isEmailAddress } from "@/lib/names";
import { invalidateCourseDirectory } from "@/lib/coursedirectory";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Change the name (and optional pronunciation) the class sees.
 *
 * Onboarding is the only other place this gets set, and a student who typed
 * the wrong thing there — or goes by something other than the registrar name
 * Canvas imported — had no way back to it. This writes the same two columns.
 *
 * The name shows on the seat map and in the name games, both of which read
 * through the per-course directory cache, so every course this person is in
 * gets its directory dropped — otherwise the room keeps showing the old name
 * until the cache TTL lapses.
 */
export async function updateMyName(input: {
  fullName: string;
  namePhonetic?: string;
}): Promise<ActionResult<{ fullName: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const fullName = input.fullName.trim();
  if (fullName.length < 2) {
    return {
      ok: false,
      error: "Tell us your name — it's how classmates find you.",
    };
  }
  if (fullName.length > 80) {
    return { ok: false, error: "That name is too long — keep it under 80 characters." };
  }
  if (isEmailAddress(fullName)) {
    return {
      ok: false,
      error: "That looks like an email — use the name you'd like classmates to see.",
    };
  }
  const namePhonetic = (input.namePhonetic ?? "").trim().slice(0, 100);

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      name_phonetic: namePhonetic.length > 0 ? namePhonetic : null,
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save your name. Try again." };

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("profile_id", user.id)
    .neq("status", "dropped");
  for (const e of enrollments ?? []) invalidateCourseDirectory(e.course_id);

  revalidatePath("/profile");
  return { ok: true, data: { fullName } };
}

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
/*
 * becomeProfessor() and becomeStudent() lived here.
 *
 * They existed to repair `profiles.role` — the global flag that said, in one
 * word, whether you were a professor or a student everywhere in the app. It
 * was set from a sign-up toggle that defaulted to "A professor", so it was
 * wrong often, and because it decided which half of the product you were
 * shown, being wrong meant being stranded: a student flagged professor landed
 * on the course builder every sign-in with no route to the class they were
 * already enrolled in. These two buttons were the way out, and
 * canLeaveProfessorRole() was the guard stopping a real professor from
 * demoting themselves out from under a live roster.
 *
 * All three are gone because the flag is gone. Whether you teach or attend is
 * derived per course now, from courses.professor_id and enrollments — see
 * src/lib/membership.ts. There is no account type to switch, so there is
 * nothing to be stuck in and nothing to repair. Migration 0035 stops the
 * sign-up trigger writing the column at all.
 */

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

export interface UserDocView {
  filename: string;
  bytes: number;
  updatedAt: string;
  content: string;
}

/**
 * The Markdown file on your own profile, if you've uploaded one.
 *
 * Read through RLS, so this can only ever return your own — there is no
 * `profileId` parameter on purpose. Whoever eventually gets to read somebody
 * else's is a decision to make deliberately, not one to leave open by
 * accident.
 */
export async function getMyUserDoc(): Promise<UserDocView | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profile_documents")
    .select("filename, content, content_bytes, updated_at")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!data) return null;

  return {
    filename: data.filename,
    bytes: data.content_bytes,
    updatedAt: data.updated_at,
    content: data.content,
  };
}

/**
 * Upload — or replace — the Markdown file on your profile.
 *
 * One row per person, so an upload is an upsert: the new file simply becomes
 * the file. There is no in-app editing by design; the copy on their machine
 * stays the one they wrote.
 *
 * Validated here as well as in the browser. The client check is a courtesy so
 * someone learns their file is too big before waiting for an upload; this one
 * is the rule, because a server action is an HTTP endpoint that anybody can
 * call with anything.
 */
export async function saveUserDoc(input: {
  filename: string;
  content: string;
}): Promise<ActionResult<{ bytes: number }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const filename = input.filename.trim();
  const verdict = validateUserDoc({ filename, content: input.content });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  const bytes = byteLength(input.content);
  const { error } = await supabase.from("profile_documents").upsert(
    {
      profile_id: user.id,
      filename,
      content: input.content,
      content_bytes: bytes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );
  if (error) {
    return { ok: false, error: "Couldn't save that file. Try again." };
  }

  revalidatePath("/profile");
  return { ok: true, data: { bytes } };
}

/** Remove it. Their data, their call — the same principle as the photos. */
export async function deleteUserDoc(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("profile_documents")
    .delete()
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };

  revalidatePath("/profile");
  return { ok: true };
}
