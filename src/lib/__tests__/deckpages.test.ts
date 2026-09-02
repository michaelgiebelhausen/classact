import { describe, expect, it } from "vitest";
import { deckPagePath, pagesReady, prefetchPages } from "@/lib/deckpages";

describe("deckPagePath", () => {
  it("lives under the deck's course folder so the existing storage policies apply", () => {
    expect(deckPagePath("course-1", "deck-9", 12)).toBe(
      "course-1/deck-9/pages/12.webp"
    );
  });
});

describe("pagesReady", () => {
  it("is ready only when every page has been rendered", () => {
    expect(pagesReady(60, 60)).toBe(true);
    expect(pagesReady(61, 60)).toBe(true);
    expect(pagesReady(59, 60)).toBe(false);
  });
  it("is never ready for a deck with no known page count", () => {
    expect(pagesReady(0, null)).toBe(false);
    expect(pagesReady(5, 0)).toBe(false);
  });
});

describe("prefetchPages", () => {
  it("looks two ahead and one behind, ahead first", () => {
    expect(prefetchPages(10, 60)).toEqual([11, 12, 9]);
  });
  it("clamps at the ends of the deck", () => {
    expect(prefetchPages(1, 60)).toEqual([2, 3]);
    expect(prefetchPages(60, 60)).toEqual([59]);
    expect(prefetchPages(59, 60)).toEqual([60, 58]);
  });
  it("handles a one-page deck", () => {
    expect(prefetchPages(1, 1)).toEqual([]);
  });
});
