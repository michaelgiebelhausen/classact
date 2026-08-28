import { describe, expect, it } from "vitest";
import {
  decideNavigation,
  nextStageAction,
  STAGE_CHIP,
  type NavInput,
  type NavQuestion,
} from "@/lib/presenternav";

/**
 * These tests exist because of a specific bad afternoon: a question queued on
 * a slide took over the projector without being asked, and then every arrow
 * press did nothing at all. The professor ended the lecture to get out.
 *
 * So the cases below are less about coverage than about promises — a question
 * is never run without a click, and there is always a way forward.
 */

const QUESTION: NavQuestion = { id: "q1", positionAfterPage: 4 };

function nav(overrides: Partial<NavInput> = {}) {
  const base: NavInput = {
    requested: 5,
    current: 4,
    totalPages: 20,
    pollOpen: false,
    busy: false,
    offerArmedAt: null,
    skipped: new Set<number>(),
    ran: new Set<string>(),
    questions: [QUESTION],
  };
  return decideNavigation({ ...base, ...overrides });
}

describe("decideNavigation — the incident", () => {
  it("offers a queued question instead of launching it", () => {
    // The whole bug in one assertion: crossing slide 4 must ask, not seize.
    expect(nav()).toEqual({
      kind: "offer",
      position: 4,
      questionIds: ["q1"],
    });
  });

  it("lets a second press walk past the question", () => {
    // The escape valve. A professor hammering the arrow key always moves on.
    expect(nav({ offerArmedAt: 4 })).toEqual({
      kind: "advance",
      page: 5,
      crossedPosition: 4,
    });
  });

  it("stops offering a boundary the professor already walked past", () => {
    expect(nav({ skipped: new Set([4]) })).toEqual({
      kind: "advance",
      page: 5,
      crossedPosition: null,
    });
  });

  it("never offers a question that already ran", () => {
    // Launching from the menu marks it ran; it must not ambush them later.
    expect(nav({ ran: new Set(["q1"]) })).toEqual({
      kind: "advance",
      page: 5,
      crossedPosition: null,
    });
  });
});

describe("decideNavigation — a poll owns the room", () => {
  it("blocks every direction while a poll is open", () => {
    for (const requested of [1, 3, 4, 5, 12, 99]) {
      expect(nav({ pollOpen: true, requested })).toEqual({
        kind: "blocked",
        reason: "poll",
      });
    }
  });

  it("reports the poll, not the clamp, when both would apply", () => {
    expect(nav({ pollOpen: true, requested: 999 })).toEqual({
      kind: "blocked",
      reason: "poll",
    });
  });

  it("blocks while a launch is in flight", () => {
    expect(nav({ busy: true })).toEqual({ kind: "blocked", reason: "busy" });
  });

  it("prefers the poll reason over busy", () => {
    expect(nav({ pollOpen: true, busy: true })).toEqual({
      kind: "blocked",
      reason: "poll",
    });
  });
});

describe("decideNavigation — only a single step forward can offer", () => {
  it("goes back without offering", () => {
    expect(nav({ requested: 3 })).toEqual({
      kind: "advance",
      page: 3,
      crossedPosition: null,
    });
  });

  it("jumps forward past a boundary without offering", () => {
    expect(nav({ requested: 7 })).toEqual({
      kind: "advance",
      page: 7,
      crossedPosition: null,
    });
  });

  it("advances normally when no question sits at this boundary", () => {
    expect(nav({ current: 6, requested: 7 })).toEqual({
      kind: "advance",
      page: 7,
      crossedPosition: null,
    });
  });

  it("ignores questions with no slide pinned", () => {
    expect(
      nav({ questions: [{ id: "q1", positionAfterPage: null }] })
    ).toEqual({ kind: "advance", page: 5, crossedPosition: null });
  });
});

describe("decideNavigation — bounds", () => {
  it("does nothing when already on the requested page", () => {
    expect(nav({ requested: 4 })).toEqual({ kind: "none" });
  });

  it("does nothing at the last slide", () => {
    expect(nav({ current: 20, requested: 21 })).toEqual({ kind: "none" });
  });

  it("does nothing before the first slide", () => {
    expect(nav({ current: 1, requested: 0 })).toEqual({ kind: "none" });
  });

  it("clamps a jump past the end", () => {
    expect(nav({ current: 10, requested: 99 })).toEqual({
      kind: "advance",
      page: 20,
      crossedPosition: null,
    });
  });

  it("still advances when the page count is unknown", () => {
    // PDFs report their length asynchronously; nav must work before then.
    expect(nav({ current: 6, requested: 7, totalPages: null })).toEqual({
      kind: "advance",
      page: 7,
      crossedPosition: null,
    });
  });

  it("does not offer a clamped move that lands on the current page", () => {
    expect(nav({ current: 20, requested: 21, totalPages: 20 })).toEqual({
      kind: "none",
    });
  });
});

describe("decideNavigation — several questions on one slide", () => {
  const two: NavQuestion[] = [
    { id: "q1", positionAfterPage: 4 },
    { id: "q2", positionAfterPage: 4 },
  ];

  it("offers both at once", () => {
    expect(nav({ questions: two })).toEqual({
      kind: "offer",
      position: 4,
      questionIds: ["q1", "q2"],
    });
  });

  it("offers the second again after the first has run, rather than relaunching", () => {
    // Closing a poll used to snap straight into the next one at the same
    // slide, which read as "I closed it and it came back".
    expect(nav({ questions: two, ran: new Set(["q1"]) })).toEqual({
      kind: "offer",
      position: 4,
      questionIds: ["q2"],
    });
  });

  it("walks past both when the professor presses on", () => {
    expect(nav({ questions: two, offerArmedAt: 4 })).toEqual({
      kind: "advance",
      page: 5,
      crossedPosition: 4,
    });
  });

  it("does not treat an offer armed elsewhere as consent here", () => {
    expect(nav({ offerArmedAt: 9 })).toEqual({
      kind: "offer",
      position: 4,
      questionIds: ["q1"],
    });
  });
});

describe("nextStageAction", () => {
  it("walks think → pair → revote → reveal → resume", () => {
    expect(nextStageAction("think")).toEqual({
      kind: "stage",
      stage: "pair",
      label: "Pair & discuss",
    });
    expect(nextStageAction("pair")).toEqual({
      kind: "stage",
      stage: "revote",
      label: "Open re-vote",
    });
    expect(nextStageAction("revote")).toEqual({
      kind: "reveal",
      label: "Reveal results",
    });
    expect(nextStageAction("reveal")).toEqual({
      kind: "resume",
      label: "Resume lecture",
    });
  });

  it("offers nothing once the round is closed", () => {
    expect(nextStageAction("closed")).toBeNull();
  });

  it("names every live stage for the strip", () => {
    for (const stage of ["think", "pair", "revote", "reveal"] as const) {
      expect(STAGE_CHIP[stage]).not.toBe("");
    }
  });
});
