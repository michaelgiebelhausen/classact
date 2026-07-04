import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, PhotoKind } from "@/types/db"

export const PHOTO_BUCKET = "profile-photos"
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

/** Deterministic storage path for a student's photo of a given kind. */
export function photoStoragePath(userId: string, kind: PhotoKind): string {
  return `${userId}/${kind}`
}

/** Create a short-lived signed URL for a single stored photo. */
export async function getSignedPhotoUrl(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/** Batch signed URLs; returns a map keyed by storage path (nulls dropped). */
export async function getSignedPhotoUrls(
  client: SupabaseClient<Database>,
  paths: string[]
): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return {}
  const map: Record<string, string> = {}
  for (const item of data) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl
  }
  return map
}
