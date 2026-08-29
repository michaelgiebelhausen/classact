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
 * The given name to address someone by — the mirror of lastNameOf, handling
 * the same registrar shapes:
 *
 * - "Robert Smith" → "Robert"
 * - "Smith, Robert" → "Robert" (comma-first exports)
 * - "Mary Jane Watson" → "Mary" (first token is the given name)
 * - "jsmith" → "jsmith" (a single token is all we have)
 */
export function firstNameOf(fullName: string): string {
  return splitName(fullName).first;
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
 * The name to show the whole class for one enrollment.
 *
 * A name the person set on their own profile (`profileName`) wins over the
 * roster's — a student who edits their name is choosing what the class calls
 * them, and that choice beats both a registrar name imported from Canvas and
 * the email address a course-code join leaves behind. The professor's roster
 * and gradebook still read the raw `roster_name`, so the registrar spelling is
 * never lost; only the live seat map and name games follow the student's pick.
 *
 * A `profileName` that is itself an email is ignored (it is not a name anyone
 * chose to be called). Failing a usable profile name, a real roster name
 * stands as written, and an email-only roster row falls back to its local part
 * so the class is never handed a deliverable address.
 */
export function rosterDisplayName(
  rosterName: string,
  profileName?: string | null
): string {
  const chosen = profileName?.trim();
  if (chosen && !isEmailAddress(chosen)) return chosen;
  if (!isEmailAddress(rosterName)) return rosterName;
  return rosterName.slice(0, rosterName.indexOf("@"));
}

/**
 * Whether a roster name is really an email address — which is how a student
 * who joined by course code lands on the roster, having never been imported
 * with a registrar name.
 */
export function isEmailAddress(value: string): boolean {
  return value.indexOf("@") > 0 && /^\S+@\S+\.\S+$/.test(value.trim());
}

/** What one enrollment is called, in the two lengths the app shows. */
export interface ResolvedName {
  /** Full class-visible name: for lists where two Emmas must be told apart. */
  name: string;
  /** What a classmate is called to their face: seat labels, "pair up with". */
  firstName: string;
}

/**
 * Both names for one enrollment, from the roster row and the person's own
 * profile — the single place that decides what a classmate is called.
 *
 * `first_name` is its own profile column, so someone who files as
 * "Alvarez-Stratton, Anneliese" and goes by "Annie" is called Annie without
 * having to rewrite their full name. Failing that we take the given name out
 * of whatever `rosterDisplayName` settled on, which is where the guarantee
 * lives: a code-code joiner with no profile yet reads as their email's local
 * part, never as a deliverable address.
 *
 * An email typed into the profile's first-name field is ignored for the same
 * reason `rosterDisplayName` ignores one in `full_name` — nobody chose to be
 * called that, and it would walk an address straight back onto the seat map.
 */
export function resolveDisplayName(
  rosterName: string,
  profile?: { firstName?: string | null; fullName?: string | null } | null
): ResolvedName {
  const name = rosterDisplayName(rosterName, profile?.fullName ?? null);
  const chosen = profile?.firstName?.trim();
  return {
    name,
    firstName: chosen && !isEmailAddress(chosen) ? chosen : firstNameOf(name),
  };
}

/**
 * Split a self-entered name into given/family parts to pre-fill the profile
 * editor's two fields, for someone who has a `full_name` but no saved parts
 * yet. The last token is taken as the surname and everything before it as the
 * given name(s); a single token is all given name.
 *
 * Only ever a pre-fill guess — the moment the person saves the two fields,
 * those are stored authoritatively and this is never consulted for them again.
 * That is the point of storing the parts: a combined string can't be split
 * back reliably ("Mary Jane Watson"), so we guess once and then remember.
 */
export function splitForEditing(fullName: string): {
  first: string;
  last: string;
} {
  const tokens = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "" };
  if (tokens.length === 1) return { first: tokens[0], last: "" };
  return {
    first: tokens.slice(0, -1).join(" "),
    last: tokens[tokens.length - 1],
  };
}

/** Compose the canonical `full_name` the rest of the app reads from the two
 *  edited parts. A blank part simply drops out, so a mononym stays a mononym. */
export function composeFullName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}
