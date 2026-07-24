import { describe, expect, it } from "vitest";
import {
  effectiveAwayMs,
  formatAwayDuration,
  isLecturePaused,
  summarizeFocus,
  summarizeFocusByEnrollment,
} from "@/lib/focus";

const T0 = "2026-07-04T14:00:00.000Z";
const T1 = "2026-07-04T14:00:30.000Z"; // +30s
const T2 = "2026-07-04T14:05:00.000Z"; // +5m
const T3 = "2026-07-04T14:06:00.000Z"; // +6m

function ev(
  enrollment: string,
  type: "away" | "back",
  at: string
): { enrollment_id: string; event_type: "away" | "back"; occurred_at: string } {
  return { enrollment_id: enrollment, event_type: type, occurred_at: at };
}

describe("summarizeFocus", () => {
  it("returns zeros for no events", () => {
    expect(summarizeFocus([])).toEqual({
      awayCount: 0,
      awayMs: 0,
      isAway: false,
    });
  });

  it("pairs away/back spells and sums their duration", () => {
    const summary = summarizeFocus([
      ev("e1", "away", T0),
      ev("e1", "back", T1),
      ev("e1", "away", T2),
      ev("e1", "back", T3),
    ]);
    expect(summary.awayCount).toBe(2);
    expect(summary.awayMs).toBe(30_000 + 60_000);
    expect(summary.isAway).toBe(false);
  });

  it("counts an ongoing away spell up to now", () => {
    const now = new Date(T1);
    const summary = summarizeFocus([ev("e1", "away", T0)], now);
    expect(summary.awayCount).toBe(1);
    expect(summary.awayMs).toBe(30_000);
    expect(summary.isAway).toBe(true);
  });

  it("collapses duplicate away and back events", () => {
    const summary = summarizeFocus([
      ev("e1", "away", T0),
      ev("e1", "away", T1), // blur + visibilitychange double-fire
      ev("e1", "back", T2),
      ev("e1", "back", T3),
    ]);
    expect(summary.awayCount).toBe(1);
    expect(summary.awayMs).toBe(5 * 60_000);
  });

  it("sorts events that arrive out of order", () => {
    const summary = summarizeFocus([ev("e1", "back", T1), ev("e1", "away", T0)]);
    expect(summary.awayCount).toBe(1);
    expect(summary.awayMs).toBe(30_000);
    expect(summary.isAway).toBe(false);
  });
});

describe("summarizeFocusByEnrollment", () => {
  it("keeps students independent", () => {
    const now = new Date(T3);
    const map = summarizeFocusByEnrollment(
      [ev("e1", "away", T0), ev("e1", "back", T1), ev("e2", "away", T2)],
      now
    );
    expect(map.get("e1")).toEqual({
      awayCount: 1,
      awayMs: 30_000,
      isAway: false,
    });
    expect(map.get("e2")).toEqual({
      awayCount: 1,
      awayMs: 60_000,
      isAway: true,
    });
  });
});

describe("pause exclusion", () => {
  it("a spell fully inside a pause costs nothing", () => {
    const summary = summarizeFocus(
      [ev("e1", "away", T1), ev("e1", "back", T2)],
      new Date(T3),
      [{ start: T0, end: T3 }]
    );
    expect(summary).toEqual({ awayCount: 0, awayMs: 0, isAway: false });
  });

  it("subtracts only the overlapping part of a pause", () => {
    // Away T0→T2 (5m); paused T1→T2 — only the first 30s count.
    const summary = summarizeFocus(
      [ev("e1", "away", T0), ev("e1", "back", T2)],
      new Date(T3),
      [{ start: T1, end: T2 }]
    );
    expect(summary.awayCount).toBe(1);
    expect(summary.awayMs).toBe(30_000);
  });

  it("treats an open pause as running to now", () => {
    // Away T1→now(T3) entirely inside a pause opened at T0, never resumed.
    const summary = summarizeFocus([ev("e1", "away", T1)], new Date(T3), [
      { start: T0, end: null },
    ]);
    expect(summary.awayCount).toBe(0);
    expect(summary.awayMs).toBe(0);
    expect(summary.isAway).toBe(true);
  });

  it("without pauses behaves exactly as before", () => {
    const events = [ev("e1", "away", T0), ev("e1", "back", T1)];
    expect(summarizeFocus(events, new Date(T3), [])).toEqual(
      summarizeFocus(events, new Date(T3))
    );
  });

  it("effectiveAwayMs and isLecturePaused agree on an open pause", () => {
    const pauses = [{ start: T1, end: null }];
    expect(isLecturePaused(pauses)).toBe(true);
    expect(isLecturePaused([{ start: T0, end: T1 }])).toBe(false);
    // Away T0→T2 with pause open since T1 (now = T2): only T0→T1 counts.
    expect(
      effectiveAwayMs(Date.parse(T0), Date.parse(T2), pauses, Date.parse(T2))
    ).toBe(30_000);
  });
});

describe("formatAwayDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatAwayDuration(9_000)).toBe("9s");
    expect(formatAwayDuration(192_000)).toBe("3m 12s");
  });
});
