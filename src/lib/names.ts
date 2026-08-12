/**
 * Sorting people the way a class list reads: by last name.
 *
 * Roster names arrive from Canvas or a CSV in whatever shape the registrar
 * uses, so this handles the common ones rather than assuming "First Last".
 */

/** Suffixes that are never the name we sort under. */
const SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "v",
  "md",
  "m.d.",
  "phd",
  "ph.d.",
]);

/**
 * The surname to file someone under.
 *
 * - "Emma Mabel Roethke" → "Roethke" (last token wins on middle names)
 * - "Roethke, Emma" → "Roethke" (registrar exports are already surname-first)
 * - "Martin Luther King Jr." → "King" (suffixes skipped)
 * - "Cher" → "Cher" (a single token is all we have)
 */
export function lastNameOf(fullName: string): string {
  const name = fullName.trim();
  if (!name) return "";
  // Already surname-first: everything before the comma is the surname.
  const comma = name.indexOf(",");
  if (comma > 0) return name.slice(0, comma).trim();

  const parts = name.split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!SUFFIXES.has(parts[i].toLowerCase())) return parts[i];
  }
  return parts[parts.length - 1] ?? name;
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

/** First character of a name part, or "" — Array.from keeps emoji/accents whole. */
function firstLetter(part: string): string {
  return Array.from(part.trim())[0] ?? "";
}

/**
 * Initials for a placeholder avatar when someone hasn't added a photo:
 * first name + last name, so "Emma Mabel Roethke" and "Roethke, Emma" both
 * give "ER". A single name gives one letter ("Cher" → "C").
 */
export function initialsOf(fullName: string): string {
  const name = fullName.trim();
  if (!name) return "?";

  const comma = name.indexOf(",");
  const last = comma > 0 ? name.slice(0, comma).trim() : lastNameOf(name);
  const first =
    comma > 0 ? name.slice(comma + 1).trim() : (name.split(/\s+/)[0] ?? "");

  const a = firstLetter(first);
  const b = firstLetter(last);
  if (a && b && first !== last) return (a + b).toUpperCase();
  return (a || b || "?").toUpperCase();
}

/** Copy of `people`, sorted by last name via `nameOf`. */
export function sortByLastName<T>(people: T[], nameOf: (p: T) => string): T[] {
  return [...people].sort((a, b) => compareByLastName(nameOf(a), nameOf(b)));
}
