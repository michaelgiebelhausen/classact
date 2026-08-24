import { describe, it, expect } from "vitest";
import {
  compareByLastName,
  initialsOf,
  isEmailAddress,
  lastNameOf,
  rosterDisplayName,
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

  it("keeps a single-letter surname instead of reading it as a suffix", () => {
    // "V" used to be in the suffix list, which filed Anand under A.
    expect(lastNameOf("Anand V")).toBe("V");
    expect(lastNameOf("Priya V")).toBe("V");
  });

  it("keeps particles with the surname, either spelling", () => {
    expect(lastNameOf("Aad van der Berg")).toBe("van der Berg");
    expect(lastNameOf("Eddie Van Halen")).toBe("Van Halen");
    expect(lastNameOf("Ana de la Cruz")).toBe("de la Cruz");
  });

  it("strips suffixes in surname-first form too", () => {
    expect(lastNameOf("King Jr., Martin Luther")).toBe("King");
    expect(lastNameOf("Howell III, Thurston")).toBe("Howell");
  });

  it("survives a CSV row with an empty surname field", () => {
    expect(lastNameOf(", John")).toBe("John");
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
    // Differs ONLY by case and accent: this is 0 only because the comparison
    // is base-sensitivity. Drop that option and this test fails.
    expect(compareByLastName("Renee Muller", "Renée Müller")).toBe(0);
    expect(compareByLastName("aad de souza", "Bea De Souza")).toBeLessThan(0);
  });

  it("files the same surname together across export formats", () => {
    // Same surname, different exports: they land next to each other rather
    // than in the B and V sections.
    const sorted = sortByLastName(
      [
        { name: "Cara Chen" },
        { name: "Aad van der Berg" },
        { name: "Zeb Zylker" },
        { name: "Van Der Berg, Bea" },
      ],
      (p) => p.name
    ).map((p) => p.name);
    expect(sorted).toEqual([
      "Cara Chen",
      "Aad van der Berg",
      "Van Der Berg, Bea",
      "Zeb Zylker",
    ]);
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

  it("never renders punctuation as an initial", () => {
    expect(initialsOf("...")).toBe("?");
    expect(initialsOf("-")).toBe("?");
    expect(initialsOf(", John")).toBe("J");
    expect(initialsOf("Ana O'Brien-Smith")).toBe("AO");
  });

  it("takes the student's initials, not a suffix's", () => {
    expect(initialsOf("Roethke, Jr., Emma")).toBe("ER");
    expect(initialsOf("Martin Luther King Jr.")).toBe("MK");
  });

  it("gives one letter for a single-letter surname, not a collapsed one", () => {
    expect(initialsOf("Anand V")).toBe("AV");
  });

  it("agrees across export formats for particle surnames", () => {
    expect(initialsOf("Aad van der Berg")).toBe("AV");
    expect(initialsOf("Van Der Berg, Aad")).toBe("AV");
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

describe("rosterDisplayName", () => {
  it("keeps an ordinary roster name untouched", () => {
    expect(rosterDisplayName("Jordan Rivera")).toBe("Jordan Rivera");
    expect(rosterDisplayName("Alvarez-Stratton, Anneliese")).toBe(
      "Alvarez-Stratton, Anneliese"
    );
  });

  it("reduces an email address to its local part", () => {
    // Off-roster joiners get roster_name = their email (auth/join/route.ts),
    // and this map is serialized to every classmate's browser.
    expect(rosterDisplayName("jsmith@clemson.edu")).toBe("jsmith");
    expect(rosterDisplayName("a.b.c@g.clemson.edu")).toBe("a.b.c");
  });

  it("never publishes a deliverable address to the class", () => {
    expect(rosterDisplayName("jsmith@clemson.edu")).not.toContain("@");
  });

  it("leaves a stray @ that isn't an address alone", () => {
    expect(rosterDisplayName("DJ @Nite")).toBe("DJ @Nite");
    expect(rosterDisplayName("@handle")).toBe("@handle");
  });

  it("handles empty and whitespace input without throwing", () => {
    expect(rosterDisplayName("")).toBe("");
    expect(rosterDisplayName("   ")).toBe("   ");
  });

  it("prefers the name an off-roster joiner gave at onboarding", () => {
    // Without this they read as "jsmith" to the whole class forever, however
    // carefully they filled in their profile.
    expect(rosterDisplayName("jsmith@clemson.edu", "Jordan Smith")).toBe(
      "Jordan Smith"
    );
    expect(rosterDisplayName("jsmith@clemson.edu", "  Jordan Smith  ")).toBe(
      "Jordan Smith"
    );
  });

  it("falls back to the local part when there's no profile name yet", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(rosterDisplayName("jsmith@clemson.edu", empty)).toBe("jsmith");
    }
  });

  it("never lets a profile name override the registrar's", () => {
    // An imported roster name is what the professor sees in their gradebook;
    // a student renaming themselves there would be a different feature.
    expect(rosterDisplayName("Jordan Rivera", "DJ Riv")).toBe("Jordan Rivera");
    expect(rosterDisplayName("Alvarez-Stratton, Anneliese", "Annie")).toBe(
      "Alvarez-Stratton, Anneliese"
    );
  });

  it("still refuses to publish an address, whatever the profile says", () => {
    expect(rosterDisplayName("jsmith@clemson.edu", "x@y.com")).not.toBe(
      "jsmith@clemson.edu"
    );
    expect(rosterDisplayName("jsmith@clemson.edu", null)).not.toContain("@");
  });
});

describe("isEmailAddress", () => {
  it("spots the addresses off-roster joins leave in roster_name", () => {
    expect(isEmailAddress("jsmith@clemson.edu")).toBe(true);
    expect(isEmailAddress("a.b.c@g.clemson.edu")).toBe(true);
  });

  it("doesn't mistake ordinary names or stray @ for an address", () => {
    expect(isEmailAddress("Jordan Rivera")).toBe(false);
    expect(isEmailAddress("DJ @Nite")).toBe(false);
    expect(isEmailAddress("@handle")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});
