/**
 * Judging statistics (pure, no I/O) — the honesty engine's scoreboard.
 * Every peer vote is a bet staked against the eventual settled ranking:
 *  - taste agreement: "recognizes good work" (all decided pairs)
 *  - self-honesty: how objectively you placed your own work (self pairs)
 *  - participation: decided / assigned
 */

export interface DecidedComparison {
  leftSubmissionId: string;
  rightSubmissionId: string;
  /** −2..+2 as stored (positive = right better). */
  verdict: number;
  pairType: "exceptional" | "self" | "refine";
  /** The judge's own submission id (for self pairs). */
  judgeSubmissionId?: string | null;
}

export interface JudgingStats {
  /** 0–100: weighted share of votes agreeing with the settled ranking. */
  tasteAgreement: number | null;
  /** 0–100: agreement on the self pair(s); null if none decided. */
  selfHonesty: number | null;
  /** Signed bias toward one's own work, −1..+1 (positive = self-favoring). */
  selfBias: number | null;
  /** 0–100: decided / assigned. */
  participation: number;
}

/** Ranks within this distance are a near-tie: "equal" is a fair answer. */
const EQUAL_TOLERANCE = 2;

function agreementFor(
  comparison: DecidedComparison,
  rankOf: ReadonlyMap<string, number>
): { correct: number; weight: number } | null {
  const leftRank = rankOf.get(comparison.leftSubmissionId);
  const rightRank = rankOf.get(comparison.rightSubmissionId);
  if (leftRank === undefined || rightRank === undefined) return null;
  const weight = Math.max(1, Math.abs(comparison.verdict));
  // Settled truth: lower rank number = better.
  const rightBetter = rightRank < leftRank;
  const closeCall = Math.abs(leftRank - rightRank) <= EQUAL_TOLERANCE;
  if (comparison.verdict === 0) {
    return { correct: closeCall ? 1 : 0, weight: 1 };
  }
  if (closeCall) {
    // Near-ties: either direction is defensible; award full credit.
    return { correct: 1, weight };
  }
  const saidRightBetter = comparison.verdict > 0;
  return { correct: saidRightBetter === rightBetter ? 1 : 0, weight };
}

/**
 * Score a judge's decided comparisons against the settled ranking
 * (submissionId → final rank, 1 = best).
 */
export function judgingStats(
  decided: DecidedComparison[],
  assignedCount: number,
  rankOf: ReadonlyMap<string, number>
): JudgingStats {
  let correctWeight = 0;
  let totalWeight = 0;
  let selfCorrect = 0;
  let selfTotal = 0;
  let selfBiasSum = 0;
  let selfBiasCount = 0;

  for (const c of decided) {
    const scored = agreementFor(c, rankOf);
    if (!scored) continue;
    correctWeight += scored.correct * scored.weight;
    totalWeight += scored.weight;

    if (c.pairType === "self" && c.judgeSubmissionId) {
      selfCorrect += scored.correct * scored.weight;
      selfTotal += scored.weight;
      // Bias: did the verdict favor their own side beyond the settled truth?
      const ownIsRight = c.judgeSubmissionId === c.rightSubmissionId;
      const ownRank = rankOf.get(c.judgeSubmissionId);
      const otherRank = rankOf.get(
        ownIsRight ? c.leftSubmissionId : c.rightSubmissionId
      );
      if (ownRank !== undefined && otherRank !== undefined) {
        // Positive verdictTowardSelf = they said their own work was better.
        const verdictTowardSelf = ownIsRight ? c.verdict : -c.verdict;
        // Truth: +1 if own genuinely better, −1 if worse, 0 near-tie.
        const truth =
          Math.abs(ownRank - otherRank) <= EQUAL_TOLERANCE
            ? 0
            : ownRank < otherRank
              ? 1
              : -1;
        selfBiasSum += Math.max(-1, Math.min(1, verdictTowardSelf / 2 - truth));
        selfBiasCount += 1;
      }
    }
  }

  return {
    tasteAgreement:
      totalWeight > 0 ? Math.round((correctWeight / totalWeight) * 100) : null,
    selfHonesty:
      selfTotal > 0 ? Math.round((selfCorrect / selfTotal) * 100) : null,
    selfBias:
      selfBiasCount > 0
        ? Math.round((selfBiasSum / selfBiasCount) * 100) / 100
        : null,
    participation:
      assignedCount > 0
        ? Math.round((decided.length / assignedCount) * 100)
        : 0,
  };
}
