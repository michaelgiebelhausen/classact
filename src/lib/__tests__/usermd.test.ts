import { describe, expect, test } from "vitest";
import { validateUserDoc, MAX_USER_DOC_BYTES } from "@/lib/usermd";

const ok = { filename: "user.md", content: "# About me\n\nI like maps." };

describe("validateUserDoc", () => {
  test("accepts a small markdown file", () => {
    expect(validateUserDoc(ok)).toEqual({ ok: true });
  });

  test("accepts any .md name, not just user.md", () => {
    // The feature is called user.md but insisting on the exact name would
    // reject about-me.md for no reason.
    expect(validateUserDoc({ ...ok, filename: "about-me.MD" }).ok).toBe(true);
  });

  test("rejects a file that isn't markdown", () => {
    const v = validateUserDoc({ ...ok, filename: "resume.pdf" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected rejection");
    expect(v.error).toMatch(/markdown|\.md/i);
  });

  test("rejects a name with no extension at all", () => {
    expect(validateUserDoc({ ...ok, filename: "user" }).ok).toBe(false);
  });

  test("rejects an empty file", () => {
    const v = validateUserDoc({ ...ok, content: "   \n  " });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected rejection");
    expect(v.error).toMatch(/empty/i);
  });

  test("rejects a file past the size cap", () => {
    const v = validateUserDoc({ ...ok, content: "x".repeat(MAX_USER_DOC_BYTES + 1) });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected rejection");
    expect(v.error).toMatch(/big|large|size/i);
  });

  test("measures BYTES, not characters", () => {
    // An emoji is four bytes. A cap counted in characters would let a file
    // four times the intended size through.
    const emoji = "😀".repeat(MAX_USER_DOC_BYTES / 4);
    expect(new TextEncoder().encode(emoji).length).toBe(MAX_USER_DOC_BYTES);
    expect(validateUserDoc({ ...ok, content: emoji }).ok).toBe(true);
    expect(validateUserDoc({ ...ok, content: emoji + "😀" }).ok).toBe(false);
  });

  test("rejects content with null bytes", () => {
    // A renamed binary: .md on the outside, not text on the inside.
    const v = validateUserDoc({ ...ok, content: "hello\u0000world" });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected rejection");
    expect(v.error).toMatch(/text|binary/i);
  });

  test("rejects a path pretending to be a filename", () => {
    expect(validateUserDoc({ ...ok, filename: "../../etc/passwd.md" }).ok).toBe(
      false
    );
  });
});
