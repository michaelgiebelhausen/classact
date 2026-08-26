import { describe, expect, test } from "vitest";
import { canApproveJoiner } from "@/lib/approvejoiner";

describe("canApproveJoiner", () => {
  test("approves someone who joined with the code and is waiting", () => {
    // The blocked case: account linked, row still pending, so checkIn's
    // status='active' requirement turns them away at the seat map.
    expect(canApproveJoiner({ status: "invited", hasProfile: true })).toBe(true);
  });

  test("refuses a roster row nobody has claimed", () => {
    // A Canvas import with no account behind it. Marking that active creates
    // an enrolled student who does not exist.
    expect(canApproveJoiner({ status: "invited", hasProfile: false })).toBe(
      false
    );
  });

  test("refuses a row that is already active", () => {
    expect(canApproveJoiner({ status: "active", hasProfile: true })).toBe(false);
  });

  test("refuses a dropped row", () => {
    // Re-adding a dropped student is reactivation, which also clears
    // dropped_at. Flipping status here would leave that stale.
    expect(canApproveJoiner({ status: "dropped", hasProfile: true })).toBe(
      false
    );
  });
});
