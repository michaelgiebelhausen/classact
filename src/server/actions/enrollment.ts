"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { composeFullName } from "@/lib/names";
import type { ActionResult } from "@/server/actions/auth";

const answersSchema = z.record(z.string(), z.string().trim().max(2000));

/**
 * Finish student onboarding (FR-007): save name + icebreaker answers to every
 * course the student belongs to, then mark onboarding complete.
 *
 * Given and family names are captured separately (0042) and composed into the
 * canonical `full_name` the rest of the app reads.
 */
export async function completeOnboarding(input: {
  firstName: string;
  lastName: string;
  firstNamePhonetic?: string;
  lastNamePhonetic?: string;
  answers: Record<string, string>;
}): Promise<ActionResult> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (firstName.length < 1) {
    return { ok: false, error: "Tell us your name — it's how classmates find you." };
  }
  const fullName = composeFullName(firstName, lastName);
  // Optional pronunciation guide, edited per part, stored composed like the name.
  const firstNamePhonetic = (input.firstNamePhonetic ?? "").trim().slice(0, 60);
  const lastNamePhonetic = (input.lastNamePhonetic ?? "").trim().slice(0, 60);
  const namePhonetic = composeFullName(firstNamePhonetic, lastNamePhonetic).slice(0, 100);
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
    .update({
      first_name: firstName,
      last_name: lastName.length > 0 ? lastName : null,
      full_name: fullName,
      first_name_phonetic: firstNamePhonetic.length > 0 ? firstNamePhonetic : null,
      last_name_phonetic: lastNamePhonetic.length > 0 ? lastNamePhonetic : null,
      name_phonetic: namePhonetic.length > 0 ? namePhonetic : null,
      onboarding_complete: true,
    })
    .eq("id", user.id);
  if (profileError) {
    return { ok: false, error: "Couldn't finish onboarding. Try again." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
