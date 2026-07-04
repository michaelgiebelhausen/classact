/**
 * Minimal in-memory sliding-window rate limiter. Per-instance (fine for the
 * MVP's single-region deployment); swap for Upstash/Redis if scale demands.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, remaining: limit - hits.length };
}
