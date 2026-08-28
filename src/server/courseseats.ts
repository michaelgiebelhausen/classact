import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  tableFootprint,
  type RoomLayout,
  type TableFootprint,
} from "@/lib/roomlayout";
import type { Database, SeatNeighbors } from "@/types/db";

/**
 * One seat, ready to hand to RoomMap.
 *
 * Structurally the same object CheckInLive calls `SeatInfo`; callers that
 * don't care about adjacency (the presenter, the last-class map) can ignore
 * `neighbors` and pass this straight to RoomMap.
 */
export interface CourseSeat {
  id: string;
  label: string;
  x: number;
  y: number;
  section: string;
  tableId: string | null;
  tableShape?: "rect" | "oval" | "ushape";
  tableFootprint?: TableFootprint;
  neighbors: SeatNeighbors;
}

/**
 * The room, as every map-drawing page needs it.
 *
 * This block was inline in the check-in page and copied into the follow-along
 * page; the games page would have been the third copy, and each copy carries
 * two fallbacks that are easy to drop and hard to notice missing (see below).
 *
 * Seat geometry is read with whatever client the caller passes: `seats`,
 * `rooms`, and `courses` are all readable by any course member under RLS, so
 * this never needs the service role.
 */
export async function loadCourseSeats(
  client: SupabaseClient<Database>,
  courseId: string,
  roomId: string | null
): Promise<CourseSeat[]> {
  const { data: seatRows } = await client
    .from("seats")
    .select("id, label, row_index, col_index, x, y, section, table_id, neighbors")
    .eq("course_id", courseId);

  // Table furniture lives in the room's layout, not on the seat rows —
  // without it every table draws as an oval however it was designed, and a
  // table against a wall draws centered on its chairs instead of on the wall.
  const tableShapes = new Map<string, "rect" | "oval" | "ushape">();
  const tableFootprints = new Map<string, TableFootprint>();
  if (roomId) {
    const { data: room } = await client
      .from("rooms")
      .select("layout")
      .eq("id", roomId)
      .maybeSingle();
    const layout = room?.layout as unknown as RoomLayout | null;
    for (const section of layout?.sections ?? []) {
      if (section.kind !== "table") continue;
      tableShapes.set(section.id, section.shape);
      const footprint = tableFootprint(section);
      if (footprint) tableFootprints.set(section.id, footprint);
    }
  }

  return (seatRows ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    // Pre-migration rows have no x/y and fall back to their grid coords, so
    // a room designed before room-setup v2 still draws instead of collapsing
    // every seat onto the origin.
    x: s.x ?? s.col_index ?? 0,
    y: s.y ?? (s.row_index ?? 0) * 1.25,
    section: s.section ?? "main",
    tableId: s.table_id ?? null,
    tableShape: s.table_id ? tableShapes.get(s.table_id) : undefined,
    tableFootprint: s.table_id ? tableFootprints.get(s.table_id) : undefined,
    neighbors: s.neighbors ?? {},
  }));
}
