export interface IcebreakerField {
  key: string;
  label: string;
  prompt: string;
  placeholder: string;
  multiline: boolean;
  /** zod-ish lightweight validation hint applied in the form */
  kind: "text" | "url";
  /**
   * Whether this answer works as a memory hook on the flash-card back (a short,
   * factual detail — hometown, major). Excludes guessing games like "two truths
   * and a lie" (a spoiler) and links like a Spotify URL (not a hook).
   */
  flashcardHint: boolean;
}

/** The catalog professors pick from (courses.icebreaker_fields stores keys). */
export const ICEBREAKER_CATALOG: IcebreakerField[] = [
  {
    key: "two_truths_and_a_lie",
    label: "Two truths and a lie",
    prompt: "Give us two truths and a lie — don't say which is which.",
    placeholder: "1) ... 2) ... 3) ...",
    multiline: true,
    kind: "text",
    flashcardHint: false, // it's a guessing game — would spoil it
  },
  {
    key: "first_job",
    label: "First job",
    prompt: "What was your first job, and what did it teach you?",
    placeholder: "Lifeguard — taught me to stay calm when everyone panics.",
    multiline: true,
    kind: "text",
    flashcardHint: true,
  },
  {
    key: "spotify_url",
    label: "Spotify playlist",
    prompt: "Link a playlist that says something about you.",
    placeholder: "https://open.spotify.com/playlist/...",
    multiline: false,
    kind: "url",
    flashcardHint: false, // a link isn't a memory hook
  },
  {
    key: "hometown",
    label: "Hometown",
    prompt: "Where do you call home?",
    placeholder: "Greenville, SC",
    multiline: false,
    kind: "text",
    flashcardHint: true,
  },
  {
    key: "major",
    label: "Major",
    prompt: "What are you studying?",
    placeholder: "Marketing",
    multiline: false,
    kind: "text",
    flashcardHint: true,
  },
  {
    key: "fun_fact",
    label: "Fun fact",
    prompt: "One thing about you most people don't know.",
    placeholder: "I've been to 14 national parks.",
    multiline: true,
    kind: "text",
    flashcardHint: true,
  },
];

export const DEFAULT_ICEBREAKER_KEYS = [
  "two_truths_and_a_lie",
  "first_job",
  "fun_fact",
];

export function icebreakersByKey(keys: string[]): IcebreakerField[] {
  return ICEBREAKER_CATALOG.filter((f) => keys.includes(f.key));
}

/**
 * The course's icebreaker fields that are eligible as a flash-card hook, in
 * catalog order. The games page picks the first of these a student answered.
 */
export function flashcardHintFields(courseKeys: string[]): IcebreakerField[] {
  return ICEBREAKER_CATALOG.filter(
    (f) => f.flashcardHint && courseKeys.includes(f.key)
  );
}
