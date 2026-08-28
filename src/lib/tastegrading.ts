/**
 * Tasty Grading shared settings + grade math (pure, no I/O).
 * Spec: docs/tasty-grading-plan.md.
 *
 * Settings resolve in three layers: hard defaults → course grading_defaults
 * → per-assignment settings. Cut points live on the normalized 0–100 score
 * axis (left → right = low → high, like every axis in the product).
 */

import type { Band, ScoreMode } from "@/lib/bands";

/**
 * Legacy: a grade boundary on the score axis. Bands replaced these — the
 * professor now draws lines between rows of the ranked list — but the shape
 * is still read so assignments graded before the switch keep their letters.
 */
export interface CutPoint {
  /** "A", "A-", "B+", … */
  letter: string;
  /** Minimum normalized score (0–100) to earn this letter. */
  min: number;
}

/** What a student sees of their grade. */
export type ScoreVisibility = "points" | "label" | "both";

/** Whether the deliverable includes the student's own taste file. */
export type TasteRequirement = "required" | "optional" | "off";

export const SCORE_MODES = ["stepped", "linear"] as const;
export const SCORE_VISIBILITIES = ["points", "label", "both"] as const;
export const TASTE_REQUIREMENTS = ["required", "optional", "off"] as const;

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
  /** Legacy, sorted descending by min. Read for back-compat, never written. */
  cutPoints: CutPoint[];
  /** Grade bands, best first. Where the lines fall is per-assignment state. */
  bands: Band[];
  scoreMode: ScoreMode;
  scoreVisibility: ScoreVisibility;
  tasteRequirement: TasteRequirement;
  /** Days after the deadline the peer window stays open (fallback). */
  peerWindowDays: number;
}

const DEFAULT_CUT_POINTS: CutPoint[] = [
  { letter: "A", min: 80 },
  { letter: "B", min: 60 },
  { letter: "C", min: 40 },
  { letter: "D", min: 20 },
  { letter: "F", min: 0 },
];

/** Legacy cut points as bands: the letter becomes a label, the value unset. */
export function bandsFromCutPoints(cutPoints: CutPoint[]): Band[] {
  return [...cutPoints]
    .sort((a, b) => b.min - a.min)
    .map((cut) => ({ label: cut.letter, value: null }));
}

export const DEFAULT_SETTINGS: GradingSettings = {
  pairMix: { exceptional: 1, self: 1, refine: 1 },
  professorWeight: 8,
  distinctivenessWeight: 0.15,
  cutPoints: DEFAULT_CUT_POINTS,
  bands: bandsFromCutPoints(DEFAULT_CUT_POINTS),
  scoreMode: "stepped",
  scoreVisibility: "both",
  tasteRequirement: "optional",
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

function parseBands(raw: unknown): Band[] | null {
  if (!Array.isArray(raw)) return null;
  const bands: Band[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const b = item as Record<string, unknown>;
    const label =
      typeof b.label === "string" && b.label.trim()
        ? b.label.trim().slice(0, 40)
        : null;
    const value =
      typeof b.value === "number" && Number.isFinite(b.value)
        ? Math.max(0, b.value)
        : null;
    bands.push({ label, value });
  }
  return bands.length > 0 ? bands : null;
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function layer(base: GradingSettings, raw: unknown): GradingSettings {
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const mix =
    typeof r.pairMix === "object" && r.pairMix !== null
      ? (r.pairMix as Record<string, unknown>)
      : {};
  const cutPoints = parseCutPoints(r.cutPoints);
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
    cutPoints: cutPoints ?? base.cutPoints,
    // A layer that still speaks in cut points contributes its letters as
    // labels, so an assignment mid-flight keeps the bands it already had.
    bands:
      parseBands(r.bands) ??
      (cutPoints ? bandsFromCutPoints(cutPoints) : base.bands),
    scoreMode: pick(r.scoreMode, SCORE_MODES, base.scoreMode),
    scoreVisibility: pick(
      r.scoreVisibility,
      SCORE_VISIBILITIES,
      base.scoreVisibility
    ),
    tasteRequirement: pick(
      r.tasteRequirement,
      TASTE_REQUIREMENTS,
      base.tasteRequirement
    ),
    peerWindowDays: num(r.peerWindowDays, base.peerWindowDays, 0.25, 30),
  };
}

/**
 * Divider positions index this class's actual rows, so they are read raw off
 * the assignment and never layered over a course default (a course template
 * can carry labels and values, but not where the lines fall). Null means the
 * assignment has none yet — derive them from the legacy thresholds.
 */
export function readDividers(assignmentSettings: unknown): number[] | null {
  if (typeof assignmentSettings !== "object" || assignmentSettings === null) {
    return null;
  }
  const raw = (assignmentSettings as Record<string, unknown>).dividers;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)));
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
