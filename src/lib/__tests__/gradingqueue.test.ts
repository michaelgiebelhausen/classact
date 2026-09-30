import { describe, expect, it } from "vitest";
import {
  MAX_SCORE_ATTEMPTS,
  classifyUnscored,
  recordFailure,
  slotIntoOrder,
  type ScoreFailure,
} from "@/lib/gradingqueue";

const NOW = new Date("2026-09-30T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("classifyUnscored", () => {
  it("queues every unscored submission that has never failed", () => {
    const q = classifyUnscored({
      submissionIds: ["a", "b", "c"],
      scoredIds: new Set(["b"]),
      failures: {},
      now: NOW,
    });
    expect(q).toEqual({ ready: ["a", "c"], waiting: [], givenUp: [] });
  });

  it("holds a recent failure back instead of retrying it immediately", () => {
    const failures: Record<string, ScoreFailure> = {
      a: { attempts: 1, error: "AI call failed (400)", lastAt: minutesAgo(1) },
    };
    const q = classifyUnscored({
      submissionIds: ["a", "b"],
      scoredIds: new Set(),
      failures,
      now: NOW,
    });
    expect(q.ready).toEqual(["b"]);
    expect(q.waiting).toEqual(["a"]);
  });

  it("retries a failure once its backoff has passed", () => {
    const failures: Record<string, ScoreFailure> = {
      a: { attempts: 1, error: "timeout", lastAt: minutesAgo(30) },
    };
    const q = classifyUnscored({
      submissionIds: ["a"],
      scoredIds: new Set(),
      failures,
      now: NOW,
    });
    expect(q.ready).toEqual(["a"]);
  });

  // The NB02 case: one unreadable file must not hold the whole class hostage.
  it("gives up on a submission after the last attempt, so the class moves on", () => {
    const failures: Record<string, ScoreFailure> = {
      a: { attempts: MAX_SCORE_ATTEMPTS, error: "too big", lastAt: minutesAgo(600) },
    };
    const q = classifyUnscored({
      submissionIds: ["a", "b"],
      scoredIds: new Set(["b"]),
      failures,
      now: NOW,
    });
    expect(q).toEqual({ ready: [], waiting: [], givenUp: ["a"] });
  });

  it("ignores failure records for submissions that have since been scored", () => {
    const failures: Record<string, ScoreFailure> = {
      a: { attempts: MAX_SCORE_ATTEMPTS, error: "old", lastAt: minutesAgo(600) },
    };
    const q = classifyUnscored({
      submissionIds: ["a"],
      scoredIds: new Set(["a"]),
      failures,
      now: NOW,
    });
    expect(q).toEqual({ ready: [], waiting: [], givenUp: [] });
  });
});

describe("recordFailure", () => {
  it("counts attempts up and keeps the latest reason", () => {
    const first = recordFailure(undefined, "timeout", NOW);
    expect(first).toEqual({ attempts: 1, error: "timeout", lastAt: NOW.toISOString() });
    const second = recordFailure(first, "AI call failed (400)", NOW);
    expect(second.attempts).toBe(2);
    expect(second.error).toBe("AI call failed (400)");
  });
});

describe("slotIntoOrder", () => {
  const row = (id: string, score: number, finalRank: number | null) => ({
    submission_id: id,
    bt_score: score,
    rank: 0,
    final_rank: finalRank,
  });

  it("leaves an unmaterialized list alone (the model still owns it)", () => {
    const rows = [row("a", 50, null), row("b", 80, null)];
    expect(slotIntoOrder(rows)).toBeNull();
  });

  it("returns the professor's order untouched when nothing is new", () => {
    const rows = [row("a", 90, 2), row("b", 40, 1)];
    expect(slotIntoOrder(rows)?.map((r) => r.submission_id)).toEqual(["b", "a"]);
  });

  it("slots a late arrival at the position its score earns, around the drags", () => {
    // The professor dragged b (40) above a (90). One placed row outscores the
    // late one (60), so it takes position 2 — the drags stay where they are.
    const rows = [row("b", 40, 1), row("a", 90, 2), row("c", 30, 3), row("late", 60, null)];
    expect(slotIntoOrder(rows)?.map((r) => r.submission_id)).toEqual([
      "b",
      "late",
      "a",
      "c",
    ]);
  });

  it("puts a late arrival that beats nobody at the bottom", () => {
    const rows = [row("a", 90, 1), row("b", 70, 2), row("late", 10, null)];
    expect(slotIntoOrder(rows)?.map((r) => r.submission_id)).toEqual(["a", "b", "late"]);
  });

  it("slots several late arrivals best-first without reordering placed rows", () => {
    const rows = [
      row("a", 90, 1),
      row("b", 50, 2),
      row("c", 20, 3),
      row("x", 60, null),
      row("y", 30, null),
    ];
    expect(slotIntoOrder(rows)?.map((r) => r.submission_id)).toEqual([
      "a",
      "x",
      "b",
      "y",
      "c",
    ]);
  });
});
