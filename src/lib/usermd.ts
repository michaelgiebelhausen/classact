/**
 * The Markdown file a person attaches to their own profile.
 *
 * Any account can have one — student or professor. It is uploaded, replaced by
 * uploading again, and never edited in the app: the file on their machine
 * stays the original, which is the point of letting them bring one rather than
 * typing into a box.
 *
 * Stored as text rather than a stored object, because it is small, and because
 * whatever eventually reads it will want the text and not a download URL.
 */

/**
 * 64 KiB. A page or two of prose is a few kilobytes, so this is generous for
 * anything anyone would hand-write, while still far too small to be a smuggled
 * binary or a pasted database.
 */
export const MAX_USER_DOC_BYTES = 64 * 1024;

export interface UserDocInput {
  filename: string;
  content: string;
}

export type UserDocVerdict = { ok: true } | { ok: false; error: string };

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function validateUserDoc(doc: UserDocInput): UserDocVerdict {
  const name = doc.filename.trim();

  // A filename here is a label, never a path. Anything with a separator is
  // either an accident or someone trying their luck.
  if (!name || /[\/]/.test(name)) {
    return { ok: false, error: "That filename doesn't look right." };
  }
  if (!/\.md$/i.test(name)) {
    return { ok: false, error: "That needs to be a Markdown file (.md)." };
  }
  if (doc.content.trim().length === 0) {
    return { ok: false, error: "That file is empty." };
  }
  // A .md extension says nothing about what's inside. Null bytes mean it isn't
  // text, whatever it's called.
  if (doc.content.includes("\u0000")) {
    return {
      ok: false,
      error: "That file isn't plain text — Markdown only, please.",
    };
  }
  // Bytes, not characters: an emoji is four bytes, so a character-counted cap
  // would let a file four times the size through.
  const bytes = byteLength(doc.content);
  if (bytes > MAX_USER_DOC_BYTES) {
    return {
      ok: false,
      error: `That file is too big — ${Math.ceil(bytes / 1024)} KB, and the limit is ${MAX_USER_DOC_BYTES / 1024} KB.`,
    };
  }
  return { ok: true };
}
