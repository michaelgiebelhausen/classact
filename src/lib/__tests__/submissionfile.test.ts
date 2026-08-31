import { describe, expect, test } from "vitest";
import {
  classifySubmissionFile,
  deliverableAccept,
  MAX_SUBMISSION_BYTES,
} from "@/lib/submissionfile";

const file = (name: string, type = "", size = 1024) => ({ name, size, type });

describe("classifySubmissionFile — accepting real work", () => {
  test("accepts a PDF by extension", () => {
    const verdict = classifySubmissionFile(file("report.pdf"));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.file.contentType).toBe("application/pdf");
    expect(verdict.file.ext).toBe("pdf");
  });

  test("accepts a PDF by mime type when the name has no extension", () => {
    const verdict = classifySubmissionFile(file("report", "application/pdf"));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.file.kind).toBe("pdf");
  });

  test("accepts Markdown even when the browser reports no mime type", () => {
    const verdict = classifySubmissionFile(file("notes.md", ""));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.file.contentType).toBe("text/markdown");
  });

  test("accepts .markdown as well as .md", () => {
    expect(classifySubmissionFile(file("notes.markdown")).ok).toBe(true);
  });

  test("accepts PNG and both JPEG extensions", () => {
    expect(classifySubmissionFile(file("shot.png")).ok).toBe(true);
    expect(classifySubmissionFile(file("shot.jpg")).ok).toBe(true);
    expect(classifySubmissionFile(file("shot.jpeg")).ok).toBe(true);
  });

  test("normalises .jpeg to a jpg extension so paths stay predictable", () => {
    const verdict = classifySubmissionFile(file("shot.jpeg"));

    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.file.ext).toBe("jpg");
    expect(verdict.file.contentType).toBe("image/jpeg");
  });

  test("ignores case in the extension", () => {
    expect(classifySubmissionFile(file("REPORT.PDF")).ok).toBe(true);
  });

  test("uses the last extension, not the first", () => {
    // A file genuinely named this way is a PDF, not a Word document.
    expect(classifySubmissionFile(file("my.docx.pdf")).ok).toBe(true);
  });
});

describe("classifySubmissionFile — refusing what would corrupt", () => {
  test("refuses a Word document instead of relabelling it a PDF", () => {
    const verdict = classifySubmissionFile(file("essay.docx"));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("unsupported");
    expect(verdict.message).toContain("PDF");
  });

  test("refuses .doc, .pages and .rtf the same way", () => {
    for (const name of ["essay.doc", "essay.pages", "essay.rtf"]) {
      expect(classifySubmissionFile(file(name)).ok).toBe(false);
    }
  });

  test("refuses slide decks with advice to export a PDF", () => {
    const verdict = classifySubmissionFile(file("deck.pptx"));

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message).toContain("PDF");
  });

  test("refuses an archive, pointing at the one-file rule", () => {
    const verdict = classifySubmissionFile(file("everything.zip"));

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message).toContain("one file");
  });

  test("refuses a HEIC photo from an iPhone", () => {
    expect(classifySubmissionFile(file("IMG_0042.HEIC")).ok).toBe(false);
  });

  test("refuses an unknown extension with generic guidance", () => {
    const verdict = classifySubmissionFile(file("thing.xyz"));

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("unsupported");
    expect(verdict.message).toContain("PDF");
  });

  test("refuses a file with no extension and no mime type", () => {
    expect(classifySubmissionFile(file("homework")).ok).toBe(false);
  });

  test("a misleading mime type cannot smuggle in a Word document", () => {
    // Extension says .docx; nothing in ACCEPTED matches it, and the mime
    // type is the real Word one, so both signals agree on refusal.
    const verdict = classifySubmissionFile(
      file(
        "essay.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    );

    expect(verdict.ok).toBe(false);
  });
});

describe("classifySubmissionFile — a declared deliverable type", () => {
  test("no declared type accepts every supported shape (unchanged)", () => {
    expect(classifySubmissionFile(file("report.pdf")).ok).toBe(true);
    expect(classifySubmissionFile(file("shot.png"), "any").ok).toBe(true);
    expect(classifySubmissionFile(file("report.pdf"), "any").ok).toBe(true);
  });

  test("image required: accepts a PNG/JPG", () => {
    expect(classifySubmissionFile(file("shot.png"), "image").ok).toBe(true);
    expect(classifySubmissionFile(file("shot.jpg"), "image").ok).toBe(true);
  });

  test("image required: refuses a valid PDF, naming the fix", () => {
    const verdict = classifySubmissionFile(file("report.pdf"), "image");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("unsupported");
    expect(verdict.message).toContain("screenshot");
  });

  test("pdf required: refuses a PNG, naming the fix", () => {
    const verdict = classifySubmissionFile(file("shot.png"), "pdf");

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message).toContain("PDF");
  });

  test("md required: refuses a PDF", () => {
    expect(classifySubmissionFile(file("report.pdf"), "md").ok).toBe(false);
  });

  test("a declared type overrides generic advice on an unsupported file", () => {
    // A .docx under an image assignment should point at the image, not "export a PDF".
    const verdict = classifySubmissionFile(file("essay.docx"), "image");

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message).toContain("screenshot");
  });

  test("size is still checked before the declared type", () => {
    const verdict = classifySubmissionFile(
      file("report.pdf", "application/pdf", MAX_SUBMISSION_BYTES + 1),
      "image"
    );

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("too_large");
  });

  test("deliverableAccept narrows the picker to the declared type", () => {
    expect(deliverableAccept("image")).not.toContain("pdf");
    expect(deliverableAccept("pdf")).toContain("application/pdf");
    expect(deliverableAccept("any")).toContain("image/png");
    expect(deliverableAccept()).toContain("application/pdf");
  });
});

describe("classifySubmissionFile — size", () => {
  test("refuses a file over 20 MB", () => {
    const verdict = classifySubmissionFile(
      file("huge.pdf", "application/pdf", MAX_SUBMISSION_BYTES + 1)
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("too_large");
  });

  test("accepts a file at exactly the limit", () => {
    expect(
      classifySubmissionFile(
        file("big.pdf", "application/pdf", MAX_SUBMISSION_BYTES)
      ).ok
    ).toBe(true);
  });

  test("refuses an empty file", () => {
    const verdict = classifySubmissionFile(file("empty.pdf", "application/pdf", 0));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("empty");
  });

  test("checks size before type, so a huge .docx says what's actually wrong first", () => {
    const verdict = classifySubmissionFile(
      file("essay.docx", "", MAX_SUBMISSION_BYTES + 1)
    );

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("too_large");
  });
});
