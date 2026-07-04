import { describe, expect, it } from "vitest";
import {
  formatAwayDuration,
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

describe("formatAwayDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatAwayDuration(9_000)).toBe("9s");
    expect(formatAwayDuration(192_000)).toBe("3m 12s");
  });
});
