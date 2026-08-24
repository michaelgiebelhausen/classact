import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { resolveEnrollmentPhotos } from "@/lib/storage";
import { isEmailAddress, rosterDisplayName } from "@/lib/names";

export interface DirectoryEntry {
  name: string;
  photoUrl: string | null;
}

export type CourseDirectory = Record<string, CourseDirectoryEntry>;
type CourseDirectoryEntry = DirectoryEntry;

/**
 * Names and one photo per enrollment, for a whole course.
 *
 * Check-in renders this for everyone in the room, so the work is identical for
 * every student and was being redone per request: one query for the roster,
 * one for uploaded photos, and one storage call signing a URL for every photo
 * in the class. Thirty students arriving at 9:29 produced thirty copies of it
 * inside the same few seconds — each holding a serverless function and a
 * database connection open while it ran.
 *
 * Two guards, in order of importance:
 *
 * 1. **In-flight de-duplication.** Concurrent callers for the same course share
 *    one computation instead of starting N. This is the part that actually
 *    addresses a burst, and it costs nothing in freshness.
 * 2. **A short TTL**, for the repeat loads that follow the burst.
 *
 * Deliberately NOT `use cache`: that needs the `cacheComponents` flag, which
 * changes rendering semantics app-wide. This is one function with one job.
 */

/** Well under the one-hour signed-URL lifetime in lib/storage, so a cached
 *  entry can never hand out an already-expired photo URL. */
const TTL_MS = 30_000;

/** A build that never settles would otherwise wedge `inFlight` forever, and
 *  every later request for the course would join a promise that never
 *  resolves. Comfortably longer than a healthy build, far under the route's
 *  90s ceiling. */
const BUILD_TIMEOUT_MS = 10_000;

/** Bounds process memory on a server that has seen many courses. */
const MAX_ENTRIES = 200;

const cache = new Map<string, { expires: number; value: CourseDirectory }>();
const inFlight = new Map<string, Promise<CourseDirectory>>();

/**
 * One line per call, so the next 9:29 leaves evidence.
 *
 * `built` is real work; `shared` means a concurrent request rode along on
 * someone else's build — the burst behaviour we want to see, recorded with how
 * long it actually waited; `cache` is a repeat load. A burst that still shows
 * thirty `built` lines means the requests landed on separate instances and the
 * fix needs to move upstream of process memory.
 */
function log(
  courseId: string,
  source: "built" | "shared" | "cache" | "failed",
  ms: number,
  size: number | null
): void {
  console.log("[directory]", JSON.stringify({ courseId, source, ms, size }));
}

function evictExpired(now: number): void {
  if (cache.size < MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
  // Still oversized (many live courses): drop the oldest-expiring first.
  if (cache.size >= MAX_ENTRIES) {
    const byExpiry = [...cache.entries()].sort(
      (a, b) => a[1].expires - b[1].expires
    );
    for (const [key] of byExpiry.slice(0, cache.size - MAX_ENTRIES + 1)) {
      cache.delete(key);
    }
  }
}

async function build(
  admin: SupabaseClient<Database>,
  courseId: string
): Promise<CourseDirectory> {
  const { data: enrollments, error } = await admin
    .from("enrollments")
    .select("id, roster_name, profile_id, roster_photo_path")
    .eq("course_id", courseId)
    .neq("status", "dropped");

  // supabase-js reports query failures as a value, not a throw. Reading only
  // `data` would turn a transient database error into an empty directory —
  // and caching that blanks every name and face in the room for a full TTL.
  // Throwing keeps it out of the cache and lets the next request try again.
  if (error) throw new Error(`directory query failed: ${error.message}`);

  const photoMap = await resolveEnrollmentPhotos(admin, enrollments ?? []);

  // Only students who joined by course code have an email where their name
  // should be, and only they can be improved by the name they gave at
  // onboarding. A class imported from a roster asks for nothing extra here.
  const needName = (enrollments ?? []).filter(
    (e) => e.profile_id && isEmailAddress(e.roster_name)
  );
  const profileNames = new Map<string, string>();
  if (needName.length > 0) {
    // Deliberately not fatal, where a failed roster query is: the worst case
    // is that a handful of people read as `jsmith` for one TTL, and throwing
    // to avoid that would blank every name and face in the room instead.
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", needName.map((e) => e.profile_id as string));
    for (const p of profiles ?? []) {
      if (p.full_name) profileNames.set(p.id, p.full_name);
    }
  }

  const directory: CourseDirectory = {};
  for (const e of enrollments ?? []) {
    directory[e.id] = {
      name: rosterDisplayName(
        e.roster_name,
        e.profile_id ? profileNames.get(e.profile_id) : null
      ),
      photoUrl: photoMap.get(e.id)?.[0] ?? null,
    };
  }
  return directory;
}

function withTimeout(
  work: Promise<CourseDirectory>,
  ms: number
): Promise<CourseDirectory> {
  return Promise.race([
    work,
    new Promise<CourseDirectory>((_, reject) =>
      setTimeout(
        () => reject(new Error(`directory build exceeded ${ms}ms`)),
        ms
      ).unref?.()
    ),
  ]);
}

/**
 * Caller must already have proved the viewer belongs to this course — this
 * reads with the admin client and performs no authorization of its own. The
 * cache is keyed by course id alone because nothing in the result varies by
 * viewer; if that ever changes, the key has to change with it.
 *
 * Pass the ADMIN client. Passing the RLS-bound client would cache one viewer's
 * row-restricted result and serve it to everyone.
 */
export async function getCourseDirectory(
  admin: SupabaseClient<Database>,
  courseId: string
): Promise<CourseDirectory> {
  const started = Date.now();

  const hit = cache.get(courseId);
  if (hit && hit.expires > started) {
    log(courseId, "cache", 0, Object.keys(hit.value).length);
    return hit.value;
  }

  const pending = inFlight.get(courseId);
  if (pending) {
    // The burst path: ride along rather than starting another build.
    const value = await pending;
    log(courseId, "shared", Date.now() - started, Object.keys(value).length);
    return value;
  }

  const work = withTimeout(build(admin, courseId), BUILD_TIMEOUT_MS);
  inFlight.set(courseId, work);
  try {
    const value = await work;
    evictExpired(started);
    cache.set(courseId, { expires: Date.now() + TTL_MS, value });
    log(courseId, "built", Date.now() - started, Object.keys(value).length);
    return value;
  } catch (err) {
    // Nothing is cached on failure, so the next request gets a real attempt
    // instead of inheriting a blank directory for the next TTL.
    log(courseId, "failed", Date.now() - started, null);
    throw err;
  } finally {
    inFlight.delete(courseId);
  }
}

/**
 * Drop a course's cached directory. Call after anything that changes who is on
 * the roster or what they look like, so a newly added student doesn't render
 * nameless for up to TTL_MS.
 *
 * Clears the in-flight build too: a build that started before the change would
 * otherwise land afterwards and write the pre-change roster back for a full
 * TTL, silently undoing the invalidation.
 */
export function invalidateCourseDirectory(courseId: string): void {
  cache.delete(courseId);
  inFlight.delete(courseId);
}
