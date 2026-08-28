"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { normalizeLinkedInUrl } from "@/lib/linkedin";
import { canLeaveProfessorRole } from "@/lib/rolechange";
import { validateUserDoc, byteLength } from "@/lib/usermd";
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

/**
 * Switch your own account back to a student account.
 *
 * The inverse of `becomeProfessor`, which was a one-way door until now. A
 * student who taps "professor" at sign-up has no join-a-class path at all —
 * every sign-in drops them on the course builder, and clearing cookies doesn't
 * help because the role is on the profile row. Three students sat in that
 * state during the Fall 2026 pilot, all three already enrolled in the class
 * they couldn't see.
 *
 * Deliberately leaves `onboarding_complete` untouched. Whatever they had
 * stands: this is a routing fix, not a re-registration, and the account —
 * login, email, enrollments — is the same one it was a second ago.
 */
export async function becomeStudent(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Count what they'd be walking away from. Read through RLS on purpose:
  // courses are scoped to `professor_id = auth.uid()`, so this sees exactly
  // the courses they own and nothing else.
  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id")
    .eq("professor_id", user.id);
  if (coursesError) {
    // Never demote on an unread course list — that is precisely how a class
    // gets stranded by a transient query failure.
    return {
      ok: false,
      error: "Couldn't check your courses just now. Try again in a moment.",
    };
  }

  const courseIds = (courses ?? []).map((c) => c.id);
  let studentsEnrolled = 0;
  if (courseIds.length > 0) {
    const { count, error: enrollError } = await supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .in("course_id", courseIds)
      .neq("status", "dropped");
    if (enrollError) {
      return {
        ok: false,
        error: "Couldn't check your rosters just now. Try again in a moment.",
      };
    }
    studentsEnrolled = count ?? 0;
  }

  const verdict = canLeaveProfessorRole({
    coursesTaught: courseIds.length,
    studentsEnrolled,
  });
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  const { error } = await supabase
    .from("profiles")
    .update({ role: "student" })
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
