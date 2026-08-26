import { describe, expect, test } from "vitest";
import { canResolveDuplicate } from "@/lib/duplicateresolve";

describe("canResolveDuplicate", () => {
  test("resolves a shadow row that holds no attendance", () => {
    expect(
      canResolveDuplicate({ hasTwin: true, shadowCheckIns: 0 })
    ).toEqual({ allowed: true });
  });

  test("refuses when the shadow holds check-ins", () => {
    // 22 tables cascade off enrollments. Every duplicate resolved by hand had
    // zero check-ins, but the one that doesn't is exactly the one that must
    // not be deleted — the student did their attending under this row.
    const v = canResolveDuplicate({ hasTwin: true, shadowCheckIns: 3 });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/check-?in/i);
  });

  test("refuses when there is no other row for this student", () => {
    // Without a surviving twin this isn't a duplicate, it's their only
    // enrolment, and removing it takes them out of the class.
    const v = canResolveDuplicate({ hasTwin: false, shadowCheckIns: 0 });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/only|other row|no .*row/i);
  });

  test("missing twin outranks the check-in count", () => {
    // Both wrong: report the one that means "this is not a duplicate at all".
    const v = canResolveDuplicate({ hasTwin: false, shadowCheckIns: 5 });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/only|other row|no .*row/i);
  });
});
