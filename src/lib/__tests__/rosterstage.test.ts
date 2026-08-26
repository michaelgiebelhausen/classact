import { describe, expect, test } from "vitest";
import { rosterStage, ROSTER_STAGE_ORDER } from "@/lib/rosterstage";

const canvasRow = {
  hasProfile: false,
  status: "invited",
  rosterEmail: "jdoe@clemson.edu",
  accountEmail: null,
  activation: "emailed_no_account" as const,
  canvasMissingSince: null,
  canvasSeenAt: null,
  isDuplicateShadow: false,
  schoolEmail: null,
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
        canvasSeenAt: "2026-08-26T09:00:00Z",
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
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("canvas_confirmed");
  });

  test("the g-twin of the Canvas address is the same university identity", () => {
    // Clemson issues both spellings to one person: Canvas reports
    // jdoe@clemson.edu, Google sign-in supplies jdoe@g.clemson.edu. Demanding
    // an exact string match filed seven confirmed students under "not through
    // Canvas" in a single section.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "jdoe@clemson.edu",
        accountEmail: "jdoe@g.clemson.edu",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("canvas_confirmed");
  });

  test("an unrelated personal address is not the Canvas identity", () => {
    // The alias rule stays narrow: jdoe@gmail.com and jdoe@clemson.edu can be
    // different people, and matching them hands one student another's place.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "jdoe@clemson.edu",
        accountEmail: "jdoe@gmail.com",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("self_joined");
  });

  test("an off-roster joiner is waiting on the professor, not lost", () => {
    // Joined with the course code, no Canvas row: profile set, still pending
    // approval. Not stuck — waiting on us, and one click from checking in.
    expect(
      rosterStage({
        hasProfile: true,
        status: "invited",
        rosterEmail: "someone@clemson.edu",
        accountEmail: "someone@clemson.edu",
        activation: "signed_in_not_joined",
        canvasMissingSince: null,
        canvasSeenAt: null,
        isDuplicateShadow: false,
        schoolEmail: null,
      })
    ).toBe("awaiting_approval");
  });

  test("confirmed their email but never got a session needs a password", () => {
    expect(
      rosterStage({ ...canvasRow, activation: "stuck_no_session" })
    ).toBe("needs_password");
  });

  test("a bounced invite is its own situation — the address is wrong", () => {
    expect(rosterStage({ ...canvasRow, activation: "send_failed" })).toBe(
      "invite_failed"
    );
  });

  test("an account that works but never joined this class needs the class", () => {
    expect(
      rosterStage({ ...canvasRow, activation: "signed_in_not_joined" })
    ).toBe("needs_class");
  });

  test("the g-twin shadow row is filed as a duplicate, not as confirmed", () => {
    // ekutshe@g.clemson.edu sat under "Confirmed from Canvas" with no name and
    // no photo, because the sync's alias matcher had marked it seen. It is the
    // same student as ekutshe@clemson.edu, who has both.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "ekutshe@g.clemson.edu",
        accountEmail: "ekutshe@g.clemson.edu",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
        isDuplicateShadow: true,
      })
    ).toBe("duplicate");
  });

  test("sections run problems-first, settled-last, departures at the very bottom", () => {
    // The eye lands on what needs attention; the big passive block of
    // unclaimed Canvas rows sits low, and people who have left sit lower.
    expect(ROSTER_STAGE_ORDER).toEqual([
      "awaiting_approval",
      "needs_password",
      "needs_class",
      "invite_failed",
      "duplicate",
      "self_joined",
      "canvas_confirmed",
      "canvas_pending",
      "no_longer_on_canvas",
    ]);
  });

  test("a student Canvas stopped listing moves to the departures section", () => {
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        accountEmail: "jdoe@clemson.edu",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
        canvasMissingSince: "2026-08-26T12:00:00Z",
      })
    ).toBe("no_longer_on_canvas");
  });

  test("departure outranks being stuck — they may be gone, so stop chasing them", () => {
    // A locked-out student who has also left the class is not a support
    // problem any more. Leaving them in "needs you" sends the professor after
    // somebody who dropped the course.
    expect(
      rosterStage({
        ...canvasRow,
        activation: "stuck_no_session",
        canvasMissingSince: "2026-08-26T12:00:00Z",
      })
    ).toBe("no_longer_on_canvas");
  });

  test("a course-code joiner is never 'confirmed from Canvas', however active", () => {
    // wgt567654@gmail.com was filed under Confirmed from Canvas on the live
    // page. A Gmail address was never on a Clemson Canvas roster; the row
    // just happened to be active and to match its own login address.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "wgt567654@gmail.com",
        accountEmail: "wgt567654@gmail.com",
        activation: "active",
        canvasSeenAt: null,
      })
    ).toBe("self_joined");
  });

  test("a g-twin address Canvas really does hold stays confirmed", () => {
    // dwreede@g.clemson.edu was matched by an actual sync, so Canvas holds
    // that spelling. Provenance is recorded, not guessed.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "dwreede@g.clemson.edu",
        accountEmail: "dwreede@g.clemson.edu",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("canvas_confirmed");
  });

  test("synced from Canvas and signed in with the Canvas address is confirmed, whatever the row status", () => {
    // Mike's rule: being on the Canvas roster and holding the Canvas address
    // is what "confirmed" means. A row still sitting at 'invited' does not
    // make the identity less confirmed -- it just means nobody approved it,
    // which is surfaced separately.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "invited",
        rosterEmail: "jdoe@clemson.edu",
        accountEmail: "jdoe@clemson.edu",
        activation: "signed_in_not_joined",
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("canvas_confirmed");
  });

  test("but a personal address is still not confirmed, whatever the status", () => {
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "jdoe@clemson.edu",
        accountEmail: "jdoe@hotmail.com",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
      })
    ).toBe("self_joined");
  });

  test("someone who joined with the code and isn't approved yet is its own situation", () => {
    // They have a working account and believe they're set, but checkIn wants
    // status 'active' and turns them away at the seat map. Mixing them in with
    // students who are already approved hides a one-click fix.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "invited",
        rosterEmail: "someone@gmail.com",
        accountEmail: "someone@gmail.com",
        activation: "signed_in_not_joined",
      })
    ).toBe("awaiting_approval");
  });

  test("an approved off-roster student is settled, not a queue item", () => {
    // An auditor. Never on Canvas, deliberately in the class, nothing owed.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "someone@gmail.com",
        accountEmail: "someone@gmail.com",
        activation: "active",
      })
    ).toBe("self_joined");
  });

  test("a claimed school address counts as the Canvas identity", () => {
    // Tyler signs in as tpallotta17@gmail.com and is tpallot@clemson.edu on
    // the Canvas roster. The login is a credential; the school address is who
    // he is on the roster, and they are allowed to differ.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "tpallot@clemson.edu",
        accountEmail: "tpallotta17@gmail.com",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
        schoolEmail: "tpallot@clemson.edu",
      })
    ).toBe("canvas_confirmed");
  });

  test("a claimed school address still has to be the g-twin at worst", () => {
    // Claiming somebody else's address must not hand you their roster place,
    // so it is matched against this row's address rather than merely existing.
    expect(
      rosterStage({
        ...canvasRow,
        hasProfile: true,
        status: "active",
        rosterEmail: "tpallot@clemson.edu",
        accountEmail: "someone@gmail.com",
        activation: "active",
        canvasSeenAt: "2026-08-26T09:00:00Z",
        schoolEmail: "different@clemson.edu",
      })
    ).toBe("self_joined");
  });
});
