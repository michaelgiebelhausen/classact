import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, PhotoKind } from "@/types/db"

export const PHOTO_BUCKET = "profile-photos"
export const DECK_BUCKET = "lecture-decks"
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

/** Short-lived signed URL for a lecture deck PDF. */
export async function getSignedDeckUrl(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(DECK_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

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

export interface EnrollmentPhotoInput {
  id: string
  profile_id: string | null
  roster_photo_path: string | null
}

/**
 * Resolve display photos per enrollment. A student's own uploaded photos take
 * precedence; if they have none, their seeded roster photo (e.g. from Canvas)
 * is the fallback. Returns a map of enrollment id -> signed photo URLs.
 */
export async function resolveEnrollmentPhotos(
  client: SupabaseClient<Database>,
  enrollments: EnrollmentPhotoInput[]
): Promise<Map<string, string[]>> {
  const profileIds = enrollments
    .map((e) => e.profile_id)
    .filter((id): id is string => Boolean(id))

  const { data: uploaded } =
    profileIds.length > 0
      ? await client
          .from("profile_photos")
          .select("profile_id, storage_path")
          .in("profile_id", profileIds)
      : { data: [] as { profile_id: string; storage_path: string }[] }

  const allPaths = [
    ...(uploaded ?? []).map((p) => p.storage_path),
    ...enrollments
      .map((e) => e.roster_photo_path)
      .filter((p): p is string => Boolean(p)),
  ]
  const urlMap = await getSignedPhotoUrls(client, allPaths)

  const uploadedByProfile = new Map<string, string[]>()
  for (const p of uploaded ?? []) {
    const url = urlMap[p.storage_path]
    if (!url) continue
    const list = uploadedByProfile.get(p.profile_id) ?? []
    list.push(url)
    uploadedByProfile.set(p.profile_id, list)
  }

  const result = new Map<string, string[]>()
  for (const e of enrollments) {
    const own = e.profile_id ? uploadedByProfile.get(e.profile_id) ?? [] : []
    if (own.length > 0) {
      result.set(e.id, own)
    } else if (e.roster_photo_path && urlMap[e.roster_photo_path]) {
      result.set(e.id, [urlMap[e.roster_photo_path]])
    } else {
      result.set(e.id, [])
    }
  }
  return result
}
