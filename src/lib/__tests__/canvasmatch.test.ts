import { describe, expect, test } from "vitest";
import { canAdoptCanvasIdentity, rankCanvasCandidates } from "@/lib/canvasmatch";

describe("canAdoptCanvasIdentity", () => {
  test("allows adopting an unclaimed Canvas row with no history", () => {
    expect(
      canAdoptCanvasIdentity({ canvasHasProfile: false, canvasHasHistory: false })
    ).toEqual({ allowed: true });
  });

  test("refuses when the Canvas row has its own account", () => {
    // Two real accounts. Which of them is the student is not ours to guess,
    // and the loser's login would stop matching any row.
    const v = canAdoptCanvasIdentity({
      canvasHasProfile: true,
      canvasHasHistory: false,
    });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/account/i);
  });

  test("refuses when the Canvas row has attendance of its own", () => {
    // 22 tables cascade-delete off enrollments. Removing a row with history
    // destroys it silently, which is the one outcome a merge must never have.
    const v = canAdoptCanvasIdentity({
      canvasHasProfile: false,
      canvasHasHistory: true,
    });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error("expected refusal");
    expect(v.reason).toMatch(/check(ed)?.?in|attendance|history/i);
  });
});

const canvasRows = [
  { id: "a", name: "Tyler Pallotta", email: "tpallot@clemson.edu" },
  { id: "b", name: "Aeris Le", email: "aerisl@clemson.edu" },
  { id: "c", name: "Meredith Freeman", email: "mfreem4@clemson.edu" },
  { id: "d", name: "Wyatt Newton Kaspar", email: "wkaspar@clemson.edu" },
];

describe("rankCanvasCandidates", () => {
  test("puts the obvious name match first", () => {
    const ranked = rankCanvasCandidates(
      { name: "Meredith Freeman", email: "meredithmfreeman@icloud.com" },
      canvasRows
    );
    expect(ranked[0].id).toBe("c");
  });

  test("matches on the address when the name is only an email", () => {
    // Course-code rows are named after the address, so the local part is the
    // only signal: tpallotta17 against tpallot.
    const ranked = rankCanvasCandidates(
      { name: "tpallotta17@gmail.com", email: "tpallotta17@gmail.com" },
      canvasRows
    );
    expect(ranked[0].id).toBe("a");
  });

  test("matches a shortened local part against a fuller one", () => {
    const ranked = rankCanvasCandidates(
      { name: "aerisle04@gmail.com", email: "aerisle04@gmail.com" },
      canvasRows
    );
    expect(ranked[0].id).toBe("b");
  });

  test("returns every candidate, so the professor can override the ranking", () => {
    const ranked = rankCanvasCandidates(
      { name: "Someone Entirely Else", email: "nobody@example.com" },
      canvasRows
    );
    expect(ranked).toHaveLength(canvasRows.length);
  });

  test("does not invent a match out of a shared first name", () => {
    // "Tyler" alone is not evidence. A wrong merge hands one student another
    // student's roster place.
    const ranked = rankCanvasCandidates(
      { name: "Tyler Nguyen", email: "tnguyen@example.com" },
      [{ id: "a", name: "Tyler Pallotta", email: "tpallot@clemson.edu" }]
    );
    expect(ranked[0].confident).toBe(false);
  });

  test("flags an obvious pairing as confident", () => {
    const ranked = rankCanvasCandidates(
      { name: "Meredith Freeman", email: "meredithmfreeman@icloud.com" },
      canvasRows
    );
    expect(ranked[0].confident).toBe(true);
  });
});
