import { describe, expect, it } from "vitest";

import {
  denySentence,
  deriveSeatRing,
  relationPhrase,
} from "@/lib/seatrings";

const base = {
  verified: false,
  professorConfirmed: false,
  deniedCount: 0,
  hasOccupiedAdjacentSeat: true,
};

describe("deriveSeatRing", () => {
  it("is red the moment someone checks in with neighbors around", () => {
    expect(deriveSeatRing(base)).toBe("unconfirmed");
  });

  it("is amber when nobody adjacent could possibly vouch", () => {
    expect(
      deriveSeatRing({ ...base, hasOccupiedAdjacentSeat: false })
    ).toBe("unconfirmable");
  });

  it("greens on a peer confirmation", () => {
    expect(deriveSeatRing({ ...base, verified: true })).toBe("confirmed");
  });

  it("greens on a professor confirmation alone", () => {
    expect(deriveSeatRing({ ...base, professorConfirmed: true })).toBe(
      "confirmed"
    );
  });

  it("a confirmed loner stays green, not amber", () => {
    expect(
      deriveSeatRing({
        ...base,
        verified: true,
        hasOccupiedAdjacentSeat: false,
      })
    ).toBe("confirmed");
  });

  // The DB resolves all active denials inside every confirmation, so an
  // active denial is by construction newer than the last confirm — it must
  // outrank green, or a fresh dispute would hide behind an old vouch.
  it("an active denial outranks every confirmation", () => {
    expect(
      deriveSeatRing({
        ...base,
        verified: true,
        professorConfirmed: true,
        deniedCount: 1,
      })
    ).toBe("denied");
  });

  it("denial outranks amber too — a report is information, isolation is not", () => {
    expect(
      deriveSeatRing({
        ...base,
        deniedCount: 2,
        hasOccupiedAdjacentSeat: false,
      })
    ).toBe("denied");
  });
});

describe("relationPhrase", () => {
  it("speaks from the viewer's seat about a neighbor", () => {
    expect(relationPhrase("front", "theirs")).toBe("in front of you");
    expect(relationPhrase("back", "theirs")).toBe("behind you");
    expect(relationPhrase("left", "theirs")).toBe("to your left");
    expect(relationPhrase("right", "theirs")).toBe("to your right");
  });

  it("speaks in first person for the deny sentence", () => {
    expect(relationPhrase("front", "mine")).toBe("in front of me");
    expect(relationPhrase("back", "mine")).toBe("behind me");
    expect(relationPhrase("left", "mine")).toBe("to my left");
    expect(relationPhrase("right", "mine")).toBe("to my right");
  });
});

describe("denySentence", () => {
  it("reads exactly as the reporter would say it", () => {
    expect(denySentence("Alex", "left")).toBe(
      "Alex is not in the seat to my left."
    );
    expect(denySentence("Priya", "front")).toBe(
      "Priya is not in the seat in front of me."
    );
  });
});
