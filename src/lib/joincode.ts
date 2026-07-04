/**
 * Short, human-typable join codes like "MKT-7Q2X".
 * Alphabet omits easily-confused characters (0/O, 1/I/L).
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomChars(length: number): string {
  let out = "";
  const values = new Uint32Array(length);
  // crypto is available in Node 20+ and all browsers
  globalThis.crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) {
    out += ALPHABET[values[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Generate a join code with an optional course-name-derived prefix,
 * e.g. "Marketing Research" -> "MAR-7Q2X".
 */
export function generateJoinCode(courseName?: string): string {
  const prefix = (courseName ?? "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const suffix = randomChars(4);
  return prefix.length === 3 ? `${prefix}-${suffix}` : `CLS-${suffix}`;
}

export function isValidJoinCodeFormat(code: string): boolean {
  return /^[A-Z]{3}-[2-9A-HJKMNP-Z]{4}$/.test(code.trim().toUpperCase());
}

/** Normalize user input: trim, uppercase. */
export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}
