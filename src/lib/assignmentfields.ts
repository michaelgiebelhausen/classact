/**
 * The two fields an assignment gained in 0033, validated away from the
 * database so the rules can be tested directly.
 *
 * Both refuse rather than coerce. A professor who types "ten" into points
 * has made a mistake worth telling them about; silently storing null (or
 * zero) would hide it until a grade came out wrong.
 *
 * The empty-means-null rule on points is the load-bearing one. Null is "no
 * point value set" and zero is "worth zero points" — different facts, and
 * collapsing them would make every assignment created before this migration
 * look deliberately worthless.
 */

export const MAX_INSTRUCTIONS = 5000;

export type AssignmentFieldError =
  | "instructions_too_long"
  | "points_not_a_number"
  | "points_negative";

export type FieldVerdict<T> =
  | { ok: true; value: T }
  | { ok: false; code: AssignmentFieldError; message: string };

/**
 * The student-facing brief. Empty is legitimate — an assignment can carry a
 * PDF instead, or nothing at all.
 */
export function normalizeInstructions(raw: string): FieldVerdict<string> {
  const value = raw.trim();
  if (value.length > MAX_INSTRUCTIONS) {
    return {
      ok: false,
      code: "instructions_too_long",
      message: `Instructions can be up to ${MAX_INSTRUCTIONS.toLocaleString()} characters — that's ${value.length.toLocaleString()}.`,
    };
  }
  return { ok: true, value };
}

/** What the assignment is worth. Null = not set; zero = worth zero. */
export function normalizePoints(
  raw: string | number | null | undefined
): FieldVerdict<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: true, value: null };
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      code: "points_not_a_number",
      message:
        "Points has to be a number — leave it blank if the assignment isn't worth points.",
    };
  }
  if (parsed < 0) {
    return {
      ok: false,
      code: "points_negative",
      message: "Points can't be negative.",
    };
  }

  // -0 passes both checks above and is a nuisance downstream.
  return { ok: true, value: parsed === 0 ? 0 : parsed };
}
