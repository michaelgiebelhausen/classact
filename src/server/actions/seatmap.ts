"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildSeatGrid } from "@/lib/seatlabels";
import { seatGridSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Create/replace a course's seat grid from rows × cols (FR-002).
 * If any check-ins reference existing seats, require `force` (the UI shows a
 * confirm dialog) — replacing seats cascades check-in deletes.
 */
export async function generateSeatMap(
  courseId: string,
  input: { rows: number; cols: number },
  force = false
): Promise<ActionResult<{ seatCount: number; hadCheckIns: boolean }>> {
  const parsed = seatGridSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Rooms are limited to 1–40 rows and 1–40 seats per row." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Ownership check (RLS also enforces, but fail with a clear message).
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return { ok: false, error: "Only the course owner can edit the room." };
  }

  // Any check-ins on this course's seats?
  const { data: seatIds } = await supabase
    .from("seats")
    .select("id")
    .eq("course_id", courseId);
  let hadCheckIns = false;
  if (seatIds && seatIds.length > 0) {
    const { count } = await supabase
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .in(
        "seat_id",
        seatIds.map((s) => s.id)
      );
    hadCheckIns = (count ?? 0) > 0;
    if (hadCheckIns && !force) {
      return {
        ok: false,
        error:
          "This room already has recorded check-ins. Rebuilding the map erases them. Confirm to continue.",
      };
    }
  }

  const grid = buildSeatGrid(parsed.data.rows, parsed.data.cols);

  // Replace: delete old seats (cascades check-ins), insert new grid.
  const { error: delError } = await supabase
    .from("seats")
    .delete()
    .eq("course_id", courseId);
  if (delError) return { ok: false, error: "Couldn't update the room. Try again." };

  const { error: insError } = await supabase.from("seats").insert(
    grid.map((s) => ({
      course_id: courseId,
      label: s.label,
      row_index: s.row,
      col_index: s.col,
    }))
  );
  if (insError) return { ok: false, error: "Couldn't save the room. Try again." };

  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true, data: { seatCount: grid.length, hadCheckIns } };
}
