import { describe, expect, test } from "vitest";
import { normalizeInstructions, normalizePoints } from "@/lib/assignmentfields";

describe("normalizeInstructions", () => {
  test("trims surrounding whitespace", () => {
    expect(normalizeInstructions("  write a brief  ")).toEqual({
      ok: true,
      value: "write a brief",
    });
  });

  test("treats empty input as empty, not an error", () => {
    expect(normalizeInstructions("   ")).toEqual({ ok: true, value: "" });
  });

  test("preserves paragraph breaks, which the student view renders", () => {
    const verdict = normalizeInstructions("First para.\n\nSecond para.");

    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.value).toBe("First para.\n\nSecond para.");
  });

  test("accepts exactly the maximum length", () => {
    expect(normalizeInstructions("x".repeat(5000)).ok).toBe(true);
  });

  test("refuses one character over the maximum", () => {
    const verdict = normalizeInstructions("x".repeat(5001));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("instructions_too_long");
  });

  test("measures length after trimming, not before", () => {
    expect(normalizeInstructions(`   ${"x".repeat(5000)}   `).ok).toBe(true);
  });
});

describe("normalizePoints", () => {
  test("an empty string means no value set, not zero", () => {
    expect(normalizePoints("")).toEqual({ ok: true, value: null });
  });

  test("whitespace also means no value set", () => {
    expect(normalizePoints("   ")).toEqual({ ok: true, value: null });
  });

  test("null and undefined mean no value set", () => {
    expect(normalizePoints(null)).toEqual({ ok: true, value: null });
    expect(normalizePoints(undefined)).toEqual({ ok: true, value: null });
  });

  test("accepts a whole number", () => {
    expect(normalizePoints("10")).toEqual({ ok: true, value: 10 });
  });

  test("accepts a fractional number — real gradebooks carry 4.25", () => {
    expect(normalizePoints("4.25")).toEqual({ ok: true, value: 4.25 });
  });

  test("accepts a number, not just a string", () => {
    expect(normalizePoints(3.5)).toEqual({ ok: true, value: 3.5 });
  });

  test("accepts zero as a real value, distinct from unset", () => {
    expect(normalizePoints("0")).toEqual({ ok: true, value: 0 });
  });

  test("normalises negative zero to zero", () => {
    const verdict = normalizePoints("-0");

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(Object.is(verdict.value, -0)).toBe(false);
    expect(verdict.value).toBe(0);
  });

  test("refuses text", () => {
    const verdict = normalizePoints("ten");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_not_a_number");
  });

  test("refuses infinity", () => {
    const verdict = normalizePoints("Infinity");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_not_a_number");
  });

  test("refuses a negative value", () => {
    const verdict = normalizePoints("-5");

    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.code).toBe("points_negative");
  });

  test("refusals carry a message the professor can act on", () => {
    const verdict = normalizePoints("-5");

    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.message.length).toBeGreaterThan(0);
  });
});
