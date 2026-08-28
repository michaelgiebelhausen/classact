/**
 * Client-side companion to the signed-URL cache in lib/storage.
 *
 * The server keeps a photo's signed URL stable per instance, but a page
 * refresh routed to a DIFFERENT serverless instance still arrives with a
 * byte-different URL for the same storage path — and any change to an
 * <img src> makes the browser refetch and the avatar flash its fallback.
 *
 * So the browser pins the first URL it sees for each path and keeps using
 * it: it already has those bytes cached, and the signature stays valid for
 * an hour. Two rules keep this honest:
 *
 * - Pins expire after 10 minutes — the signature budget stacks 45 min
 *   (server URL cache) + 60s (course-directory cache) + this pin, and the
 *   total must stay inside the 1-hour signature life.
 * - An expired pin is never swapped cold. Swapping src to a never-fetched
 *   URL is exactly the flash this module exists to prevent — and a page's
 *   pins all expire together, which would blink the whole room at once. So
 *   the replacement URL is warmed in the browser's cache first (an offscreen
 *   Image), and adopted on a later render once its bytes are local; the
 *   visible swap is then instant.
 *
 * During SSR this is a pure pass-through: module state on the server is one
 * map shared across every request and user on a warm instance, which is
 * neither correct nor bounded. Pinning is a browser concern.
 *
 * Photo RE-UPLOADS are out of scope on purpose: uploads land on a fresh
 * versioned storage path (see server/actions/photos.ts), so the new photo
 * arrives under a new pin key and shows immediately — no pin ever holds an
 * old face back.
 */

const PIN_TTL_MS = 10 * 60 * 1000;

const pins = new Map<string, { url: string; ts: number }>();
const warming = new Set<string>();

/** The URL minus its query string — the signature lives in the query, the
 *  storage path in what remains, so this is stable per photo version. */
export function photoPathKey(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Return the pinned URL for this photo's path, pinning `url` if the path is
 * new. Null passes through so callers can wrap optional fields without
 * ceremony.
 */
export function stablePhotoUrl(
  url: string | null | undefined,
  now: () => number = Date.now
): string | null {
  // SSR pass-through — see the module comment.
  if (typeof window === "undefined") return url ?? null;
  if (!url) return null;
  const key = photoPathKey(url);
  const pinned = pins.get(key);
  if (!pinned) {
    pins.set(key, { url, ts: now() });
    return url;
  }
  const fresh = now() - pinned.ts < PIN_TTL_MS;
  if (pinned.url === url) {
    // Same string — re-stamp an expired pin for free; nothing can flash.
    if (!fresh) pins.set(key, { url, ts: now() });
    return url;
  }
  if (fresh) return pinned.url;
  // Expired pin, different URL: keep serving the old one while the new
  // one's bytes are fetched into the browser cache, then adopt.
  if (!warming.has(key)) {
    warming.add(key);
    const img = new Image();
    img.onload = () => {
      warming.delete(key);
      pins.set(key, { url, ts: now() });
    };
    img.onerror = () => {
      // Couldn't warm it (bad token?). Drop the pin so the next render
      // adopts whatever fresh URL the page holds by then.
      warming.delete(key);
      pins.delete(key);
    };
    img.src = url;
  }
  return pinned.url;
}

/** Test hook — module state would otherwise leak between test cases. */
export function clearPhotoPins(): void {
  pins.clear();
  warming.clear();
}
