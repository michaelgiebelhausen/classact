import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

/** Fail closed: never interpret a database error as permission for external effects. */
export async function isPracticeCourse(courseId: string, client?: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await (client ?? createAdminClient()).from("courses").select("practice_source_id").eq("id", courseId).single();
  if (error || !data) throw new Error("Could not verify the course's practice status.");
  return Boolean(data.practice_source_id);
}
