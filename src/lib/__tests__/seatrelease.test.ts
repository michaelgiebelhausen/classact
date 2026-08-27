import { describe, expect, test } from "vitest";
import { canReleaseSeat } from "@/lib/seatrelease";

describe("canReleaseSeat", () => {
  test("frees an occupied seat during a live session", () => {
    expect(canReleaseSeat({ sessionOpen: true, occupied: true })).toEqual({
      allowed: true,
    });
  });

  test("refuses an empty seat", () => {
    const v = canReleaseSeat({ sessionOpen: true, occupied: false });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/nobody|empty/i);
  });

  test("refuses once class has ended", () => {
    // Attendance for a finished class is a record, not a live seating chart.
    const v = canReleaseSeat({ sessionOpen: false, occupied: true });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/ended|closed|over/i);
  });

  test("the closed session outranks an empty seat", () => {
    const v = canReleaseSeat({ sessionOpen: false, occupied: false });
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/ended|closed|over/i);
  });
});
