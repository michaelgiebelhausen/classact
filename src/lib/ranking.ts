/**
 * Ranking engine (pure, no I/O): AI absolute scores are the prior, human
 * pairwise comparisons refine it — a Bradley–Terry-style MAP estimate fit
 * by full recomputation (deterministic: same inputs → same ranking).
 *
 * Verdict convention matches the comparisons table: −2..+2 where negative
 * means the RIGHT submission is worse, positive means it's better
 * ("slightly" = ±1, "clearly" = ±2, 0 = equal).
 */

export interface RankingInput {
  submissionId: string;
  /** AI overall score 0–10 (already distinctiveness-adjusted). */
  aiOverall: number;
}

export interface ComparisonInput {
  leftSubmissionId: string;
  rightSubmissionId: string;
  /** −2..+2; null/undefined comparisons should be filtered out by callers. */
  verdict: number;
  /** 1 for a peer, professorWeight for the professor. */
  weight: number;
}

export interface RankedSubmission {
  submissionId: string;
  /** Latent ability (internal units). */
  theta: number;
  /** Normalized 0–100 for the histogram/cut-point axis. */
  score: number;
  /** 1 = best. */
  rank: number;
  /** Human comparisons touching this submission. */
  comparisons: number;
}

const EPOCHS = 40;
const BASE_LEARNING_RATE = 0.3;
/** Pull toward the AI prior — keeps sparse-comparison rankings anchored. */
const PRIOR_STRENGTH = 0.08;

function standardize(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    ) || 1;
  return values.map((v) => (v - mean) / sd);
}

/**
 * Fit abilities: init at standardized AI scores, then descend on the
 * comparison log-likelihood with an L2 pull back to the prior.
 */
export function computeRanking(
  submissions: RankingInput[],
  comparisons: ComparisonInput[]
): RankedSubmission[] {
  if (submissions.length === 0) return [];
  const ids = submissions.map((s) => s.submissionId);
  const index = new Map(ids.map((id, i) => [id, i]));
  const prior = standardize(submissions.map((s) => s.aiOverall));
  const theta = [...prior];

  const usable = comparisons.filter(
    (c) =>
      index.has(c.leftSubmissionId) &&
      index.has(c.rightSubmissionId) &&
      c.leftSubmissionId !== c.rightSubmissionId
  );

  const touch = new Array<number>(ids.length).fill(0);
  for (const c of usable) {
    touch[index.get(c.leftSubmissionId)!] += 1;
    touch[index.get(c.rightSubmissionId)!] += 1;
  }

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const lr = BASE_LEARNING_RATE * (1 - epoch / EPOCHS) + 0.02;
    for (const c of usable) {
      const li = index.get(c.leftSubmissionId)!;
      const ri = index.get(c.rightSubmissionId)!;
      // Outcome for the RIGHT submission: 1 = right wins, 0 = left wins.
      const outcome = c.verdict > 0 ? 1 : c.verdict < 0 ? 0 : 0.5;
      const margin = Math.max(1, Math.abs(c.verdict)); // equal still informs
      const expected = 1 / (1 + Math.exp(-(theta[ri] - theta[li])));
      const delta = lr * c.weight * margin * (outcome - expected);
      theta[ri] += delta;
      theta[li] -= delta;
    }
    // Prior pull, applied per-epoch so heavily-compared items can escape it.
    for (let i = 0; i < theta.length; i++) {
      theta[i] += PRIOR_STRENGTH * (prior[i] - theta[i]);
    }
  }

  // Normalize to 0–100 (re-standardize so the axis stays comparable).
  const z = standardize(theta);
  const ranked = ids.map((id, i) => ({
    submissionId: id,
    theta: theta[i],
    score: Math.min(100, Math.max(0, 50 + 18 * z[i])),
    rank: 0,
    comparisons: touch[i],
  }));
  const order = [...ranked].sort(
    (a, b) => b.theta - a.theta || a.submissionId.localeCompare(b.submissionId)
  );
  order.forEach((r, i) => {
    r.rank = i + 1;
  });
  return ranked.sort((a, b) => a.rank - b.rank);
}

export interface StabilitySummary {
  /** 0–1: share of submissions with at least one human comparison. */
  coverage: number;
  /** Average human comparisons per submission. */
  meanComparisons: number;
  /** Rank positions (1-based) with no human evidence — worth a look. */
  thinRanks: number[];
}

/** How settled is the ranking? Drives the cockpit's stability meter. */
export function stability(ranked: RankedSubmission[]): StabilitySummary {
  if (ranked.length === 0) {
    return { coverage: 0, meanComparisons: 0, thinRanks: [] };
  }
  const touched = ranked.filter((r) => r.comparisons > 0).length;
  const total = ranked.reduce((a, r) => a + r.comparisons, 0);
  return {
    coverage: touched / ranked.length,
    meanComparisons: total / ranked.length,
    thinRanks: ranked.filter((r) => r.comparisons === 0).map((r) => r.rank),
  };
}

/**
 * Pick the most informative next pair for a judge: prefer adjacent-by-rank
 * pairs, weighted toward grade cut boundaries when cut points exist.
 */
export function suggestPair(
  ranked: RankedSubmission[],
  cutMins: number[],
  exclude: ReadonlySet<string>,
  rand: () => number
): { left: string; right: string } | null {
  if (ranked.length < 2) return null;
  const byRank = [...ranked].sort((a, b) => a.rank - b.rank);
  const candidates: Array<{ left: string; right: string; weight: number }> = [];
  for (let i = 0; i < byRank.length - 1; i++) {
    const a = byRank[i];
    const b = byRank[i + 1];
    const key = pairKey(a.submissionId, b.submissionId);
    if (exclude.has(key)) continue;
    // Boundary bonus: does a cut line fall between their scores?
    const lo = Math.min(a.score, b.score);
    const hi = Math.max(a.score, b.score);
    const straddles = cutMins.some((m) => m > lo && m <= hi);
    // Thin-evidence bonus: fewer comparisons = more to learn.
    const thin = 1 / (1 + a.comparisons + b.comparisons);
    candidates.push({
      left: a.submissionId,
      right: b.submissionId,
      weight: (straddles ? 4 : 1) * (0.5 + thin),
    });
  }
  if (candidates.length === 0) return null;
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let roll = rand() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) {
      // Randomize left/right so screen position carries no signal.
      return rand() < 0.5
        ? { left: c.left, right: c.right }
        : { left: c.right, right: c.left };
    }
  }
  const last = candidates[candidates.length - 1];
  return { left: last.left, right: last.right };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
