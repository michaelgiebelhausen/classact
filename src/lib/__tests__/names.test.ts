import { describe, it, expect } from "vitest";
import {
  compareByLastName,
  initialsOf,
  lastNameOf,
  sortByLastName,
} from "@/lib/names";

describe("lastNameOf", () => {
  it("takes the last token, not the second", () => {
    expect(lastNameOf("Emma Mabel Roethke")).toBe("Roethke");
    expect(lastNameOf("Siobhan Chen")).toBe("Chen");
  });

  it("reads registrar exports that are already surname-first", () => {
    expect(lastNameOf("Roethke, Emma")).toBe("Roethke");
    expect(lastNameOf("Van Der Berg, Aad")).toBe("Van Der Berg");
  });

  it("skips generational and professional suffixes", () => {
    expect(lastNameOf("Martin Luther King Jr.")).toBe("King");
    expect(lastNameOf("Dale Earnhardt Sr")).toBe("Earnhardt");
    expect(lastNameOf("Thurston Howell III")).toBe("Howell");
  });

  it("handles single names and stray whitespace", () => {
    expect(lastNameOf("Cher")).toBe("Cher");
    expect(lastNameOf("  Ada   Lovelace  ")).toBe("Lovelace");
    expect(lastNameOf("")).toBe("");
  });
});

describe("compareByLastName", () => {
  it("orders by surname, not by first name", () => {
    expect(compareByLastName("Zoe Adams", "Aaron Baker")).toBeLessThan(0);
  });

  it("falls back to the full name when surnames match", () => {
    expect(compareByLastName("Wei Chen", "Ana Chen")).toBeGreaterThan(0);
  });

  it("ignores case and accents so variants file together", () => {
    expect(compareByLastName("aad de souza", "Bea De Souza")).toBeLessThan(0);
    expect(lastNameOf("Renée Müller")).toBe("Müller");
  });
});

describe("initialsOf", () => {
  it("takes first and last, skipping the middle", () => {
    expect(initialsOf("Emma Mabel Roethke")).toBe("ER");
  });

  it("gives the same initials whichever way the name is written", () => {
    expect(initialsOf("Roethke, Emma")).toBe("ER");
  });

  it("gives one letter for a single name", () => {
    expect(initialsOf("Cher")).toBe("C");
  });

  it("keeps accented letters intact and falls back when empty", () => {
    expect(initialsOf("Renée Müller")).toBe("RM");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("sortByLastName", () => {
  it("sorts a roster and leaves the input untouched", () => {
    const roster = [
      { name: "Emma Mabel Roethke" },
      { name: "Aaron Baker" },
      { name: "Wei Chen" },
      { name: "Martin Luther King Jr." },
      { name: "Ana Chen" },
    ];
    const sorted = sortByLastName(roster, (p) => p.name);
    expect(sorted.map((p) => p.name)).toEqual([
      "Aaron Baker",
      "Ana Chen",
      "Wei Chen",
      "Martin Luther King Jr.",
      "Emma Mabel Roethke",
    ]);
    expect(roster[0].name).toBe("Emma Mabel Roethke");
  });
});
