/**
 * The rubric as a grid the professor owns: criteria with a weight each.
 *
 * Three questions live here as pure functions so the server action, the
 * engine and the grid all answer them the same way:
 *
 *  - Is this grid valid? (cleanCriteria)
 *  - What does a submission score under these weights? (weightedOverall) —
 *    the ranking's prior is the weighted mean of the per-criterion scores,
 *    so changing a weight re-ranks without asking the AI anything.
 *  - Does a change need the AI to read every submission again, or only new
 *    arithmetic? (rubricSignature) — the signature covers what the AI reads
 *    (names and descriptions), never the weights.
 */

export const MAX_CRITERIA = 12;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 600;

export interface Criterion {
  /** A rubric_themes id; absent for a row the professor just added. */
  id?: string;
  name: string;
  /** What excellent looks like. */
  description: string;
  /** Relative, ≥ 0. Shares come from weightPercents. */
  weight: number;
}

/** Validate and trim a grid from the client. A string is the problem, in words. */
export function cleanCriteria(raw: unknown): Criterion[] | string {
  if (!Array.isArray(raw)) return "The rubric didn't arrive — try again.";
  const out: Criterion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, NAME_MAX) : "";
    const description =
      typeof r.description === "string" ? r.description.trim().slice(0, DESCRIPTION_MAX) : "";
    // A row left completely blank is an unfinished "add", not an error.
    if (!name && !description) continue;
    if (!name) return "Every criterion needs a name.";
    const weight = typeof r.weight === "number" ? r.weight : Number(r.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1000) {
      return `"${name}" needs a weight of 0 or more.`;
    }
    const id = typeof r.id === "string" && r.id ? r.id : undefined;
    out.push({ ...(id ? { id } : {}), name, description, weight });
  }
  if (out.length === 0) return "Add at least one criterion.";
  if (out.length > MAX_CRITERIA) return `A rubric holds at most ${MAX_CRITERIA} criteria.`;
  if (!out.some((c) => c.weight > 0)) return "At least one criterion has to count (weight above 0).";
  const names = new Set<string>();
  for (const c of out) {
    const key = c.name.toLowerCase();
    if (names.has(key)) return `Two criteria are both called "${c.name}".`;
    names.add(key);
  }
  return out;
}

/**
 * Each weight as a whole-number share of 100, rounded so the shares always
 * add up to exactly 100 (largest remainder). All-zero → all zero.
 */
export function weightPercents(weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) / total) * 100);
  const floors = exact.map(Math.floor);
  let short = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (short <= 0) break;
    floors[i] += 1;
    short -= 1;
  }
  return floors;
}

/**
 * The weighted mean of a submission's per-criterion scores (0–10), over the
 * criteria that both have a score and still exist. Null when there's no
 * overlap — a submission scored before every current criterion existed —
 * and the caller falls back to the AI's holistic overall.
 */
export function weightedOverall(
  themeScores: ReadonlyArray<{ themeId: string; score: number }>,
  weights: ReadonlyMap<string, number>
): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const ts of themeScores) {
    const w = weights.get(ts.themeId);
    if (w === undefined || w <= 0) continue;
    const score = Number(ts.score);
    if (!Number.isFinite(score)) continue;
    sum += score * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return null;
  return Math.round((sum / totalWeight) * 100) / 100;
}

/**
 * A fingerprint of what the AI reads when it scores — each criterion's name
 * and description — independent of order and of weights. Two grids with the
 * same signature need no new AI pass between them; a weight change alone is
 * arithmetic.
 */
export function rubricSignature(
  criteria: ReadonlyArray<{ name: string; description: string }>
): string {
  const canonical = criteria
    .map((c) => `${c.name.trim().toLowerCase()}\u0000${c.description.trim()}`)
    .sort()
    .join("\u0001");
  return `${criteria.length}:${fingerprint(canonical)}`;
}

/**
 * FNV-1a, 32-bit, base 36: short enough to keep in assignment JSON. A
 * collision only costs a skipped AI pass the professor can still ask for.
 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The rubric bookkeeping kept in assignments.settings. */
export interface RubricMeta {
  /** The professor has changed the grid by hand; auto-drafts stop. */
  edited: boolean;
  /** fingerprint() of the taste file the grid was last drafted from. */
  draftedFrom: string | null;
}

export function readRubricMeta(settings: unknown): RubricMeta {
  const s = (settings ?? {}) as { rubricEdited?: unknown; rubricDraftedFrom?: unknown };
  return {
    edited: s.rubricEdited === true,
    draftedFrom: typeof s.rubricDraftedFrom === "string" ? s.rubricDraftedFrom : null,
  };
}

/**
 * Weights the AI proposed as percentages. Taken as given when every one is a
 * sane positive number; otherwise equal shares, rather than mixing its guesses
 * with fillers that would silently skew the rest.
 */
export function proposedWeights(values: unknown[]): number[] {
  const parsed = values.map((v) => (typeof v === "number" ? v : Number(v)));
  if (parsed.length > 0 && parsed.every((n) => Number.isFinite(n) && n > 0 && n <= 100)) {
    return parsed.map((n) => Math.max(1, Math.round(n)));
  }
  return weightPercents(values.map(() => 1));
}
