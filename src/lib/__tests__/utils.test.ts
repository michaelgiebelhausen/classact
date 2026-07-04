import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import {
  generateJoinCode,
  isValidJoinCodeFormat,
  normalizeJoinCode,
} from "@/lib/joincode";
import { buildSeatGrid, neighborCoords, rowLetter } from "@/lib/seatlabels";

describe("cn", () => {
  it("merges tailwind classes", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("joincode", () => {
  it("derives a 3-letter prefix from the course name", () => {
    expect(generateJoinCode("Marketing Research")).toMatch(
      /^MAR-[2-9A-HJKMNP-Z]{4}$/
    );
  });

  it("falls back to CLS when the name is too short", () => {
    expect(generateJoinCode("AI")).toMatch(/^CLS-[2-9A-HJKMNP-Z]{4}$/);
  });

  it("round-trips validation and normalization", () => {
    const code = generateJoinCode("Consumer Behavior");
    expect(isValidJoinCodeFormat(code)).toBe(true);
    expect(normalizeJoinCode(`  ${code.toLowerCase()} `)).toBe(code);
  });
});

describe("seat grid", () => {
  it("produces rows*cols uniquely labeled seats", () => {
    const seats = buildSeatGrid(5, 8);
    expect(seats).toHaveLength(40);
    expect(new Set(seats.map((s) => s.label)).size).toBe(40);
    expect(seats[0]).toEqual({ label: "A1", row: 0, col: 0 });
    expect(seats.at(-1)).toEqual({ label: "E8", row: 4, col: 7 });
  });

  it("extends row letters past Z", () => {
    expect(rowLetter(0)).toBe("A");
    expect(rowLetter(25)).toBe("Z");
    expect(rowLetter(26)).toBe("AA");
  });

  it("rejects invalid dimensions", () => {
    expect(() => buildSeatGrid(0, 5)).toThrow();
    expect(() => buildSeatGrid(41, 5)).toThrow();
    expect(() => buildSeatGrid(2.5, 5)).toThrow();
  });

  it("computes the four neighbor coordinates", () => {
    expect(neighborCoords(2, 3)).toEqual({
      front: { row: 1, col: 3 },
      back: { row: 3, col: 3 },
      left: { row: 2, col: 2 },
      right: { row: 2, col: 4 },
    });
  });
});
