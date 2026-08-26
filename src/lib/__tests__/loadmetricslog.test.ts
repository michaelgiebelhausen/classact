import { describe, expect, test } from "vitest";
import {
  formatSampleLine,
  parseLogLines,
  aggregateLines,
  LOG_TAG,
  CAPACITY,
} from "@/lib/loadmetrics";

describe("formatSampleLine", () => {
  test("emits a tagged single-line JSON payload", () => {
    const line = formatSampleLine("checkin", {
      ms: 42,
      ok: true,
      at: 1_700_000_000_000,
    });

    expect(line.startsWith(LOG_TAG)).toBe(true);
    expect(line).not.toContain("\n");

    const payload = JSON.parse(line.slice(LOG_TAG.length));
    expect(payload).toMatchObject({ op: "checkin", ms: 42, ok: true });
  });

  test("carries the course and session so a class can be isolated afterwards", () => {
    const line = formatSampleLine(
      "checkin",
      { ms: 5, ok: false, code: "seat_taken", at: 1 },
      { courseId: "c-1", sessionId: "s-9" }
    );

    const payload = JSON.parse(line.slice(LOG_TAG.length));
    expect(payload.courseId).toBe("c-1");
    expect(payload.sessionId).toBe("s-9");
    expect(payload.code).toBe("seat_taken");
  });

  test("never carries a user or enrollment identifier", () => {
    const line = formatSampleLine(
      "checkin",
      { ms: 5, ok: true, at: 1 },
      { courseId: "c-1", sessionId: "s-9" }
    );

    const payload = JSON.parse(line.slice(LOG_TAG.length));
    expect(Object.keys(payload).sort()).toEqual(
      ["at", "courseId", "ms", "ok", "op", "sessionId"].sort()
    );
  });
});

describe("parseLogLines", () => {
  test("picks out tagged lines and ignores everything else", () => {
    const lines = [
      "some unrelated server noise",
      '[directory] {"courseId":"c-1","source":"cache"}',
      formatSampleLine("checkin", { ms: 10, ok: true, at: 1 }),
      formatSampleLine("checkin_page", { ms: 20, ok: true, at: 2 }),
    ];

    const parsed = parseLogLines(lines);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.op)).toEqual(["checkin", "checkin_page"]);
  });

  test("tolerates a truncated or malformed tagged line rather than throwing", () => {
    const lines = [
      `${LOG_TAG}{"op":"checkin","ms":1`,
      formatSampleLine("checkin", { ms: 10, ok: true, at: 1 }),
    ];

    expect(parseLogLines(lines)).toHaveLength(1);
  });

  test("survives a log line with a timestamp prefix from the platform", () => {
    const inner = formatSampleLine("checkin", { ms: 10, ok: true, at: 1 });
    const lines = [`2026-08-25T19:25:01.123Z  ${inner}`];

    expect(parseLogLines(lines)).toHaveLength(1);
  });
});

describe("aggregateLines", () => {
  test("produces per-operation stats from raw log output", () => {
    const lines = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms, i) =>
      formatSampleLine("checkin", { ms, ok: true, at: 1_000 + i })
    );

    const stats = aggregateLines(lines);

    expect(stats.checkin.count).toBe(10);
    expect(stats.checkin.p50).toBe(50);
  });

  test("does not truncate a full class worth of lines the way the live buffer does", () => {
    const lines = Array.from({ length: CAPACITY + 500 }, (_, i) =>
      formatSampleLine("checkin", { ms: 1, ok: true, at: 1_000 + i })
    );

    expect(aggregateLines(lines).checkin.count).toBe(CAPACITY + 500);
  });

  test("separates two courses so one class can be read on its own", () => {
    const lines = [
      formatSampleLine("checkin", { ms: 10, ok: true, at: 1 }, { courseId: "a" }),
      formatSampleLine("checkin", { ms: 90, ok: true, at: 2 }, { courseId: "b" }),
    ];

    const stats = aggregateLines(lines, { courseId: "b" });

    expect(stats.checkin.count).toBe(1);
    expect(stats.checkin.p50).toBe(90);
  });
});
