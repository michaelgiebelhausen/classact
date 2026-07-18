import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import {
  generateJoinCode,
  isValidJoinCodeFormat,
  normalizeJoinCode,
} from "@/lib/joincode";
import { rowLetter } from "@/lib/seatlabels";

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

describe("row letters", () => {
  // Grid building and adjacency moved to lib/roomlayout (see roomlayout.test.ts).
  it("extends row letters past Z", () => {
    expect(rowLetter(0)).toBe("A");
    expect(rowLetter(25)).toBe("Z");
    expect(rowLetter(26)).toBe("AA");
  });
});
