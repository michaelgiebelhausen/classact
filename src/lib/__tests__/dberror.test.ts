import { describe, expect, it, vi } from "vitest";
import { NO_ROW, describeQueryFailure } from "@/lib/dberror";

describe("describeQueryFailure", () => {
  it("says nothing when the query succeeded", () => {
    expect(describeQueryFailure("scope", null)).toBeNull();
  });

  it("treats a missing row as no failure", () => {
    // PGRST116 is the one code that genuinely means "not there" — callers
    // already handle it as an absent row, and must keep doing so.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      describeQueryFailure("scope", { code: NO_ROW, message: "no rows" })
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports an undefined column and points at the migrations", () => {
    // The exact failure that surfaced as "Only the course owner can copy it".
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = describeQueryFailure("duplicateCourse", {
      code: "42703",
      message: "column courses.participation_weights does not exist",
    });
    expect(message).toContain("column courses.participation_weights does not exist");
    expect(message).toContain("supabase/migrations");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still says something when the error carries no message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeQueryFailure("scope", { code: "08006" })).toContain("08006");
    expect(describeQueryFailure("scope", {})).toContain("unknown database error");
    spy.mockRestore();
  });
});
