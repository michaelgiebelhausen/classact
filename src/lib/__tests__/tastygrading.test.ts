import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  letterFor,
  resolveSettings,
  seededRandom,
} from "@/lib/tastegrading";
import {
  computeRanking,
  pairKey,
  stability,
  suggestPair,
  type ComparisonInput,
} from "@/lib/ranking";
import { assignPeerPairs, exceptionalPool } from "@/lib/pairing";
import { judgingStats, type DecidedComparison } from "@/lib/tastestats";
import { findSimilarPairs, jaccard, shingles } from "@/lib/shingle";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("resolveSettings", () => {
  it("layers defaults → course → assignment", () => {
    const s = resolveSettings(
      { professorWeight: 3, pairMix: { refine: 2 } },
      { distinctivenessWeight: 0.5 }
    );
    expect(s.professorWeight).toBe(3);
    expect(s.pairMix).toEqual({ exceptional: 1, self: 1, refine: 2 });
    expect(s.distinctivenessWeight).toBe(0.5);
    expect(s.cutPoints).toEqual(DEFAULT_SETTINGS.cutPoints);
  });

  it("sorts custom cut points and assigns letters by threshold", () => {
    const s = resolveSettings(null, {
      cutPoints: [
        { letter: "B", min: 55 },
        { letter: "A", min: 82 },
      ],
    });
    expect(s.cutPoints[0].letter).toBe("A");
    expect(letterFor(90, s.cutPoints)).toBe("A");
    expect(letterFor(60, s.cutPoints)).toBe("B");
    // Below every cut → lowest letter.
    expect(letterFor(10, s.cutPoints)).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function subs(scores: number[]) {
  return scores.map((aiOverall, i) => ({ submissionId: `s${i}`, aiOverall }));
}

describe("computeRanking", () => {
  it("with no comparisons, order follows the AI prior", () => {
    const ranked = computeRanking(subs([3, 9, 6]), []);
    expect(ranked.map((r) => r.submissionId)).toEqual(["s1", "s2", "s0"]);
    expect(ranked[0].rank).toBe(1);
  });

  it("repeated human comparisons overturn a near-tie", () => {
    const comparisons: ComparisonInput[] = Array.from({ length: 6 }, () => ({
      leftSubmissionId: "s1", // AI's favorite on the left…
      rightSubmissionId: "s0",
      verdict: 2, // …but judges keep saying RIGHT (s0) is clearly better
      weight: 1,
    }));
    const ranked = computeRanking(subs([7.8, 8.0]), comparisons);
    const s0 = ranked.find((r) => r.submissionId === "s0")!;
    const s1 = ranked.find((r) => r.submissionId === "s1")!;
    expect(s0.rank).toBeLessThan(s1.rank);
  });

  it("professor weight moves the needle more than a lone peer", () => {
    const peerOnly = computeRanking(subs([7.8, 8.0]), [
      { leftSubmissionId: "s1", rightSubmissionId: "s0", verdict: 1, weight: 1 },
    ]);
    const profOnly = computeRanking(subs([7.8, 8.0]), [
      { leftSubmissionId: "s1", rightSubmissionId: "s0", verdict: 1, weight: 8 },
    ]);
    const gap = (r: typeof peerOnly) =>
      r.find((x) => x.submissionId === "s0")!.theta -
      r.find((x) => x.submissionId === "s1")!.theta;
    expect(gap(profOnly)).toBeGreaterThan(gap(peerOnly));
  });

  it("is deterministic", () => {
    const c: ComparisonInput[] = [
      { leftSubmissionId: "s0", rightSubmissionId: "s2", verdict: -1, weight: 1 },
      { leftSubmissionId: "s1", rightSubmissionId: "s3", verdict: 2, weight: 8 },
    ];
    expect(computeRanking(subs([5, 6, 7, 8]), c)).toEqual(
      computeRanking(subs([5, 6, 7, 8]), c)
    );
  });

  it("stability reports untouched submissions", () => {
    const ranked = computeRanking(subs([5, 6, 7]), [
      { leftSubmissionId: "s0", rightSubmissionId: "s1", verdict: 1, weight: 1 },
    ]);
    const s = stability(ranked);
    expect(s.coverage).toBeCloseTo(2 / 3, 5);
    expect(s.thinRanks).toHaveLength(1);
  });

  it("suggestPair serves varied adjacent candidates", () => {
    const ranked = computeRanking(subs([2, 4, 6, 8]), []);
    const rand = seededRandom("test");
    const all = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const pair = suggestPair(ranked, [50], new Set(), rand);
      if (pair) all.add(pairKey(pair.left, pair.right));
    }
    expect(all.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

function roster(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    submissionId: `sub${i}`,
    enrollmentId: `e${i}`,
    rank: i + 1,
  }));
}

describe("assignPeerPairs", () => {
  const mix = { exceptional: 1, self: 1, refine: 1 };

  it("gives every judge the configured number of pairs", () => {
    const pairs = assignPeerPairs({ submissions: roster(20), mix, seed: "a" });
    const byJudge = new Map<string, number>();
    for (const p of pairs) {
      byJudge.set(p.judgeEnrollmentId, (byJudge.get(p.judgeEnrollmentId) ?? 0) + 1);
    }
    expect(byJudge.size).toBe(20);
    for (const count of byJudge.values()) expect(count).toBe(3);
  });

  it("self pairs contain the judge's own work; others never do", () => {
    const pairs = assignPeerPairs({ submissions: roster(15), mix, seed: "b" });
    const own = (judge: string) => `sub${judge.slice(1)}`;
    for (const p of pairs) {
      const members = [p.leftSubmissionId, p.rightSubmissionId];
      if (p.pairType === "self") {
        expect(members).toContain(own(p.judgeEnrollmentId));
      } else {
        expect(members).not.toContain(own(p.judgeEnrollmentId));
      }
    }
  });

  it("exceptional pairs include a top-10% submission", () => {
    const submissions = roster(30);
    const stars = new Set(exceptionalPool(submissions).map((s) => s.submissionId));
    const pairs = assignPeerPairs({ submissions, mix, seed: "c" });
    for (const p of pairs.filter((x) => x.pairType === "exceptional")) {
      expect(
        stars.has(p.leftSubmissionId) || stars.has(p.rightSubmissionId)
      ).toBe(true);
    }
  });

  it("randomizes which slot the exceptional pair lands in", () => {
    const pairs = assignPeerPairs({ submissions: roster(30), mix, seed: "d" });
    const positions = new Set(
      pairs.filter((p) => p.pairType === "exceptional").map((p) => p.position)
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it("is deterministic for a given seed and handles tiny classes", () => {
    expect(assignPeerPairs({ submissions: roster(12), mix, seed: "e" })).toEqual(
      assignPeerPairs({ submissions: roster(12), mix, seed: "e" })
    );
    // Two students: still produces valid pairs without crashing.
    const tiny = assignPeerPairs({ submissions: roster(2), mix, seed: "f" });
    for (const p of tiny) {
      expect(p.leftSubmissionId).not.toBe(p.rightSubmissionId);
    }
  });
});

// ---------------------------------------------------------------------------
// Judging stats
// ---------------------------------------------------------------------------

describe("judgingStats", () => {
  // Final ranks: subA=1 (best) … subD=10 (worst).
  const rankOf = new Map([
    ["subA", 1],
    ["subB", 5],
    ["subC", 6],
    ["subD", 10],
  ]);

  it("rewards agreement with the settled ranking", () => {
    const decided: DecidedComparison[] = [
      // Right (subA, rank 1) clearly better than left (subD, rank 10): correct.
      { leftSubmissionId: "subD", rightSubmissionId: "subA", verdict: 2, pairType: "exceptional" },
      // Said right (subD, rank 10) clearly better than subA: wrong.
      { leftSubmissionId: "subA", rightSubmissionId: "subD", verdict: 2, pairType: "refine" },
    ];
    const stats = judgingStats(decided, 3, rankOf);
    // 2 of 4 weighted points correct.
    expect(stats.tasteAgreement).toBe(50);
    expect(stats.participation).toBe(67);
  });

  it("gives near-ties full credit either way, and equal-when-far no credit", () => {
    const nearTie: DecidedComparison[] = [
      { leftSubmissionId: "subB", rightSubmissionId: "subC", verdict: -1, pairType: "refine" },
    ];
    expect(judgingStats(nearTie, 1, rankOf).tasteAgreement).toBe(100);
    const lazyEqual: DecidedComparison[] = [
      { leftSubmissionId: "subA", rightSubmissionId: "subD", verdict: 0, pairType: "refine" },
    ];
    expect(judgingStats(lazyEqual, 1, rankOf).tasteAgreement).toBe(0);
  });

  it("scores self-honesty and detects self-favoring bias", () => {
    const honest: DecidedComparison[] = [
      // Own work (subD, rank 10) vs subA (rank 1): admits own is clearly worse.
      {
        leftSubmissionId: "subD",
        rightSubmissionId: "subA",
        verdict: 2,
        pairType: "self",
        judgeSubmissionId: "subD",
      },
    ];
    const honestStats = judgingStats(honest, 1, rankOf);
    expect(honestStats.selfHonesty).toBe(100);
    expect(honestStats.selfBias).toBeLessThanOrEqual(0);

    const vain: DecidedComparison[] = [
      // Claims own (subD, rank 10) is clearly better than subA (rank 1).
      {
        leftSubmissionId: "subD",
        rightSubmissionId: "subA",
        verdict: -2,
        pairType: "self",
        judgeSubmissionId: "subD",
      },
    ];
    const vainStats = judgingStats(vain, 1, rankOf);
    expect(vainStats.selfHonesty).toBe(0);
    expect(vainStats.selfBias).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Shingling
// ---------------------------------------------------------------------------

describe("shingle similarity", () => {
  const essay =
    "Marketing segmentation divides a broad market into subsets of consumers who have common needs and priorities, and then designing strategies to target them effectively over time.";
  const paraphrase =
    "Marketing segmentation divides a broad market into subsets of consumers who have common needs and priorities, and then creating campaigns aimed at each group with tailored messaging.";
  const unrelated =
    "The mitochondria is the powerhouse of the cell, converting oxygen and nutrients into adenosine triphosphate through the process of oxidative phosphorylation inside the inner membrane.";

  it("near-identical text scores high; unrelated text scores ~0", () => {
    expect(jaccard(shingles(essay), shingles(essay))).toBe(1);
    expect(jaccard(shingles(essay), shingles(unrelated))).toBeLessThan(0.05);
  });

  it("flags copied-with-edits pairs and skips honest ones", () => {
    const hits = findSimilarPairs([
      { id: "a", text: essay },
      { id: "b", text: paraphrase },
      { id: "c", text: unrelated },
    ]);
    expect(hits).toHaveLength(1);
    expect([hits[0].aId, hits[0].bId].sort()).toEqual(["a", "b"]);
  });
});
