import { describe, expect, test } from "vitest";
import { seatMoveOutcome } from "@/lib/seatmove";

const base = {
  sessionOpen: true,
  hasCheckIn: true,
  targetIsCurrentSeat: false,
  targetOccupied: false,
};

describe("seatMoveOutcome", () => {
  test("allows a checked-in student to move to a free seat", () => {
    expect(seatMoveOutcome(base)).toEqual({ allowed: true });
  });

  test("refuses when the seat is already taken", () => {
    const verdict = seatMoveOutcome({ ...base, targetOccupied: true });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.code).toBe("seat_taken");
  });

  test("refuses a move onto the seat they already occupy", () => {
    const verdict = seatMoveOutcome({ ...base, targetIsCurrentSeat: true });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.code).toBe("same_seat");
  });

  test("refuses when the student has not checked in yet", () => {
    // Not a move — that's a first check-in, and it goes through checkIn so the
    // networking point and absence-flagging happen.
    const verdict = seatMoveOutcome({ ...base, hasCheckIn: false });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.code).toBe("not_checked_in");
  });

  test("refuses once the session is closed", () => {
    const verdict = seatMoveOutcome({ ...base, sessionOpen: false });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.code).toBe("no_session");
  });

  test("reports the closed session ahead of a taken seat", () => {
    // Both wrong at once: telling someone to "pick another seat" when class
    // is over sends them hunting for a free seat that will never work.
    const verdict = seatMoveOutcome({
      ...base,
      sessionOpen: false,
      targetOccupied: true,
    });

    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.code).toBe("no_session");
  });
});
