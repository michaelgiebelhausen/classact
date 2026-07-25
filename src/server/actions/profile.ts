"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
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
