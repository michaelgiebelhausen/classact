import "server-only";
import {
  LoadMetrics,
  formatSampleLine,
  type OpStats,
  type SampleContext,
} from "@/lib/loadmetrics";

/**
 * The process-wide recorder for the check-in path.
 *
 * Every sample goes two places, and the split is the whole point:
 *
 * - `console.log` of a tagged JSON line. This is the DURABLE record. It
 *   outlives the serverless instance, so it is what you read after a class to
 *   find out what happened during it.
 * - Process memory, for `snapshot()`. This is a LIVE peek at one instance and
 *   nothing more. A burst spread over six instances leaves six partial
 *   pictures; do not read a snapshot as if it described the room.
 */
const metrics = new LoadMetrics();

/** Operations worth measuring on the check-in path. */
export type Op =
  /** The `checkIn` server action, end to end. */
  | "checkin"
  /** A full render of the check-in page — what `router.refresh()` costs. */
  | "checkin_page"
  /** A client reported losing its realtime subscription (ms = 0). */
  | "realtime_down"
  /** A client reported regaining it; ms = how long it was degraded. */
  | "realtime_up";

export function recordSample(
  op: Op,
  sample: { ms: number; ok: boolean; code?: string },
  ctx: SampleContext = {}
): void {
  const at = Date.now();
  metrics.record(op, { ...sample, at });
  console.log(formatSampleLine(op, { ...sample, at }, ctx));
}

/**
 * Time an operation and record it, whatever happens.
 *
 * `classify` turns a thrown error or a returned failure into a short code, so
 * contention shows up as its own counter instead of a shrug. Postgres reports
 * lock and deadlock trouble as SQLSTATEs (40P01 deadlock, 55P03 lock not
 * available, 53300 too many connections) — those are exactly the codes worth
 * seeing after a room freezes.
 */
export async function timed<T>(
  op: Op,
  ctx: SampleContext,
  work: () => Promise<T>,
  classify?: (result: T) => { ok: boolean; code?: string }
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    const verdict = classify?.(result) ?? { ok: true };
    recordSample(op, { ms: Date.now() - started, ...verdict }, ctx);
    return result;
  } catch (err) {
    recordSample(
      op,
      { ms: Date.now() - started, ok: false, code: errorCode(err) },
      ctx
    );
    throw err;
  }
}

/** A short, non-identifying code for a thrown error. */
export function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "throw";
}

/** Live counters for this instance only. See the caveat above. */
export function snapshot(): Record<string, OpStats> {
  return metrics.snapshot();
}

export function resetMetrics(): void {
  metrics.reset();
}
