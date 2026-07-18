"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  layoutToSeats,
  validateLayout,
  type RoomLayout,
} from "@/lib/roomlayout";
import { draftRoomFromImage, type RoomDraft } from "@/server/roomvision";
import type { ActionResult } from "@/server/actions/auth";

/**
 * Room setup v2 (replaces generateSeatMap): a course's seats are generated
 * from a RoomLayout, and the layout is stored in the shared rooms database —
 * attached to university → building → room number when the professor names
 * one, private otherwise. Courses snapshot seats at save/adopt time, so a
 * later edit to a shared room never moves another course's students.
 */

/** Email domains that identify a person, not an institution. */
const GENERIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export interface RoomLocation {
  universityName: string;
  buildingName: string;
  roomNumber: string;
}

export interface RoomSearchHit {
  roomId: string;
  universityName: string;
  buildingName: string;
  roomNumber: string;
  capacity: number;
  layoutType: string;
  verified: boolean;
  layout: RoomLayout;
}

async function requireProfessorCourse(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." as const, supabase, user: null, course: null };
  const { data: course } = await supabase
    .from("courses")
    .select("id, professor_id")
    .eq("id", courseId)
    .single();
  if (!course || course.professor_id !== user.id) {
    return {
      error: "Only the course owner can edit the room." as const,
      supabase,
      user,
      course: null,
    };
  }
  return { error: null, supabase, user, course };
}

/** Existing check-ins guard: replacing seats cascades check-in deletes. */
async function hasCheckIns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string
): Promise<boolean> {
  const { data: seatIds } = await supabase
    .from("seats")
    .select("id")
    .eq("course_id", courseId);
  if (!seatIds || seatIds.length === 0) return false;
  const { count } = await supabase
    .from("check_ins")
    .select("id", { count: "exact", head: true })
    .in(
      "seat_id",
      seatIds.map((s) => s.id)
    );
  return (count ?? 0) > 0;
}

/** Replace a course's seats with the layout's placements. */
async function replaceSeats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  layout: RoomLayout
): Promise<{ seatCount: number } | { error: string }> {
  const placements = layoutToSeats(layout);
  const { error: delError } = await supabase
    .from("seats")
    .delete()
    .eq("course_id", courseId);
  if (delError) return { error: "Couldn't update the room. Try again." };
  const { error: insError } = await supabase.from("seats").insert(
    placements.map((p) => ({
      course_id: courseId,
      label: p.label,
      row_index: p.row,
      col_index: p.col,
      x: p.x,
      y: p.y,
      section: p.section,
      table_id: p.tableId,
      neighbors: p.neighbors,
    }))
  );
  if (insError) return { error: "Couldn't save the room. Try again." };
  return { seatCount: placements.length };
}

/**
 * Find-or-create the university → building chain for a named location, and
 * stamp the professor's university on their profile. University domain is
 * captured from the professor's email when it isn't a personal provider.
 */
async function resolveLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  userEmail: string | undefined,
  location: RoomLocation
): Promise<{ buildingId: string } | { error: string }> {
  const uniName = location.universityName.trim();
  const buildingName = location.buildingName.trim();
  const emailDomain = userEmail?.split("@")[1]?.toLowerCase();
  const institutionalDomain =
    emailDomain && !GENERIC_DOMAINS.has(emailDomain) ? emailDomain : null;

  // University: match by exact name (case-insensitive), then by email domain.
  let universityId: string | null = null;
  const { data: byName } = await supabase
    .from("universities")
    .select("id")
    .ilike("name", uniName)
    .maybeSingle();
  universityId = byName?.id ?? null;
  if (!universityId && institutionalDomain) {
    const { data: byDomain } = await supabase
      .from("universities")
      .select("id")
      .eq("domain", institutionalDomain)
      .maybeSingle();
    universityId = byDomain?.id ?? null;
  }
  if (!universityId) {
    const { data: created, error } = await supabase
      .from("universities")
      .insert({ name: uniName, domain: institutionalDomain })
      .select("id")
      .single();
    if (error || !created) return { error: "Couldn't save the university." };
    universityId = created.id;
  }

  await supabase
    .from("profiles")
    .update({ university_id: universityId })
    .eq("id", userId);

  const { data: existingBuilding } = await supabase
    .from("buildings")
    .select("id")
    .eq("university_id", universityId)
    .ilike("name", buildingName)
    .maybeSingle();
  if (existingBuilding) return { buildingId: existingBuilding.id };
  const { data: createdBuilding, error: buildingError } = await supabase
    .from("buildings")
    .insert({ university_id: universityId, name: buildingName })
    .select("id")
    .single();
  if (buildingError || !createdBuilding) {
    return { error: "Couldn't save the building." };
  }
  return { buildingId: createdBuilding.id };
}

/**
 * Save the designed layout: regenerate this course's seats, store the room
 * in the shared database (located if the professor named a building/room),
 * and link the course to it.
 */
export async function saveRoomLayout(
  courseId: string,
  layout: RoomLayout,
  location: RoomLocation | null,
  force = false,
  aiDrafted = false
): Promise<ActionResult<{ seatCount: number; hadCheckIns: boolean }>> {
  const invalid = validateLayout(layout);
  if (invalid) return { ok: false, error: invalid };

  const { error: authError, supabase, user } = await requireProfessorCourse(courseId);
  if (authError || !user) return { ok: false, error: authError ?? "Sign in first." };

  const hadCheckIns = await hasCheckIns(supabase, courseId);
  if (hadCheckIns && !force) {
    return {
      ok: false,
      error:
        "This room already has recorded check-ins. Rebuilding the map erases them. Confirm to continue.",
    };
  }

  // Locate the room in the shared database when the professor named it.
  let buildingId: string | null = null;
  let roomNumber: string | null = null;
  if (
    location &&
    location.universityName.trim() &&
    location.buildingName.trim() &&
    location.roomNumber.trim()
  ) {
    const resolved = await resolveLocation(supabase, user.id, user.email, location);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    buildingId = resolved.buildingId;
    roomNumber = location.roomNumber.trim();
  }

  const capacity = layoutToSeats(layout).length;

  // Update my existing room for this course when there is one; else create.
  const { data: course } = await supabase
    .from("courses")
    .select("room_id")
    .eq("id", courseId)
    .single();
  const roomPatch = {
    building_id: buildingId,
    room_number: roomNumber,
    layout: layout as unknown as Record<string, unknown>,
    capacity,
    layout_type: layout.type,
    source: aiDrafted ? ("ai_import" as const) : ("professor" as const),
    updated_at: new Date().toISOString(),
  };

  let roomId: string | null = null;
  if (course?.room_id) {
    const { data: updated } = await supabase
      .from("rooms")
      .update(roomPatch)
      .eq("id", course.room_id)
      .eq("created_by", user.id)
      .select("id")
      .maybeSingle();
    roomId = updated?.id ?? null;
  }
  if (!roomId) {
    const { data: created, error: roomError } = await supabase
      .from("rooms")
      .insert({ ...roomPatch, created_by: user.id })
      .select("id")
      .single();
    if (roomError || !created) {
      return { ok: false, error: "Couldn't save the room. Try again." };
    }
    roomId = created.id;
  }

  const replaced = await replaceSeats(supabase, courseId, layout);
  if ("error" in replaced) return { ok: false, error: replaced.error };

  await supabase.from("courses").update({ room_id: roomId }).eq("id", courseId);

  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true, data: { seatCount: replaced.seatCount, hadCheckIns } };
}

/**
 * One-click adoption of a room another professor already mapped: snapshot
 * its layout into this course's seats and link the course to the room.
 */
export async function adoptRoom(
  courseId: string,
  roomId: string,
  force = false
): Promise<ActionResult<{ seatCount: number; hadCheckIns: boolean }>> {
  const { error: authError, supabase, user } = await requireProfessorCourse(courseId);
  if (authError || !user) return { ok: false, error: authError ?? "Sign in first." };

  const { data: room } = await supabase
    .from("rooms")
    .select("id, layout")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "That room isn't in the database anymore." };

  const layout = room.layout as unknown as RoomLayout;
  const invalid = validateLayout(layout);
  if (invalid) {
    return { ok: false, error: "That room's map is unusable — build your own instead." };
  }

  const hadCheckIns = await hasCheckIns(supabase, courseId);
  if (hadCheckIns && !force) {
    return {
      ok: false,
      error:
        "This room already has recorded check-ins. Rebuilding the map erases them. Confirm to continue.",
    };
  }

  const replaced = await replaceSeats(supabase, courseId, layout);
  if ("error" in replaced) return { ok: false, error: replaced.error };

  await supabase.from("courses").update({ room_id: room.id }).eq("id", courseId);

  revalidatePath(`/course/${courseId}/setup`);
  return { ok: true, data: { seatCount: replaced.seatCount, hadCheckIns } };
}

/**
 * Typeahead over the shared room database: building/room within a
 * university (falling back to all universities when none typed yet).
 */
export async function searchRooms(input: {
  universityName: string;
  query: string;
}): Promise<ActionResult<RoomSearchHit[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const query = input.query.trim();
  if (query.length < 1) return { ok: true, data: [] };

  const { data: rows, error } = await supabase
    .from("rooms")
    .select(
      "id, room_number, capacity, layout_type, verified, layout, buildings!inner(name, universities!inner(name))"
    )
    .not("building_id", "is", null)
    .limit(50);
  if (error) return { ok: false, error: "Search failed. Try again." };

  const uniFilter = input.universityName.trim().toLowerCase();
  const q = query.toLowerCase();
  const hits: RoomSearchHit[] = [];
  for (const row of rows ?? []) {
    const building = row.buildings as unknown as {
      name: string;
      universities: { name: string };
    };
    const universityName = building.universities.name;
    if (uniFilter && !universityName.toLowerCase().includes(uniFilter)) continue;
    const haystack = `${building.name} ${row.room_number ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    hits.push({
      roomId: row.id,
      universityName,
      buildingName: building.name,
      roomNumber: row.room_number ?? "",
      capacity: row.capacity,
      layoutType: row.layout_type,
      verified: row.verified,
      layout: row.layout as unknown as RoomLayout,
    });
    if (hits.length >= 8) break;
  }
  return { ok: true, data: hits };
}

/** ~6 MB of image, after base64's 4/3 overhead. */
const MAX_IMAGE_BASE64_CHARS = 8_000_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * AI draft: photo of the classroom in, designer preset knobs out. The
 * draft is only a starting point — it opens in the designer for the
 * professor to review and tweak; nothing is saved here.
 */
export async function draftRoomFromPhoto(
  courseId: string,
  imageBase64: string,
  mimeType: string
): Promise<ActionResult<RoomDraft>> {
  const { error: authError, user } = await requireProfessorCourse(courseId);
  if (authError || !user) return { ok: false, error: authError ?? "Sign in first." };

  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return { ok: false, error: "Upload a photo (JPEG, PNG, WebP, or GIF)." };
  }
  if (!imageBase64 || imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return { ok: false, error: "That image is too large — keep it under ~6 MB." };
  }

  const result = await draftRoomFromImage({ imageBase64, mimeType });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.draft };
}
