import { describe, expect, it } from "vitest";
import { emailAliasOf } from "@/lib/emailalias";

describe("emailAliasOf", () => {
  it("maps an official .edu address to its g.-twin", () => {
    expect(emailAliasOf("jblind@clemson.edu")).toBe("jblind@g.clemson.edu");
  });

  it("maps a g.-prefixed address back to the official one", () => {
    expect(emailAliasOf("jblind@g.clemson.edu")).toBe("jblind@clemson.edu");
  });

  it("normalizes case and whitespace", () => {
    expect(emailAliasOf("  JBlind@G.Clemson.EDU ")).toBe("jblind@clemson.edu");
  });

  it("refuses non-.edu domains — gmail twins are not the same person", () => {
    expect(emailAliasOf("gglemonata@gmail.com")).toBeNull();
    expect(emailAliasOf("someone@g.company.com")).toBeNull();
  });

  it("refuses degenerate inputs", () => {
    expect(emailAliasOf("no-at-sign")).toBeNull();
    expect(emailAliasOf("@clemson.edu")).toBeNull();
    expect(emailAliasOf("jblind@")).toBeNull();
    expect(emailAliasOf("jblind@g.edu")).toBeNull();
  });

  it("round-trips: alias of the alias is the original", () => {
    const alias = emailAliasOf("hmarks@clemson.edu");
    expect(alias && emailAliasOf(alias)).toBe("hmarks@clemson.edu");
  });
});
