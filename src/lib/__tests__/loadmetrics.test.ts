import { describe, expect, test } from "vitest";
import {
  LoadMetrics,
  percentile,
  CAPACITY,
} from "@/lib/loadmetrics";

describe("percentile", () => {
  test("returns the value at the requested rank of a sorted list", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 90)).toBe(90);
    expect(percentile(sorted, 99)).toBe(100);
  });

  test("returns null for an empty list rather than NaN", () => {
    expect(percentile([], 95)).toBeNull();
  });

  test("returns the only value when the list has one entry", () => {
    expect(percentile([42], 99)).toBe(42);
  });
});

describe("LoadMetrics", () => {
  test("reports count and latency percentiles for one operation", () => {
    const m = new LoadMetrics();
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      m.record("checkin", { ms, ok: true });
    }

    const snap = m.snapshot();

    expect(snap.checkin.count).toBe(10);
    expect(snap.checkin.p50).toBe(50);
    expect(snap.checkin.p95).toBe(100);
    expect(snap.checkin.p99).toBe(100);
  });

  test("keeps operations separate", () => {
    const m = new LoadMetrics();
    m.record("checkin", { ms: 10, ok: true });
    m.record("checkin_page", { ms: 500, ok: true });

    const snap = m.snapshot();

    expect(snap.checkin.count).toBe(1);
    expect(snap.checkin_page.count).toBe(1);
    expect(snap.checkin_page.p50).toBe(500);
  });

  test("computes an error rate from failed samples", () => {
    const m = new LoadMetrics();
    m.record("checkin", { ms: 10, ok: true });
    m.record("checkin", { ms: 10, ok: true });
    m.record("checkin", { ms: 10, ok: false, code: "seat_taken" });
    m.record("checkin", { ms: 10, ok: false, code: "seat_taken" });

    expect(m.snapshot().checkin.errorRate).toBe(0.5);
  });

  test("counts contention codes so seat races are visible after class", () => {
    const m = new LoadMetrics();
    m.record("checkin", { ms: 10, ok: false, code: "seat_taken" });
    m.record("checkin", { ms: 10, ok: false, code: "seat_taken" });
    m.record("checkin", { ms: 10, ok: false, code: "40P01" });

    expect(m.snapshot().checkin.codes).toEqual({ seat_taken: 2, "40P01": 1 });
  });

  test("reports the observed request rate per second across the sample window", () => {
    const m = new LoadMetrics();
    // Ten requests spread across two seconds -> 5/sec.
    for (let i = 0; i < 10; i++) {
      m.record("checkin", { ms: 1, ok: true, at: 1_000 + i * 200 });
    }

    expect(m.snapshot().checkin.ratePerSec).toBeCloseTo(5, 1);
  });

  test("rate is null when a single sample gives no window to measure across", () => {
    const m = new LoadMetrics();
    m.record("checkin", { ms: 1, ok: true, at: 1_000 });

    expect(m.snapshot().checkin.ratePerSec).toBeNull();
  });

  test("drops the oldest samples past capacity so a long class cannot grow memory without bound", () => {
    const m = new LoadMetrics();
    for (let i = 0; i < CAPACITY + 50; i++) {
      m.record("checkin", { ms: i, ok: true });
    }

    const snap = m.snapshot();

    expect(snap.checkin.count).toBe(CAPACITY);
    // The first 50 samples (ms 0..49) are gone, so the floor has moved up.
    expect(snap.checkin.min).toBe(50);
  });

  test("counts every sample ever seen, not just the retained window", () => {
    const m = new LoadMetrics();
    for (let i = 0; i < CAPACITY + 50; i++) {
      m.record("checkin", { ms: 1, ok: true });
    }

    expect(m.snapshot().checkin.totalSeen).toBe(CAPACITY + 50);
  });

  test("snapshot of an untouched operation is absent rather than a zero row", () => {
    const m = new LoadMetrics();
    expect(m.snapshot().checkin).toBeUndefined();
  });

  test("reset clears everything", () => {
    const m = new LoadMetrics();
    m.record("checkin", { ms: 10, ok: true });
    m.reset();
    expect(m.snapshot()).toEqual({});
  });
});
