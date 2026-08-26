import { describe, expect, test } from "vitest";
import { planCanvasMatch } from "@/lib/matchplan";

const base = { personalCheckIns: 0, canvasCheckIns: 0, canvasHasProfile: false };

describe("planCanvasMatch", () => {
  test("keeps the Canvas row when neither side has attendance", () => {
    // It carries the name and photo, so it is the better row to survive.
    const p = planCanvasMatch(base);
    expect(p.allowed).toBe(true);
    if (!p.allowed) throw new Error("expected allowed");
    expect(p.keep).toBe("canvas");
  });

  test("keeps the student's own row when their attendance is on it", () => {
    // All six merged by hand were this case. Deleting their row to keep the
    // tidier Canvas one would have destroyed six students' check-ins.
    const p = planCanvasMatch({ ...base, personalCheckIns: 1 });
    expect(p.allowed).toBe(true);
    if (!p.allowed) throw new Error("expected allowed");
    expect(p.keep).toBe("personal");
  });

  test("keeps the Canvas row when the attendance is there instead", () => {
    const p = planCanvasMatch({ ...base, canvasCheckIns: 2 });
    expect(p.allowed).toBe(true);
    if (!p.allowed) throw new Error("expected allowed");
    expect(p.keep).toBe("canvas");
  });

  test("refuses when both rows hold attendance", () => {
    // Merging would have to discard one session's record or collide on
    // (session_id, enrollment_id). Neither is ours to decide silently.
    const p = planCanvasMatch({ ...base, personalCheckIns: 1, canvasCheckIns: 1 });
    expect(p.allowed).toBe(false);
    if (p.allowed) throw new Error("expected refusal");
    expect(p.reason).toMatch(/both/i);
  });

  test("refuses when the Canvas row already belongs to someone", () => {
    const p = planCanvasMatch({ ...base, canvasHasProfile: true });
    expect(p.allowed).toBe(false);
    if (p.allowed) throw new Error("expected refusal");
    expect(p.reason).toMatch(/account|belongs/i);
  });
});
