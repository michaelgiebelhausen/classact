import { describe, expect, it } from "vitest";
import {
  applyLocalMove,
  assignBands,
  bandsProblem,
  computeScores,
  cutScoresFromDividers,
  displayPoints,
  dividersFromThresholds,
  normalizeDividers,
  persistPoints,
  type Band,
} from "@/lib/bands";
import {
  DEFAULT_SETTINGS,
  bandsFromCutPoints,
  defaultBands,
  readBands,
  readDividers,
  resolveGradingAxes,
  resolveSettings,
} from "@/lib/tastegrading";
import {
  cleanTasteBody,
  draftBody,
  isUntouchedTaste,
  tasteProse,
} from "@/lib/tasteprose";

const order = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const band = (label: string | null, value: number | null): Band => ({
  label,
  value,
});

// ---------------------------------------------------------------------------
// Band membership
// ---------------------------------------------------------------------------

describe("assignBands", () => {
  it("puts the rows above a line in the higher band", () => {
    // 6 rows, one line after row 3 → rows 0–2 top, rows 3–5 bottom.
    expect(assignBands(6, [3], 2)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("allows an empty band when two lines coincide", () => {
    // Nobody earned the top band.
    expect(assignBands(4, [0, 2], 3)).toEqual([1, 1, 2, 2]);
  });

  it("keeps everyone in one band when there are no lines", () => {
    expect(assignBands(3, [], 1)).toEqual([0, 0, 0]);
  });
});

describe("normalizeDividers", () => {
  it("clamps into the list and never lets lines cross", () => {
    expect(normalizeDividers([5, 2, 99], 10, 4)).toEqual([5, 5, 10]);
  });

  it("pads missing lines to the bottom", () => {
    expect(normalizeDividers([2], 8, 3)).toEqual([2, 8]);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("computeScores — stepped", () => {
  const bands = [band("A", 5), band("B", 4), band("C", 3)];

  it("gives every row in a band the same value — no fractions", () => {
    const scores = computeScores({
      order: order(6),
      bands,
      dividers: [2, 4],
      scoreMode: "stepped",
      points: 5,
    });
    expect(scores.map((s) => s.points)).toEqual([5, 5, 4, 4, 3, 3]);
    expect(scores.map((s) => s.label)).toEqual(["A", "A", "B", "B", "C", "C"]);
  });

  it("leaves a label-only band without points", () => {
    const scores = computeScores({
      order: order(2),
      bands: [band("Pass", null)],
      dividers: [],
      scoreMode: "stepped",
      points: 100,
    });
    expect(scores.map((s) => s.points)).toEqual([null, null]);
    expect(scores[0].label).toBe("Pass");
  });

  it("allows two bands to be worth the same", () => {
    const scores = computeScores({
      order: order(4),
      bands: [band("Strong", 4), band("Also strong", 4)],
      dividers: [2],
      scoreMode: "stepped",
      points: 5,
    });
    expect(scores.map((s) => s.points)).toEqual([4, 4, 4, 4]);
  });
});

describe("computeScores — linear", () => {
  it("runs the top band from its value up to full marks", () => {
    // One cut at 80 on a 100-point assignment, 5 rows above it.
    const scores = computeScores({
      order: order(5),
      bands: [band("A", 80)],
      dividers: [],
      scoreMode: "linear",
      points: 100,
    });
    // Bottom row earns the band's value, rank 1 earns the maximum.
    expect(scores.map((s) => s.points)).toEqual([100, 95, 90, 85, 80]);
  });

  it("stops a lower band short of the band above, so no row ties across a line", () => {
    const scores = computeScores({
      order: order(6),
      bands: [band("A", 90), band("B", 80)],
      dividers: [2],
      scoreMode: "linear",
      points: 100,
    });
    const points = scores.map((s) => s.points!);
    // Top band: 90 → 100 inclusive.
    expect(points.slice(0, 2)).toEqual([100, 90]);
    // Lower band climbs toward 90 but never reaches it.
    expect(points[2]).toBeLessThan(90);
    expect(points[5]).toBe(80);
    // Strictly descending overall.
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThan(points[i - 1]);
    }
  });

  it("awards full marks to a lone top row and the band value to a lone lower row", () => {
    const scores = computeScores({
      order: order(3),
      bands: [band("A", 90), band("B", 70)],
      dividers: [1],
      scoreMode: "linear",
      points: 100,
    });
    expect(scores[0].points).toBe(100);
    expect(scores[2].points).toBe(70);
  });

  it("holds a band flat when it meets its ceiling", () => {
    const scores = computeScores({
      order: order(4),
      bands: [band("A", 90), band("B", 90)],
      dividers: [1],
      scoreMode: "linear",
      points: 90,
    });
    expect(scores.map((s) => s.points)).toEqual([90, 90, 90, 90]);
  });

  it("returns no points rather than nonsense when an end is missing", () => {
    const scores = computeScores({
      order: order(3),
      bands: [band("A", null)],
      dividers: [],
      scoreMode: "linear",
      points: null,
    });
    expect(scores.map((s) => s.points)).toEqual([null, null, null]);
  });

  it("skips an empty band without disturbing the rows around it", () => {
    const scores = computeScores({
      order: order(4),
      bands: [band("A", 5), band("B", 4), band("C", 3)],
      dividers: [0, 0], // nobody in A or B
      scoreMode: "stepped",
      points: 5,
    });
    expect(scores.map((s) => s.bandIndex)).toEqual([2, 2, 2, 2]);
    expect(scores.map((s) => s.points)).toEqual([3, 3, 3, 3]);
  });
});

describe("rounding", () => {
  it("persists two decimals and displays one", () => {
    expect(persistPoints(3.14159)).toBe(3.14);
    expect(persistPoints(null)).toBeNull();
    expect(displayPoints(87.55)).toBe("87.6");
    expect(displayPoints(90)).toBe("90");
    expect(displayPoints(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Professor moves
// ---------------------------------------------------------------------------

describe("applyLocalMove", () => {
  it("does nothing when the order already agrees", () => {
    expect(applyLocalMove(["a", "b", "c"], "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("drops the loser directly below the winner", () => {
    expect(applyLocalMove(["a", "b", "c", "d"], "c", "a")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("swaps an adjacent upset", () => {
    expect(applyLocalMove(["a", "b"], "b", "a")).toEqual(["b", "a"]);
  });

  it("ignores ids it does not know", () => {
    expect(applyLocalMove(["a", "b"], "zz", "a")).toEqual(["a", "b"]);
    expect(applyLocalMove(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Legacy thresholds → lines
// ---------------------------------------------------------------------------

describe("dividersFromThresholds", () => {
  it("places lines where the old letters fell on this class's scores", () => {
    const scores = [95, 88, 82, 71, 64, 55, 40, 12];
    // A80 / B60 / C40 / D20 / F0 → four lines, the F floor is not a line.
    // The last two coincide: nobody scored between 20 and 40, so D is empty.
    const lines = dividersFromThresholds(scores, [80, 60, 40, 20, 0]);
    expect(lines).toEqual([3, 5, 7, 7]);
  });

  it("counts a score sitting exactly on a threshold into the higher band", () => {
    expect(dividersFromThresholds([80, 79], [80, 0])).toEqual([1]);
  });

  it("must be trimmed to the bands that actually exist", () => {
    // Caught in the first live dry run: an assignment carrying three bands
    // but no saved lines derived them from the resolved cut points, which
    // fall back to the five-letter default — four lines for three bands, so
    // the cockpit refused to publish. Deriving is not enough; the count has
    // to be reconciled with the bands at every call site.
    const scores = [95, 88, 82, 71, 64, 55, 40, 12];
    const derived = dividersFromThresholds(scores, [80, 60, 40, 20, 0]);
    expect(derived).toHaveLength(4);
    expect(normalizeDividers(derived, scores.length, 3)).toHaveLength(2);
  });
});

describe("cutScoresFromDividers", () => {
  it("puts a marker midway between the rows a line separates", () => {
    expect(cutScoresFromDividers([90, 80, 70], [1])).toEqual([85]);
  });

  it("pins markers to the ends when a band is empty", () => {
    expect(cutScoresFromDividers([90, 80], [0, 2])).toEqual([90, 80]);
  });
});

// ---------------------------------------------------------------------------
// The publish rules
// ---------------------------------------------------------------------------

describe("bandsProblem", () => {
  const ok = {
    bands: [band("A", 90), band("B", 80)],
    dividers: [3],
    scoreMode: "linear" as const,
    points: 100,
    rowCount: 10,
  };

  it("passes a well-formed linear setup", () => {
    expect(bandsProblem(ok)).toBeNull();
  });

  it("refuses a linear scale with no point value or a missing band value", () => {
    expect(bandsProblem({ ...ok, points: null })).toMatch(/point value/i);
    expect(
      bandsProblem({ ...ok, bands: [band("A", 90), band("B", null)] })
    ).toMatch(/every band/i);
  });

  it("refuses values that climb downward or overflow the assignment", () => {
    expect(
      bandsProblem({ ...ok, bands: [band("A", 70), band("B", 80)] })
    ).toMatch(/fall from top to bottom/i);
    expect(
      bandsProblem({ ...ok, bands: [band("A", 120), band("B", 80)] })
    ).toMatch(/cannot be worth more/i);
  });

  it("lets stepped grading keep ties and unvalued bands", () => {
    expect(
      bandsProblem({
        ...ok,
        scoreMode: "stepped",
        points: null,
        bands: [band("Pass", null), band("Fail", null)],
      })
    ).toBeNull();
  });

  it("catches lines outside the list or out of order", () => {
    expect(bandsProblem({ ...ok, dividers: [99] })).toMatch(/outside the list/i);
    expect(
      bandsProblem({
        ...ok,
        bands: [band("A", 90), band("B", 85), band("C", 80)],
        dividers: [5, 2],
      })
    ).toMatch(/stay in order/i);
  });
});

// ---------------------------------------------------------------------------
// Settings layering
// ---------------------------------------------------------------------------

describe("band settings", () => {
  it("defaults to A+/A/B/C with blank values (no point total known yet)", () => {
    expect(DEFAULT_SETTINGS.bands.map((b) => b.label)).toEqual([
      "A+",
      "A",
      "B",
      "C",
    ]);
    expect(DEFAULT_SETTINGS.bands.every((b) => b.value === null)).toBe(true);
    expect(DEFAULT_SETTINGS.scoreMode).toBe("stepped");
    expect(DEFAULT_SETTINGS.scoreVisibility).toBe("both");
    expect(DEFAULT_SETTINGS.tasteRequirement).toBe("optional");
  });

  it("pre-fills default band worths as a share of the point total", () => {
    // A+ 110%, A 100%, B 89.9%, C 79.9% of the assignment's points.
    expect(defaultBands(10)).toEqual([
      { label: "A+", value: 11 },
      { label: "A", value: 10 },
      { label: "B", value: 8.99 },
      { label: "C", value: 7.99 },
    ]);
    expect(defaultBands(100)).toEqual([
      { label: "A+", value: 110 },
      { label: "A", value: 100 },
      { label: "B", value: 89.9 },
      { label: "C", value: 79.9 },
    ]);
    // No point value → Worth stays blank (a percentage of nothing is nothing).
    expect(defaultBands(null).every((b) => b.value === null)).toBe(true);
  });

  it("reads a layer's own bands, or null when it sets none", () => {
    expect(readBands({ bands: [{ label: "Pass", value: 1 }] })).toEqual([
      { label: "Pass", value: 1 },
    ]);
    expect(readBands({})).toBeNull();
    expect(readBands(null)).toBeNull();
  });

  it("reads an assignment's own bands", () => {
    const s = resolveSettings(null, {
      bands: [
        { label: "Excellent", value: 5 },
        { label: null, value: 4 },
      ],
      scoreMode: "linear",
    });
    expect(s.bands).toEqual([
      { label: "Excellent", value: 5 },
      { label: null, value: 4 },
    ]);
    expect(s.scoreMode).toBe("linear");
  });

  it("converts a legacy layer's cut points into labelled bands", () => {
    const s = resolveSettings(null, {
      cutPoints: [
        { letter: "B", min: 55 },
        { letter: "A", min: 82 },
      ],
    });
    expect(s.bands).toEqual([
      { label: "A", value: null },
      { label: "B", value: null },
    ]);
  });

  it("lets a course template carry bands that the assignment overrides", () => {
    const course = { bands: [{ label: "Pass", value: 1 }] };
    expect(resolveSettings(course, null).bands).toEqual([
      { label: "Pass", value: 1 },
    ]);
    expect(
      resolveSettings(course, { bands: [{ label: "Mastery", value: 4 }] }).bands
    ).toEqual([{ label: "Mastery", value: 4 }]);
  });

  it("falls back to the default on a garbage knob", () => {
    const s = resolveSettings(null, {
      scoreMode: "sideways",
      scoreVisibility: 7,
      tasteRequirement: null,
    });
    expect(s.scoreMode).toBe("stepped");
    expect(s.scoreVisibility).toBe("both");
    expect(s.tasteRequirement).toBe("optional");
  });

  it("reads divider positions only off the assignment", () => {
    expect(readDividers({ dividers: [2, 5] })).toEqual([2, 5]);
    expect(readDividers({ dividers: [] })).toEqual([]);
    expect(readDividers({})).toBeNull();
    expect(readDividers(null)).toBeNull();
  });
});

describe("resolveGradingAxes", () => {
  it("maps legacy ai_only to instructor taste + no peer, ungated", () => {
    expect(resolveGradingAxes({ gradingMode: "ai_only" })).toEqual({
      tasteSource: "instructor",
      peerReview: false,
      gated: false,
    });
  });

  it("maps a legacy row with no flag to co-created + peer, ungated", () => {
    // Absent gradingMode = today's tasty. Co-created for the pipeline, but
    // NEVER gated — an in-flight assignment must not start locking mid-life.
    for (const s of [{}, null, { gradingMode: "tasty" }]) {
      expect(resolveGradingAxes(s)).toEqual({
        tasteSource: "cocreated",
        peerReview: true,
        gated: false,
      });
    }
  });

  it("reads explicit new-style keys, gating only explicit co-created", () => {
    expect(
      resolveGradingAxes({ peerReview: false, tasteSource: "cocreated" })
    ).toEqual({ tasteSource: "cocreated", peerReview: false, gated: true });
    expect(
      resolveGradingAxes({ peerReview: false, tasteSource: "instructor" })
    ).toEqual({ tasteSource: "instructor", peerReview: false, gated: false });
  });

  it("lets new-style keys win over a stale legacy gradingMode", () => {
    expect(
      resolveGradingAxes({
        gradingMode: "ai_only",
        peerReview: false,
        tasteSource: "cocreated",
      })
    ).toEqual({ tasteSource: "cocreated", peerReview: false, gated: true });
  });

  it("resolves partial new-style keys per key, never inferring a gate", () => {
    // peerReview present, tasteSource absent → source falls back to legacy;
    // gate stays false because co-created was not explicitly stored.
    expect(resolveGradingAxes({ peerReview: false })).toEqual({
      tasteSource: "cocreated",
      peerReview: false,
      gated: false,
    });
    expect(
      resolveGradingAxes({ gradingMode: "ai_only", peerReview: true })
    ).toEqual({ tasteSource: "instructor", peerReview: true, gated: false });
  });

  it("sorts converted bands best-first regardless of input order", () => {
    expect(
      bandsFromCutPoints([
        { letter: "C", min: 40 },
        { letter: "A", min: 80 },
      ]).map((b) => b.label)
    ).toEqual(["A", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Taste prose
// ---------------------------------------------------------------------------

describe("tasteProse", () => {
  it("returns free-flow text as written", () => {
    expect(tasteProse({ body: "  Say something true.  " })).toBe(
      "Say something true."
    );
  });

  it("renders a legacy grid as readable prose", () => {
    expect(
      tasteProse({
        criteria: [
          { name: "Clarity", standard: "A stranger follows it once." },
          { name: "Evidence", standard: "Every claim is sourced." },
        ],
        bar_statement: "I would show it to a client.",
      })
    ).toBe(
      "Clarity: A stranger follows it once.\n\n" +
        "Evidence: Every claim is sourced.\n\n" +
        "My bar: I would show it to a client."
    );
  });

  it("is empty for an empty or missing row", () => {
    expect(tasteProse(null)).toBe("");
    expect(tasteProse({ body: "   ", criteria: [], bar_statement: "" })).toBe("");
  });

  it("caps and trims what gets stored", () => {
    expect(cleanTasteBody("  hi  ")).toBe("hi");
    expect(cleanTasteBody(42)).toBe("");
    expect(cleanTasteBody("x".repeat(20_000))).toHaveLength(10_000);
  });
});

describe("draftBody / isUntouchedTaste", () => {
  it("reads both the prose seed and the older drafted grid", () => {
    expect(draftBody({ body: "Good work explains itself." })).toBe(
      "Good work explains itself."
    );
    expect(
      draftBody({
        criteria: [{ name: "Clarity", standard: "Plain sentences." }],
        barStatement: "Proud to submit.",
      })
    ).toBe("Clarity: Plain sentences.\n\nMy bar: Proud to submit.");
  });

  it("knows an untouched draft from the student's own words", () => {
    const seed = { body: "Good work explains itself." };
    expect(isUntouchedTaste({ body: "Good work explains itself." }, seed)).toBe(
      true
    );
    expect(isUntouchedTaste({ body: "  " }, seed)).toBe(true);
    expect(isUntouchedTaste(null, seed)).toBe(true);
    expect(isUntouchedTaste({ body: "I care about rhythm." }, seed)).toBe(false);
  });
});
