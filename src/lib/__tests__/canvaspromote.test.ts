import { describe, expect, test } from "vitest";
import { shouldConfirmFromCanvas } from "@/lib/canvaspromote";

describe("shouldConfirmFromCanvas", () => {
  test("promotes a self-joined student Canvas now lists", () => {
    // They came to class and joined with their official address before the
    // professor imported the roster. The import matches them, and they should
    // stop reading as an off-roster joiner.
    expect(
      shouldConfirmFromCanvas({ status: "invited", profileId: "p1" })
    ).toBe(true);
  });

  test("leaves an imported row nobody has claimed alone", () => {
    // On the Canvas roster, no account yet — still pending, not confirmed.
    expect(
      shouldConfirmFromCanvas({ status: "invited", profileId: null })
    ).toBe(false);
  });

  test("does nothing to a row that is already active", () => {
    expect(
      shouldConfirmFromCanvas({ status: "active", profileId: "p1" })
    ).toBe(false);
  });

  test("does not resurrect a dropped student", () => {
    // Reactivation is its own path, with its own dropped_at bookkeeping.
    // Quietly flipping status here would skip it.
    expect(
      shouldConfirmFromCanvas({ status: "dropped", profileId: "p1" })
    ).toBe(false);
  });
});
