/**
 * What a student is allowed to hand in, decided before anything is uploaded.
 *
 * This exists because the previous rule was a fallthrough: anything that
 * wasn't recognised as Markdown or an image was labelled a PDF and stored as
 * `<uuid>.pdf` with `application/pdf`. A student picking `essay.docx` — the
 * single most likely thing a student picks — got a successful upload, a
 * "Submitted" toast, and a file the professor could not open. The analysis
 * pipeline then base64'd that "PDF" straight to a model. Nothing anywhere
 * said no.
 *
 * The `accept` attribute on the input is not a defence; every OS file dialog
 * offers "All files". So the check has to live here, and it has to refuse
 * rather than guess. A refusal a student can act on ("Word documents aren't
 * accepted — export as PDF first") costs them thirty seconds. A silent
 * mislabel costs them the grade.
 */

export const MAX_SUBMISSION_BYTES = 20 * 1024 * 1024;

export type SubmissionKind = "pdf" | "md" | "png" | "jpg";

export interface AcceptedFile {
  kind: SubmissionKind;
  /** Extension for the storage path — never derived from the filename. */
  ext: string;
  contentType: string;
}

export type SubmissionFileVerdict =
  | { ok: true; file: AcceptedFile }
  | { ok: false; code: "too_large" | "empty" | "unsupported"; message: string };

interface FileFacts {
  name: string;
  size: number;
  /** The browser's guess. Empty string is common and not an error. */
  type: string;
}

const ACCEPTED: Array<{
  kind: SubmissionKind;
  ext: string;
  contentType: string;
  extensions: string[];
  mimeTypes: string[];
}> = [
  {
    kind: "pdf",
    ext: "pdf",
    contentType: "application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
  },
  {
    kind: "md",
    ext: "md",
    contentType: "text/markdown",
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
  },
  {
    kind: "png",
    ext: "png",
    contentType: "image/png",
    extensions: [".png"],
    mimeTypes: ["image/png"],
  },
  {
    kind: "jpg",
    ext: "jpg",
    contentType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    mimeTypes: ["image/jpeg"],
  },
];

/** Things students actually try to submit, with the fix stated plainly. */
const KNOWN_REJECTIONS: Array<{ extensions: string[]; advice: string }> = [
  {
    extensions: [".doc", ".docx", ".odt", ".pages", ".rtf"],
    advice: "Word documents aren't accepted — export it as a PDF and upload that.",
  },
  {
    extensions: [".ppt", ".pptx", ".key"],
    advice: "Slide decks aren't accepted — export the deck as a PDF and upload that.",
  },
  {
    extensions: [".xls", ".xlsx", ".numbers", ".csv"],
    advice: "Spreadsheets aren't accepted — export it as a PDF and upload that.",
  },
  {
    extensions: [".zip", ".rar", ".7z", ".tar", ".gz"],
    advice:
      "Archives aren't accepted — one file only, so combine the parts into a single PDF.",
  },
  {
    extensions: [".txt"],
    advice:
      "Plain text isn't accepted — rename it to .md if it's Markdown, or export a PDF.",
  },
  {
    extensions: [".heic", ".heif"],
    advice:
      "iPhone HEIC photos aren't accepted — share it as a JPEG, or export a PDF.",
  },
  {
    extensions: [".gif", ".webp", ".bmp", ".tiff", ".tif", ".svg"],
    advice: "That image format isn't accepted — use PNG or JPEG, or export a PDF.",
  },
];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Decide whether this file can be submitted, and under what content type.
 *
 * Extension and MIME type are both consulted, because neither is reliable
 * alone: browsers report an empty `type` for Markdown often enough that
 * requiring it would reject legitimate work, and a MIME type alone doesn't
 * survive a rename. Agreement on either is enough; agreement on neither is
 * a refusal.
 */
export function classifySubmissionFile(file: FileFacts): SubmissionFileVerdict {
  if (file.size > MAX_SUBMISSION_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: "Keep your file under 20 MB.",
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      code: "empty",
      message: "That file is empty — check you picked the right one.",
    };
  }

  const ext = extensionOf(file.name);
  const mime = file.type.trim().toLowerCase();

  for (const candidate of ACCEPTED) {
    if (candidate.extensions.includes(ext) || candidate.mimeTypes.includes(mime)) {
      return {
        ok: true,
        file: {
          kind: candidate.kind,
          ext: candidate.ext,
          contentType: candidate.contentType,
        },
      };
    }
  }

  const known = KNOWN_REJECTIONS.find((r) => r.extensions.includes(ext));
  return {
    ok: false,
    code: "unsupported",
    message:
      known?.advice ??
      "That file type isn't accepted — submit a PDF, Markdown (.md), PNG, or JPEG.",
  };
}
