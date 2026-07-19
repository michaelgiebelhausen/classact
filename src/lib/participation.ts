/**
 * Participation scoring (pure, no I/O) — the professor's side of the
 * metrics system. A student's participation score is a weighted average of
 * their competency scores (0–100 each, from employability.ts). Weights are
 * professor-owned: set directly with sliders, or inferred from side-by-side
 * student comparisons (a conjoint: which attributes actually drive the
 * professor's judgment?) via logistic regression on attribute differences.
 */

export interface WeightedAttribute {
  key: string;
  label: string;
  /** 0–1; normalized before scoring. */
  weight: number;
}

/** Equal weights over a competency key set. */
export function defaultWeights(
  keys: Array<{ key: string; label: string }>
): WeightedAttribute[] {
  return keys.map((k) => ({ ...k, weight: 1 / Math.max(1, keys.length) }));
}

export function normalizeWeights(weights: WeightedAttribute[]): WeightedAttribute[] {
  const total = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (total <= 0) return defaultWeights(weights);
  return weights.map((w) => ({ ...w, weight: Math.max(0, w.weight) / total }));
}

/** Weighted participation score, 0–100. */
export function participationScore(
  scores: Record<string, number>,
  weights: WeightedAttribute[]
): number {
  const normalized = normalizeWeights(weights);
  let sum = 0;
  for (const w of normalized) {
    sum += (scores[w.key] ?? 0) * w.weight;
  }
  return Math.round(Math.min(100, Math.max(0, sum)) * 10) / 10;
}

export interface StudentComparison {
  /** Attribute scores (0–100) for the left and right student. */
  left: Record<string, number>;
  right: Record<string, number>;
  /** −2..+2, positive = right student participates better. */
  verdict: number;
}

/**
 * Conjoint weight inference: logistic regression on (right − left)
 * attribute differences predicting the professor's verdicts. Returns
 * normalized non-negative weights; falls back to the provided weights when
 * there's too little signal (< 3 decisive comparisons). Deterministic.
 */
export function fitWeights(
  comparisons: StudentComparison[],
  keys: Array<{ key: string; label: string }>,
  fallback: WeightedAttribute[]
): WeightedAttribute[] {
  const decisive = comparisons.filter((c) => c.verdict !== 0);
  if (decisive.length < 3) return normalizeWeights(fallback);

  const beta = new Array<number>(keys.length).fill(0.1);
  const EPOCHS = 300;
  const LR = 0.05;
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    for (const c of decisive) {
      // Feature: score difference scaled to ~[-1, 1].
      const x = keys.map(
        (k) => ((c.right[k.key] ?? 0) - (c.left[k.key] ?? 0)) / 100
      );
      const target = c.verdict > 0 ? 1 : 0;
      const margin = Math.abs(c.verdict); // "clearly" counts double
      let z = 0;
      for (let i = 0; i < beta.length; i++) z += beta[i] * x[i];
      const p = 1 / (1 + Math.exp(-z));
      const grad = (target - p) * margin;
      for (let i = 0; i < beta.length; i++) {
        beta[i] += LR * grad * x[i];
        // Ridge: keep weights bounded and the fit stable on small samples.
        beta[i] -= LR * 0.01 * beta[i];
      }
    }
  }
  // Negative coefficients mean "this attribute argued against the pick" —
  // clamp to zero: participation weights are non-negative by construction.
  const raw = beta.map((b) => Math.max(0, b));
  const total = raw.reduce((s, b) => s + b, 0);
  if (total <= 0) return normalizeWeights(fallback);
  return normalizeWeights(
    keys.map((k, i) => ({ ...k, weight: raw[i] / total }))
  );
}

/** Parse persisted weights (courses.participation_weights) safely. */
export function parseWeights(
  raw: unknown,
  keys: Array<{ key: string; label: string }>
): WeightedAttribute[] {
  if (typeof raw !== "object" || raw === null) return defaultWeights(keys);
  const record = raw as Record<string, unknown>;
  const parsed = keys.map((k) => ({
    ...k,
    weight:
      typeof record[k.key] === "number" && Number.isFinite(record[k.key] as number)
        ? Math.max(0, record[k.key] as number)
        : 1 / keys.length,
  }));
  return normalizeWeights(parsed);
}

/** Serialize for persistence. */
export function weightsToRecord(weights: WeightedAttribute[]): Record<string, number> {
  return Object.fromEntries(normalizeWeights(weights).map((w) => [w.key, w.weight]));
}
