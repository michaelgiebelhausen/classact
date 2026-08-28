"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  PHOTO_BUCKET,
  invalidateSignedPhotoUrls,
  photoStoragePath,
} from "@/lib/storage";
import type { ActionResult } from "@/server/actions/auth";
import type { PhotoKind } from "@/types/db";

const KINDS: PhotoKind[] = ["candid", "professional", "adventure"];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB post-compression guard

/** Upload (or replace) one of the student's three profile photos (FR-006). */
export async function uploadProfilePhoto(
  formData: FormData
): Promise<ActionResult<{ kind: PhotoKind }>> {
  const kind = formData.get("kind") as PhotoKind | null;
  const file = formData.get("file") as File | null;

  if (!kind || !KINDS.includes(kind)) {
    return { ok: false, error: "Unknown photo type." };
  }
  if (!file || file.size === 0) {
    return { ok: false, error: "Choose a photo first." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That photo is too large (5MB max)." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "That file isn't an image." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // The previous object's path, so it can be cleaned up after the swap.
  const { data: prev } = await supabase
    .from("profile_photos")
    .select("storage_path")
    .eq("profile_id", user.id)
    .eq("kind", kind)
    .maybeSingle();

  // Versioned path: every upload lands on a NEW path, so every cache layer
  // (per-instance signed-URL cache, client pin, browser image cache, CDN)
  // misses naturally on every instance at once. In-memory invalidation can't
  // do that — it only reaches the one serverless instance running this
  // action. The user-id prefix is preserved, so storage RLS still applies.
  const path = `${photoStoragePath(user.id, kind)}-${Date.now()}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type });
  if (uploadError) {
    return { ok: false, error: "Upload failed — try again." };
  }

  const { error: rowError } = await supabase.from("profile_photos").upsert(
    {
      profile_id: user.id,
      kind,
      storage_path: path,
    },
    { onConflict: "profile_id,kind" }
  );
  if (rowError) {
    return { ok: false, error: "Couldn't save the photo record. Try again." };
  }

  // Best-effort: the replaced object is unreachable once the row points at
  // the new path, so a failed remove only leaves an orphan, not a bug.
  if (prev?.storage_path && prev.storage_path !== path) {
    await supabase.storage.from(PHOTO_BUCKET).remove([prev.storage_path]);
  }

  // Local hygiene for THIS instance; the versioned path is what actually
  // propagates the new photo everywhere else.
  invalidateSignedPhotoUrls(user.id);

  revalidatePath("/onboarding");
  revalidatePath("/profile");
  return { ok: true, data: { kind } };
}

/** Delete one photo, or all of the student's photos + answers (FR-018). */
export async function deleteMyData(
  scope: "photos" | "everything"
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Remove storage objects by their RECORDED paths (uploads are versioned,
  // so the path can't be recomputed), plus the legacy unversioned paths for
  // objects uploaded before versioning. Missing paths are fine.
  const { data: photoRows } = await supabase
    .from("profile_photos")
    .select("storage_path")
    .eq("profile_id", user.id);
  const doomed = new Set<string>(KINDS.map((k) => photoStoragePath(user.id, k)));
  for (const row of photoRows ?? []) {
    if (row.storage_path) doomed.add(row.storage_path);
  }
  await supabase.storage.from(PHOTO_BUCKET).remove(Array.from(doomed));
  await supabase.from("profile_photos").delete().eq("profile_id", user.id);
  invalidateSignedPhotoUrls(user.id);

  if (scope === "everything") {
    const { data: myEnrollments } = await supabase
      .from("enrollments")
      .select("id")
      .eq("profile_id", user.id);
    const ids = (myEnrollments ?? []).map((e) => e.id);
    if (ids.length > 0) {
      await supabase.from("student_answers").delete().in("enrollment_id", ids);
    }
  }

  revalidatePath("/profile");
  return { ok: true };
}
