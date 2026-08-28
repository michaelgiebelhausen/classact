import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, PhotoKind } from "@/types/db"

export const PHOTO_BUCKET = "profile-photos"
export const DECK_BUCKET = "lecture-decks"
export const PROJECT_BUCKET = "project-docs"
export const ASSIGNMENT_BUCKET = "assignment-docs"
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

/** Short-lived signed URL for a project assignment PDF. */
export async function getSignedProjectUrl(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(PROJECT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/** Short-lived signed URL for a student's own submitted file, so they can
 *  confirm the right one landed instead of trusting a timestamp. */
export async function getSignedSubmissionUrl(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(ASSIGNMENT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * Base storage path for a student's photo of a given kind. Uploads append a
 * timestamp (see server/actions/photos.ts) so each upload gets a fresh path —
 * that's what busts every cache layer on a re-upload. The bare form survives
 * as the legacy path for objects uploaded before versioning.
 */
export function photoStoragePath(userId: string, kind: PhotoKind): string {
  return `${userId}/${kind}`
}

/**
 * Photo URLs are additionally cached per storage path so the URL STRING stays
 * stable across page renders. A signature is byte-different every time it is
 * minted (the token embeds its own expiry), and a changed <img src> makes the
 * browser refetch and React remount the image — on the check-in page, which
 * refreshes itself on a timer, that showed up as every student photo blinking
 * out and back every ~30 seconds. Serving the identical string for 45 minutes
 * keeps the faces still and the browser's image cache warm. The signature
 * budget stacks: 45 min here + 60s course-directory cache + 10 min client pin
 * (lib/photopin) = 56 min, inside the 1-hour signature life — mind all three
 * numbers when changing any one of them. Names and enrollment data are NOT
 * cached here — only the path → URL mapping, which carries no roster info.
 */
const SIGNED_PHOTO_CACHE_TTL_MS = 45 * 60 * 1000
const SIGNED_PHOTO_CACHE_MAX = 2000
const signedPhotoCache = new Map<string, { url: string; expires: number }>()

/**
 * Forget a user's cached photo URLs after an upload or delete. Their storage
 * paths are deterministic (`${userId}/${kind}`), so a re-upload lands on the
 * SAME path — without this, the old signed URL (and the old face the browser
 * cached under it) would keep serving until the cache TTL ran out.
 */
export function invalidateSignedPhotoUrls(userId: string): void {
  for (const key of signedPhotoCache.keys()) {
    if (key.startsWith(`${userId}/`)) signedPhotoCache.delete(key)
  }
}

/** Create a short-lived signed URL for a single stored photo. */
export async function getSignedPhotoUrl(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  const map = await getSignedPhotoUrls(client, [path])
  return map[path] ?? null
}

/** Batch signed URLs; returns a map keyed by storage path (nulls dropped). */
export async function getSignedPhotoUrls(
  client: SupabaseClient<Database>,
  paths: string[]
): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const now = Date.now()
  const map: Record<string, string> = {}
  const misses: string[] = []
  for (const path of paths) {
    const hit = signedPhotoCache.get(path)
    if (hit && hit.expires > now) {
      map[path] = hit.url
    } else {
      // Purge an expired entry rather than set() over it later: Map.set on
      // an existing key keeps its ORIGINAL position, which would leave the
      // freshest re-signed entries at the eviction front.
      if (hit) signedPhotoCache.delete(path)
      misses.push(path)
    }
  }
  if (misses.length > 0) {
    const { data, error } = await client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(misses, SIGNED_URL_TTL_SECONDS)
    // On error the cache hits still go out — stale-but-valid beats nothing.
    if (!error && data) {
      for (const item of data) {
        if (item.signedUrl && item.path) {
          map[item.path] = item.signedUrl
          signedPhotoCache.set(item.path, {
            url: item.signedUrl,
            expires: now + SIGNED_PHOTO_CACHE_TTL_MS,
          })
        }
      }
    }
  }
  // Insertion order doubles as age order — evict from the front.
  while (signedPhotoCache.size > SIGNED_PHOTO_CACHE_MAX) {
    const oldest = signedPhotoCache.keys().next().value
    if (oldest === undefined) break
    signedPhotoCache.delete(oldest)
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
          // Ordered so callers that take the first photo (the roster
          // portrait) get the same one every render. Unordered, the row
          // order is whatever Postgres returns, and re-uploading one photo
          // silently changes which face everyone else sees.
          .order("kind")
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
