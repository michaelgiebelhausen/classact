/**
 * Taste files as prose (pure, no I/O).
 *
 * A taste file is free-flowing text now — a student says what makes the work
 * good in their own words, dictated or pasted, rather than filling a grid.
 * Rows written under the old structured editor keep their criteria and are
 * read back as prose here, so nothing has to be migrated or re-entered.
 */

import type { TasteCriterion } from "@/types/db";

/** The stored shape, old or new. */
export interface TasteSource {
  body?: string | null;
  criteria?: TasteCriterion[] | null;
  bar_statement?: string | null;
}

const MAX_BODY = 10_000;

/** Trim and cap what a taste file may hold. */
export function cleanTasteBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_BODY);
}

/** A taste file's text: the prose body, or the legacy grid rendered as prose. */
export function tasteProse(row: TasteSource | null | undefined): string {
  if (!row) return "";
  if (typeof row.body === "string" && row.body.trim()) return row.body.trim();

  const parts: string[] = [];
  for (const criterion of row.criteria ?? []) {
    const name = criterion?.name?.trim() ?? "";
    const standard = criterion?.standard?.trim() ?? "";
    if (!name && !standard) continue;
    parts.push(name && standard ? `${name}: ${standard}` : name || standard);
  }
  const bar = row.bar_statement?.trim() ?? "";
  if (bar) parts.push(`My bar: ${bar}`);
  return parts.join("\n\n");
}

/**
 * The AI's drafted seed as prose. Accepts the new `{ body }` shape and the
 * `{ criteria, barStatement }` one that assignments opened before the switch
 * still carry.
 */
export function draftBody(defaultTaste: unknown): string {
  if (typeof defaultTaste !== "object" || defaultTaste === null) return "";
  const draft = defaultTaste as Record<string, unknown>;
  if (typeof draft.body === "string") return draft.body.trim();
  return tasteProse({
    criteria: Array.isArray(draft.criteria)
      ? (draft.criteria as TasteCriterion[])
      : null,
    bar_statement:
      typeof draft.barStatement === "string" ? draft.barStatement : null,
  });
}

/**
 * True when the student never made the draft their own — the badge in the
 * cockpit and the gate on a required taste file ask the same question.
 */
export function isUntouchedTaste(
  row: TasteSource | null | undefined,
  defaultTaste: unknown
): boolean {
  const written = tasteProse(row).trim();
  if (!written) return true;
  return written === draftBody(defaultTaste).trim();
}
