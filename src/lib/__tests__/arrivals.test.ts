import { describe, expect, it } from "vitest";

import {
  adjacentRelation,
  decideArrivalToast,
  isSocialMode,
  socialModeEndsAt,
  type ArrivalContext,
  type ArrivalSeat,
} from "@/lib/arrivals";

// A tiny row: A1 — A2 — A3, with B2 behind A2.
const seats: ArrivalSeat[] = [
  { id: "s-a1", label: "A1", neighbors: { right: "A2" } },
  { id: "s-a2", label: "A2", neighbors: { left: "A1", right: "A3", back: "B2" } },
  { id: "s-a3", label: "A3", neighbors: { left: "A2" } },
  { id: "s-b2", label: "B2", neighbors: { front: "A2" } },
];

function ctx(overrides: Partial<ArrivalContext> = {}): ArrivalContext {
  return {
    myEnrollmentId: "me",
    mySeatId: "s-a2",
    seats,
    metBeforeIds: new Set(),
    confirmedIds: new Set(),
    toastedIds: new Set(),
    social: true,
    ...overrides,
  };
}

describe("adjacentRelation", () => {
  it("reads the relation from my seat's persisted links", () => {
    expect(adjacentRelation(seats[1], seats[0])).toBe("left");
    expect(adjacentRelation(seats[1], seats[2])).toBe("right");
    expect(adjacentRelation(seats[1], seats[3])).toBe("back");
  });

  it("returns null for non-neighbors and missing seats", () => {
    expect(adjacentRelation(seats[0], seats[2])).toBeNull();
    expect(adjacentRelation(undefined, seats[0])).toBeNull();
    expect(adjacentRelation(seats[0], undefined)).toBeNull();
  });
});

describe("decideArrivalToast", () => {
  it("toasts a first-ever neighbor sitting down beside me", () => {
    const decision = decideArrivalToast(ctx(), {
      enrollmentId: "them",
      seatId: "s-a1",
    });
    expect(decision).toEqual({ toast: true, enrollmentId: "them", relation: "left" });
  });

  it("stays silent after the scheduled start — quiet mode is literal", () => {
    const decision = decideArrivalToast(ctx({ social: false }), {
      enrollmentId: "them",
      seatId: "s-a1",
    });
    expect(decision).toEqual({ toast: false, reason: "quiet_mode" });
  });

  it("never toasts someone who isn't seated yet", () => {
    const decision = decideArrivalToast(ctx({ mySeatId: null }), {
      enrollmentId: "them",
      seatId: "s-a1",
    });
    expect(decision).toEqual({ toast: false, reason: "not_seated" });
  });

  it("ignores my own check-in echoing back over realtime", () => {
    const decision = decideArrivalToast(ctx(), {
      enrollmentId: "me",
      seatId: "s-a2",
    });
    expect(decision).toEqual({ toast: false, reason: "own_checkin" });
  });

  it("ignores arrivals beyond my adjacent seats", () => {
    const decision = decideArrivalToast(ctx({ mySeatId: "s-a1" }), {
      enrollmentId: "them",
      seatId: "s-a3",
    });
    expect(decision).toEqual({ toast: false, reason: "not_adjacent" });
  });

  it("someone I've met in a past session gets the quiet card row, not a toast", () => {
    const decision = decideArrivalToast(
      ctx({ metBeforeIds: new Set(["them"]) }),
      { enrollmentId: "them", seatId: "s-a1" }
    );
    expect(decision).toEqual({ toast: false, reason: "met_before" });
  });

  it("someone I've already confirmed this session never re-toasts", () => {
    const decision = decideArrivalToast(
      ctx({ confirmedIds: new Set(["them"]) }),
      { enrollmentId: "them", seatId: "s-a1" }
    );
    expect(decision).toEqual({ toast: false, reason: "already_confirmed" });
  });

  it("one toast per neighbor per mount — reconnect redelivery stays quiet", () => {
    const decision = decideArrivalToast(
      ctx({ toastedIds: new Set(["them"]) }),
      { enrollmentId: "them", seatId: "s-a1" }
    );
    expect(decision).toEqual({ toast: false, reason: "already_toasted" });
  });
});

describe("socialModeEndsAt / isSocialMode", () => {
  const start = "2026-08-28T14:00:00.000Z";

  it("a scheduled course ends social mode at the scheduled minute, sharp", () => {
    const endsAt = socialModeEndsAt(start, null);
    expect(endsAt?.toISOString()).toBe(start);
    expect(isSocialMode(endsAt, new Date("2026-08-28T13:59:59.999Z"))).toBe(true);
    expect(isSocialMode(endsAt, new Date("2026-08-28T14:00:00.000Z"))).toBe(false);
  });

  it("without a schedule, a bounded window follows the session opening", () => {
    const endsAt = socialModeEndsAt(null, start);
    expect(endsAt?.toISOString()).toBe("2026-08-28T14:15:00.000Z");
  });

  it("the scheduled start wins over opened_at when both exist", () => {
    const endsAt = socialModeEndsAt(start, "2026-08-28T13:00:00.000Z");
    expect(endsAt?.toISOString()).toBe(start);
  });

  it("no boundary at all means quiet — never toast into an unknown room", () => {
    expect(socialModeEndsAt(null, null)).toBeNull();
    expect(isSocialMode(null, new Date())).toBe(false);
  });

  it("garbage timestamps degrade to quiet, not to an exception", () => {
    expect(socialModeEndsAt("not a date", null)).toBeNull();
    expect(socialModeEndsAt(null, "not a date")).toBeNull();
  });
});
