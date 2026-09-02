import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

/**
 * rendered_pages per deck, read on its own and fail-soft.
 *
 * Migrations here are applied by hand, and a deploy can land before its
 * migration (0047). If this column were part of the deck SELECT that feeds
 * the follow page, a missing column would null the whole deck and every
 * student would see "no live lecture" until the migration ran. Read
 * separately, an error just means "no images yet" and the PDF path stands.
 */
export async function readRenderedPages(
  client: SupabaseClient<Database>,
  deckIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (deckIds.length === 0) return out;
  try {
    const { data, error } = await client
      .from("lecture_decks")
      .select("id, rendered_pages")
      .in("id", deckIds);
    if (error || !data) return out;
    for (const row of data) out.set(row.id, row.rendered_pages ?? 0);
  } catch {
    // Column not there yet; treat as unrendered.
  }
  return out;
}
