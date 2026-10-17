import { describe, expect, it } from "vitest";
import {
  cleanCriteria,
  proposedWeights,
  rubricSignature,
  staleSubmissions,
  weightPercents,
  weightedOverall,
} from "../rubric";

describe("cleanCriteria", () => {
  it("trims, keeps ids, and drops rows left entirely blank", () => {
    const result = cleanCriteria([
      { id: "t1", name: "  Evidence ", description: " Cited data ", weight: 40 },
      { name: "", description: "", weight: 10 },
      { name: "Clarity", description: "", weight: "30" },
    ]);
    expect(result).toEqual([
      { id: "t1", name: "Evidence", description: "Cited data", weight: 40 },
      { name: "Clarity", description: "", weight: 30 },
    ]);
  });

  it("refuses a description without a name", () => {
    expect(cleanCriteria([{ name: "", description: "orphan", weight: 1 }])).toBe(
      "Every criterion needs a name."
    );
  });

  it("refuses negative or missing weights", () => {
    expect(typeof cleanCriteria([{ name: "A", description: "", weight: -1 }])).toBe("string");
    expect(typeof cleanCriteria([{ name: "A", description: "", weight: "x" }])).toBe("string");
  });

  it("needs at least one criterion that counts", () => {
    expect(cleanCriteria([{ name: "A", description: "", weight: 0 }])).toMatch(/weight above 0/);
    expect(cleanCriteria([])).toBe("Add at least one criterion.");
  });

  it("refuses duplicate names regardless of case", () => {
    expect(
      cleanCriteria([
        { name: "Clarity", description: "", weight: 1 },
        { name: "clarity", description: "", weight: 1 },
      ])
    ).toMatch(/both called/);
  });
});

describe("weightPercents", () => {
  it("always sums to exactly 100", () => {
    const shares = weightPercents([1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
  });

  it("scales relative weights", () => {
    expect(weightPercents([2, 1, 1])).toEqual([50, 25, 25]);
  });

  it("all zero stays zero", () => {
    expect(weightPercents([0, 0])).toEqual([0, 0]);
  });
});

describe("weightedOverall", () => {
  const scores = [
    { themeId: "a", score: 10 },
    { themeId: "b", score: 4 },
  ];

  it("is the weighted mean", () => {
    expect(weightedOverall(scores, new Map([["a", 3], ["b", 1]]))).toBe(8.5);
  });

  it("equal weights are the plain mean", () => {
    expect(weightedOverall(scores, new Map([["a", 1], ["b", 1]]))).toBe(7);
  });

  it("ignores scores for criteria that no longer exist, and zero weights", () => {
    expect(weightedOverall(scores, new Map([["a", 0], ["b", 2]]))).toBe(4);
    expect(weightedOverall(scores, new Map([["b", 1]]))).toBe(4);
  });

  it("is null when nothing overlaps, so the caller falls back", () => {
    expect(weightedOverall(scores, new Map([["c", 1]]))).toBeNull();
    expect(weightedOverall([], new Map([["a", 1]]))).toBeNull();
  });
});

describe("rubricSignature", () => {
  const grid = [
    { name: "Evidence", description: "Cited data" },
    { name: "Clarity", description: "One pass" },
  ];

  it("ignores order (and weights never enter it)", () => {
    expect(rubricSignature(grid)).toBe(rubricSignature([...grid].reverse()));
  });

  it("changes when what the AI reads changes", () => {
    expect(rubricSignature(grid)).not.toBe(
      rubricSignature([grid[0], { name: "Clarity", description: "Two passes" }])
    );
    expect(rubricSignature(grid)).not.toBe(rubricSignature([grid[0]]));
  });
});

describe("proposedWeights", () => {
  it("keeps sane AI percentages", () => {
    expect(proposedWeights([40, 30, 30])).toEqual([40, 30, 30]);
  });

  it("falls back to equal shares if any is junk", () => {
    expect(proposedWeights([40, "lots", 30])).toEqual([34, 33, 33]);
  });
});

describe("staleSubmissions", () => {
  const current = ["c1", "c2", "c3"];
  it("finds rows read against an earlier rubric, or missing a criterion", () => {
    const scores = [
      { submission_id: "fresh", theme_scores: [{ themeId: "c1" }, { themeId: "c2" }, { themeId: "c3" }] },
      { submission_id: "old", theme_scores: [{ themeId: "x1" }, { themeId: "x2" }] },
      { submission_id: "partial", theme_scores: [{ themeId: "c1" }, { themeId: "c3" }] },
      { submission_id: "empty", theme_scores: null },
    ];
    expect(staleSubmissions(scores, current)).toEqual(["old", "partial", "empty"]);
  });

  it("is empty when there's no rubric to be stale against", () => {
    expect(staleSubmissions([{ submission_id: "a", theme_scores: [] }], [])).toEqual([]);
  });
});
