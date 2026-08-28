/**
 * Speed grader band math (pure, no I/O).
 * Spec: docs/tasty-grading-plan.md.
 *
 * A band is a slice of the ranked LIST, not of the score axis: dividers[i]
 * counts the rows above line i, so a band keeps its membership when the
 * professor drags a submission to a new position. Bands and rows both read
 * best → worst (row 0 = rank 1), which is the vertical form of the
 * left → right = low → high rule the histogram keeps.
 */

export interface Band {
  /** Free text — "A", "Excellent", or nothing. */
  label: string | null;
  /** Points at the band's floor row; null = a label-only band. */
  value: number | null;
}

export type ScoreMode = "stepped" | "linear";

export interface BandedScore {
  submissionId: string;
  /** 0 = best. */
  position: number;
  /** 0 = top band. */
  bandIndex: number;
  label: string | null;
  /** Exact — round with persistPoints / displayPoints at the edges. */
  points: number | null;
}

/**
 * Clamp dividers into a usable shape: one fewer than the bands, each within
 * 0..rowCount, never decreasing. Equal neighbours mean an empty band, which
 * is a legitimate grading act ("nobody earned an A").
 */
export function normalizeDividers(
  dividers: number[],
  rowCount: number,
  bandCount: number
): number[] {
  const wanted = Math.max(0, bandCount - 1);
  const out: number[] = [];
  let last = 0;
  for (let i = 0; i < wanted; i++) {
    const raw = dividers[i];
    const n =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.round(raw)
        : rowCount;
    last = Math.min(rowCount, Math.max(last, n));
    out.push(last);
  }
  return out;
}

/** Row spans per band, best band first. `end` is exclusive. */
function bandRanges(
  rowCount: number,
  dividers: number[],
  bandCount: number
): { start: number; end: number }[] {
  const bounds = [0, ...dividers, rowCount];
  const out: { start: number; end: number }[] = [];
  for (let b = 0; b < bandCount; b++) {
    out.push({ start: bounds[b], end: bounds[b + 1] });
  }
  return out;
}

/** Band index for each row position. */
export function assignBands(
  rowCount: number,
  dividers: number[],
  bandCount: number
): number[] {
  const lines = normalizeDividers(dividers, rowCount, bandCount);
  const out: number[] = [];
  for (let p = 0; p < rowCount; p++) {
    let b = 0;
    for (const line of lines) if (line <= p) b++;
    out.push(Math.min(b, Math.max(0, bandCount - 1)));
  }
  return out;
}

/**
 * Points for every row of the ranked order.
 *
 * Stepped: every row in a band earns the band's value.
 *
 * Linear: the band's bottom row earns its value and the rows above climb
 * toward the ceiling — the next band up, or `points` for the top band. The
 * top band is inclusive (rank 1 earns full marks); lower bands stop short of
 * their ceiling so the top of B never ties the bottom of A.
 */
export function computeScores(input: {
  order: string[];
  bands: Band[];
  dividers: number[];
  scoreMode: ScoreMode;
  points: number | null;
}): BandedScore[] {
  const { order, scoreMode, points } = input;
  const bands: Band[] =
    input.bands.length > 0 ? input.bands : [{ label: null, value: null }];
  const rowCount = order.length;
  const lines = normalizeDividers(input.dividers, rowCount, bands.length);
  const ranges = bandRanges(rowCount, lines, bands.length);

  const out: BandedScore[] = new Array(rowCount);
  for (let b = 0; b < bands.length; b++) {
    const { start, end } = ranges[b];
    const m = end - start;
    if (m <= 0) continue;

    const band = bands[b];
    const v = band.value;
    const isTop = b === 0;
    const ceiling = isTop ? points : bands[b - 1].value;

    for (let row = start; row < end; row++) {
      // j counts up from the band's bottom row.
      const j = end - 1 - row;
      let value: number | null;
      if (scoreMode === "stepped") {
        value = v;
      } else if (v === null || ceiling === null) {
        // Linear needs both ends; setBands/publish reject this shape.
        value = null;
      } else if (m === 1) {
        value = isTop ? ceiling : v;
      } else if (isTop) {
        value = v + (j * (ceiling - v)) / (m - 1);
      } else {
        value = v + (j * (ceiling - v)) / m;
      }
      out[row] = {
        submissionId: order[row],
        position: row,
        bandIndex: b,
        label: band.label,
        points: value,
      };
    }
  }
  return out;
}

/** Two decimals — what a gradebook actually stores (3.50, 102.08). */
export function persistPoints(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/** One decimal, integers bare — what keeps a long list scannable. */
export function displayPoints(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A professor verdict as a local move: if the order already agrees, nothing
 * happens; otherwise the loser drops in directly below the winner. No global
 * refit — the materialized order is the professor's, not the model's.
 */
export function applyLocalMove(
  order: string[],
  winnerId: string,
  loserId: string
): string[] {
  const winner = order.indexOf(winnerId);
  const loser = order.indexOf(loserId);
  if (winner < 0 || loser < 0 || winner === loser) return [...order];
  if (winner < loser) return [...order]; // already agrees
  const next = order.filter((id) => id !== loserId);
  // Removing the loser (above the winner) shifts the winner up one.
  next.splice(winner, 0, loserId);
  return next;
}

/**
 * Map legacy 0–100 cut thresholds onto the live score distribution, so an
 * assignment mid-flight keeps the bands it already had when the list
 * replaces the strip. `scoresDesc` must be sorted high → low.
 */
export function dividersFromThresholds(
  scoresDesc: number[],
  mins: number[]
): number[] {
  // The lowest threshold is the bottom band's floor, not a line.
  const lines = mins.slice(0, Math.max(0, mins.length - 1));
  return lines.map((min) => {
    let count = 0;
    for (const score of scoresDesc) {
      if (score >= min) count++;
      else break;
    }
    return count;
  });
}

/**
 * Where each divider falls on the score axis — the midpoint between the rows
 * it separates. Feeds the read-only histogram markers and suggestPair's
 * boundary weighting.
 */
export function cutScoresFromDividers(
  scoresDesc: number[],
  dividers: number[]
): number[] {
  const n = scoresDesc.length;
  if (n === 0) return dividers.map(() => 0);
  return dividers.map((d) => {
    if (d <= 0) return scoresDesc[0];
    if (d >= n) return scoresDesc[n - 1];
    return (scoresDesc[d - 1] + scoresDesc[d]) / 2;
  });
}

/**
 * The one rule set behind the Save button, the publish gate, and the server
 * action — so the professor reads the same sentence everywhere.
 * Returns null when the bands are publishable.
 */
export function bandsProblem(input: {
  bands: Band[];
  dividers: number[];
  scoreMode: ScoreMode;
  points: number | null;
  rowCount: number;
}): string | null {
  const { bands, scoreMode, points, rowCount } = input;
  if (bands.length === 0) return "Add at least one grade band.";
  if (input.dividers.length !== bands.length - 1) {
    return "Each band needs a dividing line between it and the next.";
  }
  for (const band of bands) {
    if (band.label !== null && band.label.length > 40) {
      return "Band labels are limited to 40 characters.";
    }
    if (
      band.value !== null &&
      (!Number.isFinite(band.value) || band.value < 0)
    ) {
      return "Band values must be zero or more.";
    }
  }
  for (let i = 0; i < input.dividers.length; i++) {
    const d = input.dividers[i];
    if (!Number.isFinite(d) || d < 0 || d > rowCount) {
      return "A dividing line sits outside the list.";
    }
    if (i > 0 && d < input.dividers[i - 1]) {
      return "Dividing lines must stay in order.";
    }
  }
  if (scoreMode === "linear") {
    if (points === null) {
      return "Set the assignment's point value before grading on a linear scale.";
    }
    for (const band of bands) {
      if (band.value === null) {
        return "A linear scale needs a value on every band.";
      }
    }
    for (let i = 1; i < bands.length; i++) {
      const above = bands[i - 1].value as number;
      const here = bands[i].value as number;
      if (here > above) {
        return "Band values must fall from top to bottom.";
      }
    }
    const top = bands[0].value as number;
    if (top > points) {
      return "The top band cannot be worth more than the assignment.";
    }
  }
  return null;
}
