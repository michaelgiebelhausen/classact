"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import type { ActionResult } from "@/server/actions/auth";

const answersSchema = z.record(z.string(), z.string().trim().max(2000));

/**
 * Finish student onboarding (FR-007): save name + icebreaker answers to every
 * course the student belongs to, then mark onboarding complete.
 */
export async function completeOnboarding(input: {
  fullName: string;
  answers: Record<string, string>;
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) {
    return { ok: false, error: "Tell us your name — it's how classmates find you." };
  }
  const parsedAnswers = answersSchema.safeParse(input.answers);
  if (!parsedAnswers.success) {
    return { ok: false, error: "One of your answers is too long." };
  }

  const validKeys = new Set(ICEBREAKER_CATALOG.map((f) => f.key));
  const spotify = parsedAnswers.data["spotify_url"];
  if (spotify && !/^https?:\/\/.+/i.test(spotify)) {
    return { ok: false, error: "The Spotify link should be a URL (https://…)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: myEnrollments } = await supabase
    .from("enrollments")
    .select("id")
    .eq("profile_id", user.id);

  const answerRows = Object.entries(parsedAnswers.data)
    .filter(([key, value]) => validKeys.has(key) && value.length > 0)
    .flatMap(([key, value]) =>
      (myEnrollments ?? []).map((e) => ({
        enrollment_id: e.id,
        field_key: key,
        value,
      }))
    );

  if (answerRows.length > 0) {
    const { error } = await supabase
      .from("student_answers")
      .upsert(answerRows, { onConflict: "enrollment_id,field_key" });
    if (error) {
      return { ok: false, error: "Couldn't save your answers. Try again." };
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, onboarding_complete: true })
    .eq("id", user.id);
  if (profileError) {
    return { ok: false, error: "Couldn't finish onboarding. Try again." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
