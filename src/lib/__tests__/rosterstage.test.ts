import { describe, expect, test } from "vitest";
import { rosterStage, ROSTER_STAGE_ORDER } from "@/lib/rosterstage";

const canvasRow = {
  hasProfile: false,
  status: "invited",
  rosterEmail: "jdoe@clemson.edu",
  accountEmail: null,
  activation: "emailed_no_account" as const,
};

describe("rosterStage", () => {
  test("a Canvas row nobody has claimed is still pending", () => {
    expect(rosterStage(canvasRow)).toBe("canvas_pending");
  });

  test("a Canvas row never even emailed is also pending, not a problem", () => {
    expect(
      rosterStage({ ...canvasRow, activation: "not_emailed" })
    ).toBe("canvas_pending");
  });

  test("a claimed Canvas row whose login matches the roster address is confirmed", () => {
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        accountEmail: "jdoe@clemson.edu",
        activation: "active",
      })
    ).toBe("canvas_confirmed");
  });

  test("matching is case-insensitive — Canvas and auth disagree on case constantly", () => {
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "JDoe@Clemson.edu",
        accountEmail: "jdoe@clemson.edu",
        activation: "active",
      })
    ).toBe("canvas_confirmed");
  });

  test("signing in with a different address than Canvas has counts as self-joined", () => {
    // The g.clemson twin: they reached the right roster row, but not through
    // the address Canvas holds, so the professor should see it as unconfirmed
    // against Canvas rather than as a clean match.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "jdoe@clemson.edu",
        accountEmail: "jdoe@g.clemson.edu",
        activation: "active",
      })
    ).toBe("self_joined");
  });

  test("an off-roster joiner is self-joined, not lost", () => {
    // Joined with the course code, no Canvas row: profile set, still pending
    // the professor's approval. They are not stuck — they are waiting on us.
    expect(
      rosterStage({
        hasProfile: true,
        status: "invited",
        rosterEmail: "someone@clemson.edu",
        accountEmail: "someone@clemson.edu",
        activation: "signed_in_not_joined",
      })
    ).toBe("self_joined");
  });

  test("confirmed their email but never got a session is limbo", () => {
    expect(
      rosterStage({ ...canvasRow, activation: "stuck_no_session" })
    ).toBe("limbo");
  });

  test("a bounced invite is limbo — it needs the professor, not the student", () => {
    expect(rosterStage({ ...canvasRow, activation: "send_failed" })).toBe(
      "limbo"
    );
  });

  test("an unclaimed row whose owner has signed in elsewhere is limbo", () => {
    expect(
      rosterStage({ ...canvasRow, activation: "signed_in_not_joined" })
    ).toBe("limbo");
  });

  test("sections run problems-first, settled-last", () => {
    // Mike's ordering: the eye lands on what needs attention, and the big
    // passive block of unclaimed Canvas rows sits at the bottom.
    expect(ROSTER_STAGE_ORDER).toEqual([
      "limbo",
      "self_joined",
      "canvas_confirmed",
      "canvas_pending",
    ]);
  });
});
