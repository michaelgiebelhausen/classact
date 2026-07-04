"use server";

import { createClient } from "@/lib/supabase/server";
import { gameScoreSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";

/** Record a finished round (FR-013/FR-014). */
export async function recordGameScore(input: {
  courseId: string;
  gameType: "memory_tiles" | "flash_cards";
  score: number;
  durationMs?: number;
}): Promise<ActionResult> {
  const parsed = gameScoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid score payload." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", parsed.data.courseId)
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: "You're not in this course." };
  }

  const { error } = await supabase.from("name_game_scores").insert({
    enrollment_id: enrollment.id,
    game_type: parsed.data.gameType,
    score: parsed.data.score,
    duration_ms: parsed.data.durationMs ?? null,
  });
  if (error) return { ok: false, error: "Couldn't save your score." };
  return { ok: true };
}
