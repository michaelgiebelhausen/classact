/**
 * Sorting people the way a class list reads: by last name.
 *
 * Roster names arrive from Canvas or a CSV in whatever shape the registrar
 * uses, so this handles the common ones rather than assuming "First Last".
 */

/**
 * Suffixes that are never the name we sort under.
 *
 * Deliberately no bare "V": a lone "V" is far more often a surname recorded
 * as an initial (common in South Indian names — "Anand V") than a fifth-
 * generation namesake, and swallowing it files the student under their
 * given name.
 */
const SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "md",
  "m.d.",
  "phd",
  "ph.d.",
]);

/**
 * Particles that belong to the surname that follows them, so "Aad van der
 * Berg" files under V like "Van Der Berg, Aad" does — the same person can
 * arrive in either spelling from different exports.
 */
const PARTICLES = new Set([
  "van",
  "von",
  "de",
  "del",
  "della",
  "der",
  "den",
  "di",
  "da",
  "dal",
  "dos",
  "das",
  "du",
  "la",
  "le",
  "lo",
  "el",
  "al",
  "bin",
  "ibn",
  "ter",
  "ten",
]);

interface NameParts {
  /** Given name, empty when the source only gave us a surname. */
  first: string;
  last: string;
}

/** Drop trailing suffix tokens: "King Jr." → "King". */
function stripSuffixes(part: string): string {
  const tokens = part.split(/\s+/).filter(Boolean);
  let end = tokens.length - 1;
  while (end > 0 && SUFFIXES.has(tokens[end].toLowerCase())) end--;
  return tokens.slice(0, end + 1).join(" ");
}

/** A comma-separated field that is nothing but a suffix, as in "Last, Jr., First". */
function isSuffixOnly(part: string): boolean {
  const tokens = part.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => SUFFIXES.has(t.toLowerCase()));
}

/** "Aad van der Berg" → { first: "Aad", last: "van der Berg" }. */
function splitSpaced(name: string): NameParts {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "" };
  if (tokens.length === 1) return { first: tokens[0], last: tokens[0] };

  let end = tokens.length - 1;
  while (end > 0 && SUFFIXES.has(tokens[end].toLowerCase())) end--;
  // Absorb particles, but never the first token — that's the given name.
  let start = end;
  while (start > 1 && PARTICLES.has(tokens[start - 1].toLowerCase())) start--;

  return { first: tokens[0], last: tokens.slice(start, end + 1).join(" ") };
}

/**
 * Split a roster name into the parts we file and label by, handling the
 * shapes registrars actually export — including "Last, Suffix, First".
 */
function splitName(fullName: string): NameParts {
  const name = fullName.trim();
  if (!name) return { first: "", last: "" };

  if (name.includes(",")) {
    const parts = name
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return { first: "", last: "" };
    const last = stripSuffixes(parts[0]);
    // "Roethke, Jr., Emma" — the given name is the first part that isn't
    // itself a suffix.
    const first = parts.slice(1).find((p) => !isSuffixOnly(p)) ?? "";
    if (last) return { first, last };
  }

  return splitSpaced(name);
}

/**
 * The surname to file someone under.
 *
 * - "Emma Mabel Roethke" → "Roethke" (last token wins on middle names)
 * - "Roethke, Emma" → "Roethke" (registrar exports are already surname-first)
 * - "Martin Luther King Jr." → "King" (suffixes skipped, either spelling)
 * - "Aad van der Berg" → "van der Berg" (particles come along)
 * - "Anand V" → "V" (a single-letter surname is a surname)
 * - "Cher" → "Cher" (a single token is all we have)
 */
export function lastNameOf(fullName: string): string {
  return splitName(fullName).last;
}

/**
 * Alphabetical by last name, then by the whole name so people who share a
 * surname stay in a stable, sensible order. Case- and accent-insensitive,
 * so "de Souza" and "De Souza" file together.
 */
export function compareByLastName(a: string, b: string): number {
  const surname = lastNameOf(a).localeCompare(lastNameOf(b), undefined, {
    sensitivity: "base",
  });
  if (surname !== 0) return surname;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * First actual letter (or digit) of a name part, or "" — skips punctuation
 * so "O'Brien" gives O and a stray "-" gives nothing to draw.
 */
function firstLetter(part: string): string {
  for (const ch of part.trim()) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch;
  }
  return "";
}

/**
 * Initials for a placeholder avatar when someone hasn't added a photo:
 * first name + last name, so "Emma Mabel Roethke" and "Roethke, Emma" both
 * give "ER". A single name gives one letter ("Cher" → "C"), and anything
 * with no letters in it gives "?" rather than rendering punctuation.
 */
export function initialsOf(fullName: string): string {
  const { first, last } = splitName(fullName);
  const a = firstLetter(first);
  const b = firstLetter(last);
  if (a && b && first !== last) return (a + b).toUpperCase();
  return (a || b || "?").toUpperCase();
}

/** Copy of `people`, sorted by last name via `nameOf`. */
export function sortByLastName<T>(people: T[], nameOf: (p: T) => string): T[] {
  return [...people].sort((a, b) => compareByLastName(nameOf(a), nameOf(b)));
}

/**
 * A roster name safe to show the whole class.
 *
 * Off-roster joiners get `roster_name` defaulted to their email address (see
 * app/auth/join/route.ts), and the check-in directory is serialized into every
 * course member's browser — so the raw value would hand the class a
 * deliverable address for anyone who joined by code without a profile name.
 * The local part still identifies them on the seat map without publishing the
 * address. Anything that isn't an address is returned untouched.
 */
export function rosterDisplayName(rosterName: string): string {
  const at = rosterName.indexOf("@");
  if (at <= 0) return rosterName;
  return /^\S+@\S+\.\S+$/.test(rosterName.trim())
    ? rosterName.slice(0, at)
    : rosterName;
}
