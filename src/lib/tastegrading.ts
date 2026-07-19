/**
 * Tasty Grading shared settings + grade math (pure, no I/O).
 * Spec: docs/tasty-grading-plan.md.
 *
 * Settings resolve in three layers: hard defaults → course grading_defaults
 * → per-assignment settings. Cut points live on the normalized 0–100 score
 * axis (left → right = low → high, like every axis in the product).
 */

export interface CutPoint {
  /** "A", "A-", "B+", … */
  letter: string;
  /** Minimum normalized score (0–100) to earn this letter. */
  min: number;
}

export interface PairMix {
  exceptional: number;
  self: number;
  refine: number;
}

export interface GradingSettings {
  pairMix: PairMix;
  /** One professor comparison counts this many peer comparisons. */
  professorWeight: number;
  /** 0–1: how much distinctiveness shifts the AI overall (0 = informational). */
  distinctivenessWeight: number;
  /** Sorted descending by min. */
  cutPoints: CutPoint[];
  /** Days after the deadline the peer window stays open (fallback). */
  peerWindowDays: number;
}

export const DEFAULT_SETTINGS: GradingSettings = {
  pairMix: { exceptional: 1, self: 1, refine: 1 },
  professorWeight: 8,
  distinctivenessWeight: 0.15,
  cutPoints: [
    { letter: "A", min: 80 },
    { letter: "B", min: 60 },
    { letter: "C", min: 40 },
    { letter: "D", min: 20 },
    { letter: "F", min: 0 },
  ],
  peerWindowDays: 5,
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function parseCutPoints(raw: unknown): CutPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const points: CutPoint[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.letter !== "string" || !p.letter.trim()) continue;
    points.push({
      letter: p.letter.trim().slice(0, 4),
      min: num(p.min, 0, 0, 100),
    });
  }
  if (points.length === 0) return null;
  return points.sort((a, b) => b.min - a.min);
}

function layer(base: GradingSettings, raw: unknown): GradingSettings {
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const mix =
    typeof r.pairMix === "object" && r.pairMix !== null
      ? (r.pairMix as Record<string, unknown>)
      : {};
  return {
    pairMix: {
      exceptional: num(mix.exceptional, base.pairMix.exceptional, 0, 4),
      self: num(mix.self, base.pairMix.self, 0, 1),
      refine: num(mix.refine, base.pairMix.refine, 0, 4),
    },
    professorWeight: num(r.professorWeight, base.professorWeight, 1, 50),
    distinctivenessWeight: num(
      r.distinctivenessWeight,
      base.distinctivenessWeight,
      0,
      1
    ),
    cutPoints: parseCutPoints(r.cutPoints) ?? base.cutPoints,
    peerWindowDays: num(r.peerWindowDays, base.peerWindowDays, 0.25, 30),
  };
}

/** defaults → course grading_defaults → assignment settings. */
export function resolveSettings(
  courseDefaults: unknown,
  assignmentSettings: unknown
): GradingSettings {
  return layer(layer(DEFAULT_SETTINGS, courseDefaults), assignmentSettings);
}

/** Letter for a normalized score, or null when no cut points are set. */
export function letterFor(score: number, cutPoints: CutPoint[]): string | null {
  for (const cut of cutPoints) {
    if (score >= cut.min) return cut.letter;
  }
  return cutPoints.length > 0 ? cutPoints[cutPoints.length - 1].letter : null;
}

/** Deterministic PRNG (mulberry32) — pairing and sampling stay replayable. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
