import { describe, expect, it } from "vitest";
import {
  defaultWeights,
  fitWeights,
  normalizeWeights,
  parseWeights,
  participationScore,
  weightsToRecord,
  type StudentComparison,
} from "@/lib/participation";
import {
  computeWorkReadiness,
  PARTICIPATION_ATTRIBUTES,
  type WorkReadinessInput,
} from "@/lib/employability";

const KEYS = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
];

describe("participation weights", () => {
  it("defaults to equal weights and normalizes arbitrary ones", () => {
    expect(defaultWeights(KEYS).map((w) => w.weight)).toEqual([0.5, 0.5]);
    const n = normalizeWeights([
      { key: "a", label: "A", weight: 3 },
      { key: "b", label: "B", weight: 1 },
    ]);
    expect(n[0].weight).toBeCloseTo(0.75);
  });

  it("scores as a weighted average, clamped 0-100", () => {
    const weights = [
      { key: "a", label: "A", weight: 0.75 },
      { key: "b", label: "B", weight: 0.25 },
    ];
    expect(participationScore({ a: 80, b: 40 }, weights)).toBeCloseTo(70);
    expect(participationScore({}, weights)).toBe(0);
  });

  it("round-trips through persistence", () => {
    const record = weightsToRecord([
      { key: "a", label: "A", weight: 2 },
      { key: "b", label: "B", weight: 2 },
    ]);
    const parsed = parseWeights(record, KEYS);
    expect(parsed[0].weight).toBeCloseTo(0.5);
    // Garbage input falls back to equal weights.
    expect(parseWeights("nope", KEYS)[0].weight).toBeCloseTo(0.5);
  });
});

describe("fitWeights (conjoint inference)", () => {
  it("falls back with too little signal", () => {
    const fallback = defaultWeights(KEYS);
    expect(fitWeights([], KEYS, fallback)).toEqual(normalizeWeights(fallback));
  });

  it("learns which attribute drives the professor's picks", () => {
    // Professor consistently prefers the student stronger on 'a',
    // even when 'b' argues the other way.
    const comparisons: StudentComparison[] = Array.from({ length: 8 }, (_, i) => ({
      left: { a: 30, b: 80 },
      right: { a: 90, b: 20 },
      verdict: i % 2 === 0 ? 2 : 1, // right (high-a) always better
    }));
    const fitted = fitWeights(comparisons, KEYS, defaultWeights(KEYS));
    const a = fitted.find((w) => w.key === "a")!;
    const b = fitted.find((w) => w.key === "b")!;
    expect(a.weight).toBeGreaterThan(b.weight);
    expect(a.weight + b.weight).toBeCloseTo(1);
  });

  it("is deterministic", () => {
    const comparisons: StudentComparison[] = [
      { left: { a: 10, b: 90 }, right: { a: 90, b: 10 }, verdict: 2 },
      { left: { a: 20, b: 70 }, right: { a: 80, b: 30 }, verdict: 1 },
      { left: { a: 80, b: 10 }, right: { a: 20, b: 90 }, verdict: -1 },
    ];
    expect(fitWeights(comparisons, KEYS, defaultWeights(KEYS))).toEqual(
      fitWeights(comparisons, KEYS, defaultWeights(KEYS))
    );
  });
});

describe("work-readiness v2 competencies", () => {
  const base: WorkReadinessInput = {
    sessionsHeld: 0,
    sessionsAttended: 0,
    verifiedAttendances: 0,
    newSeats: 0,
    peopleMet: 0,
    neighborsVerified: 0,
    exercisesJoined: 0,
    answered: 0,
    changedToCorrect: 0,
    teams: 0,
    contractsSigned: 0,
    leadRoles: 0,
    doneMinutes: 0,
    doneTasks: 0,
    biggestTaskMinutes: 0,
    distributedTasks: 0,
    selfAssignedTasks: 0,
    flaggedTasks: 0,
    avgShareOfTeam: 0,
  };

  it("emits all eight PARTICIPATION_ATTRIBUTES keys", () => {
    const w = computeWorkReadiness(base);
    expect(w.competencies.map((c) => c.key).sort()).toEqual(
      PARTICIPATION_ATTRIBUTES.map((a) => a.key).sort()
    );
  });

  it("focus follows the on-task rate", () => {
    const focused = computeWorkReadiness({
      ...base,
      lecturesFollowed: 4,
      onTaskRate: 0.92,
    }).competencies.find((c) => c.key === "focus")!;
    expect(focused.score).toBeCloseTo(92);
    expect(focused.level).toBe("standout");
    const none = computeWorkReadiness(base).competencies.find(
      (c) => c.key === "focus"
    )!;
    expect(none.score).toBe(0);
  });

  it("judgment rewards agreement, honesty, and a sharpened standard", () => {
    const sharp = computeWorkReadiness({
      ...base,
      assignmentsSubmitted: 2,
      tastesSharpened: 2,
      avgTasteAgreement: 90,
      avgSelfHonesty: 100,
      avgOwnBar: 8,
      rubricMinutes: 10,
    }).competencies.find((c) => c.key === "judgment")!;
    // 0.4*90 + 0.2*100 + 12*1 + 1.2*8 + 8 = 85.6
    expect(sharp.score).toBeCloseTo(85.6, 1);
    expect(sharp.level).toBe("standout");
    const lazy = computeWorkReadiness({
      ...base,
      assignmentsSubmitted: 2,
      tastesSharpened: 0,
    }).competencies.find((c) => c.key === "judgment")!;
    expect(lazy.score).toBeLessThan(25);
  });

  it("shout-outs lift initiative (given) and collaboration (received)", () => {
    const w = computeWorkReadiness({
      ...base,
      shoutOutsGiven: 4,
      shoutOutsReceived: 3,
    });
    expect(w.competencies.find((c) => c.key === "initiative")!.score).toBe(20);
    expect(w.competencies.find((c) => c.key === "collaboration")!.score).toBe(18);
    expect(w.hasSignal).toBe(true);
  });
});
