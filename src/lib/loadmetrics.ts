/**
 * In-process latency/error/contention counters for the check-in path.
 *
 * Exists to answer one question after a class ends: when the room froze, what
 * was actually slow — and was anything contending? Guessing at that from a
 * dictated "it kind of froze up" is how you fix the wrong thing.
 *
 * Deliberately dependency-free and synchronous. Recording must never be the
 * thing that slows down the request it is measuring.
 *
 * Scope limit, stated because it changes how you read the numbers: this is
 * per-process memory. On a serverless deployment a burst spreads across
 * several instances, so a snapshot describes ONE instance, not the room. The
 * durable, room-wide record is the structured log line each sample also emits
 * (see `logSample`), which survives the instance and can be aggregated after
 * the fact. Treat `snapshot()` as a live peek and the logs as the evidence.
 */

/** Retained samples per operation. Bounds memory across a long class. */
export const CAPACITY = 2000;

export interface Sample {
  ms: number;
  ok: boolean;
  /** Failure reason, or a Postgres SQLSTATE for contention (40P01, 55P03…). */
  code?: string;
  /** Defaults to now; injectable so the aggregation is testable. */
  at?: number;
}

export interface OpStats {
  count: number;
  /** Every sample ever recorded, including ones aged out of the window. */
  totalSeen: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  errorRate: number;
  codes: Record<string, number>;
  /** Observed arrival rate across the retained window; null if unmeasurable. */
  ratePerSec: number | null;
  firstAt: number;
  lastAt: number;
}

/** Nearest-rank percentile. `sorted` must already be ascending. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

interface Entry {
  ms: number;
  ok: boolean;
  code?: string;
  at: number;
}

export class LoadMetrics {
  private samples = new Map<string, Entry[]>();
  private seen = new Map<string, number>();
  private capacity: number;

  /**
   * `capacity` is bounded for the live in-process recorder. Offline
   * aggregation over an exported log passes Infinity — silently truncating a
   * class's evidence to the newest 2000 lines would understate exactly the
   * burst we are trying to see.
   */
  constructor(capacity: number = CAPACITY) {
    this.capacity = capacity;
  }

  record(op: string, sample: Sample): void {
    const entry: Entry = {
      ms: sample.ms,
      ok: sample.ok,
      code: sample.code,
      at: sample.at ?? Date.now(),
    };

    const list = this.samples.get(op) ?? [];
    list.push(entry);
    if (list.length > this.capacity) {
      list.splice(0, list.length - this.capacity);
    }
    this.samples.set(op, list);

    this.seen.set(op, (this.seen.get(op) ?? 0) + 1);
  }

  snapshot(): Record<string, OpStats> {
    const out: Record<string, OpStats> = {};
    for (const [op, list] of this.samples) {
      if (list.length === 0) continue;

      const latencies = list.map((e) => e.ms).sort((a, b) => a - b);
      const failures = list.filter((e) => !e.ok).length;

      const codes: Record<string, number> = {};
      for (const e of list) {
        if (e.code) codes[e.code] = (codes[e.code] ?? 0) + 1;
      }

      // Looped rather than spread into Math.min: offline aggregation runs
      // unbounded, and spreading a six-figure array overflows the stack.
      let firstAt = list[0].at;
      let lastAt = list[0].at;
      for (const e of list) {
        if (e.at < firstAt) firstAt = e.at;
        if (e.at > lastAt) lastAt = e.at;
      }
      const spanSec = (lastAt - firstAt) / 1000;
      // Intervals, not events, over the span — otherwise a single sample
      // reads as an infinite rate.
      const ratePerSec =
        list.length > 1 && spanSec > 0 ? (list.length - 1) / spanSec : null;

      out[op] = {
        count: list.length,
        totalSeen: this.seen.get(op) ?? list.length,
        min: latencies[0],
        max: latencies[latencies.length - 1],
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        errorRate: failures / list.length,
        codes,
        ratePerSec,
        firstAt,
        lastAt,
      };
    }
    return out;
  }

  reset(): void {
    this.samples.clear();
    this.seen.clear();
  }
}

/**
 * Prefix on every emitted sample line. Chosen to match the existing
 * `[directory]` convention so one grep pulls the whole check-in story out of a
 * platform log export.
 */
export const LOG_TAG = "[loadmetrics] ";

export interface SampleContext {
  courseId?: string;
  sessionId?: string;
}

/**
 * One sample as a single JSON line.
 *
 * Course and session are included because a freeze report is always about one
 * class meeting and the logs hold all of them. Nothing identifying a person is
 * included — no user id, no enrollment id, no seat. Latency and contention are
 * answerable without knowing who was sitting where, and this line lands in a
 * platform log with a far longer retention and a far wider audience than the
 * database it describes.
 */
export function formatSampleLine(
  op: string,
  sample: Sample,
  ctx: SampleContext = {}
): string {
  const payload: Record<string, unknown> = {
    op,
    ms: sample.ms,
    ok: sample.ok,
    at: sample.at ?? Date.now(),
  };
  if (sample.code) payload.code = sample.code;
  if (ctx.courseId) payload.courseId = ctx.courseId;
  if (ctx.sessionId) payload.sessionId = ctx.sessionId;
  return LOG_TAG + JSON.stringify(payload);
}

export interface ParsedSample extends Sample {
  op: string;
  at: number;
  courseId?: string;
  sessionId?: string;
}

/**
 * Pull sample lines out of raw log output.
 *
 * Platform exports wrap each line in their own timestamp and request id, so
 * the tag is searched for anywhere in the line rather than anchored at the
 * start. A malformed or truncated line is skipped: a partial export should
 * still yield the samples it did capture.
 */
export function parseLogLines(lines: string[]): ParsedSample[] {
  const out: ParsedSample[] = [];
  for (const line of lines) {
    const start = line.indexOf(LOG_TAG);
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(line.slice(start + LOG_TAG.length));
      if (typeof parsed?.op === "string" && typeof parsed?.ms === "number") {
        out.push(parsed as ParsedSample);
      }
    } catch {
      // Truncated line — skip it rather than lose the rest of the export.
    }
  }
  return out;
}

/**
 * Rebuild per-operation stats from an exported log. This is the path that
 * satisfies "inspect after the class ends": the in-process recorder is gone
 * with its instance, but these lines are not.
 */
export function aggregateLines(
  lines: string[],
  filter: SampleContext = {}
): Record<string, OpStats> {
  const metrics = new LoadMetrics(Infinity);
  for (const s of parseLogLines(lines)) {
    if (filter.courseId && s.courseId !== filter.courseId) continue;
    if (filter.sessionId && s.sessionId !== filter.sessionId) continue;
    metrics.record(s.op, { ms: s.ms, ok: s.ok, code: s.code, at: s.at });
  }
  return metrics.snapshot();
}
