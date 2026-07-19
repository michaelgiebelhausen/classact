"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/joincode";
import {
  createCourseSchema,
  icebreakerFieldsSchema,
} from "@/lib/validators";
import { DEFAULT_ICEBREAKER_KEYS, ICEBREAKER_CATALOG } from "@/lib/icebreakers";
import { isScheduleComplete } from "@/lib/schedule";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Create a course (FR-001). Self-serve professor provisioning (Open Q3):
 * creating a course promotes the creator's profile to 'professor'.
 */
export async function createCourse(input: {
  name: string;
  term?: string;
}): Promise<ActionResult<{ id: string; joinCode: string }>> {
  const parsed = createCourseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to create a course." };

  // Promote to professor (idempotent).
  await supabase
    .from("profiles")
    .update({ role: "professor" })
    .eq("id", user.id);

  // Insert with join-code retry on the (rare) unique collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode(parsed.data.name);
    const { data, error } = await supabase
      .from("courses")
      .insert({
        professor_id: user.id,
        name: parsed.data.name,
        term: parsed.data.term || null,
        join_code: joinCode,
        icebreaker_fields: DEFAULT_ICEBREAKER_KEYS,
      })
      .select("id, join_code")
      .single();

    if (data) {
      revalidatePath("/dashboard");
      return { ok: true, data: { id: data.id, joinCode: data.join_code } };
    }
    // 23505 = unique_violation on join_code -> retry; anything else -> fail
    if (error && error.code !== "23505") {
      return { ok: false, error: "Couldn't create the course. Try again." };
    }
  }
  return { ok: false, error: "Couldn't generate a unique join code. Try again." };
}

/** Toggle which icebreaker fields students answer (FR-004). */
export async function updateIcebreakerFields(
  courseId: string,
  fieldKeys: string[]
): Promise<ActionResult> {
  const parsed = icebreakerFieldsSchema.safeParse(fieldKeys);
  if (!parsed.success) return { ok: false, error: "Invalid field selection." };

  const validKeys = new Set(ICEBREAKER_CATALOG.map((f) => f.key));
  const keys = parsed.data.filter((k) => validKeys.has(k));

  const supabase = await createClient();
  // RLS restricts the update to the owning professor.
  const { error } = await supabase
    .from("courses")
    .update({ icebreaker_fields: keys })
    .eq("id", courseId);

  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true };
}

/**
 * Set the meeting schedule. With auto-open on, check-in opens itself 15
 * minutes before start on meeting days — no professor click required.
 * An empty days list clears the schedule (manual open only).
 */
export async function updateSchedule(
  courseId: string,
  input: {
    days: number[];
    start: string | null;
    end: string | null;
    timezone: string | null;
    autoOpen: boolean;
  }
): Promise<ActionResult> {
  const clearing = input.days.length === 0;
  if (!clearing && !isScheduleComplete(input)) {
    return {
      ok: false,
      error: "Pick at least one day and a start time before the end time.",
    };
  }
  if (!clearing) {
    try {
      // Throws on unknown IANA names — reject rather than store garbage.
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone! });
    } catch {
      return { ok: false, error: "Unrecognized timezone — try saving again." };
    }
  }

  const supabase = await createClient();
  // RLS restricts the update to the owning professor.
  const { error } = await supabase
    .from("courses")
    .update(
      clearing
        ? { meeting_days: [], meeting_start: null, meeting_end: null, auto_open: input.autoOpen }
        : {
            meeting_days: [...new Set(input.days)].sort((a, b) => a - b),
            meeting_start: input.start,
            meeting_end: input.end,
            timezone: input.timezone,
            auto_open: input.autoOpen,
          }
    )
    .eq("id", courseId);

  if (error) return { ok: false, error: "Couldn't save the schedule. Try again." };
  revalidatePath(`/course/${courseId}/setup`);
  revalidatePath(`/course/${courseId}/checkin`);
  return { ok: true };
}
