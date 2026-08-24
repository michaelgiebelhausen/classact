import { describe, expect, it } from "vitest";
import {
  ACTIVATION_META,
  ACTIVATION_STATES,
  activationState,
  summarize,
  type AccountFacts,
  type EnrollmentFacts,
} from "@/lib/activation";

const roster = (over: Partial<EnrollmentFacts> = {}): EnrollmentFacts => ({
  status: "invited",
  profileId: null,
  invitedAt: null,
  inviteError: null,
  ...over,
});

const account = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  emailConfirmed: true,
  everSignedIn: true,
  ...over,
});

describe("activationState", () => {
  it("counts a linked active enrollment as in the class", () => {
    expect(
      activationState(roster({ status: "active", profileId: "p1" }), account())
    ).toBe("active");
  });

  it("does not call a row active without a linked profile", () => {
    // status alone has been wrong before; the profile link is the real proof.
    expect(activationState(roster({ status: "active" }), null)).not.toBe(
      "active"
    );
  });

  it("flags the locked-out cohort: confirmed but never signed in", () => {
    expect(
      activationState(
        roster({ invitedAt: "2026-08-20T01:44:00Z" }),
        account({ everSignedIn: false })
      )
    ).toBe("stuck_no_session");
  });

  it("separates signed-in-but-unenrolled from locked-out", () => {
    expect(
      activationState(roster({ profileId: "p9" }), account({ everSignedIn: true }))
    ).toBe("signed_in_not_joined");
  });

  it("reads the account before the invite receipt", () => {
    // Emailed AND signed up from a classmate's link. Filing this under
    // "emailed" would hide that they are actually locked out.
    expect(
      activationState(
        roster({ invitedAt: "2026-08-20T01:44:00Z" }),
        account({ everSignedIn: false })
      )
    ).toBe("stuck_no_session");
  });

  it("prefers a send failure over a stale send timestamp", () => {
    // 0026 writes both columns independently; a row can carry each.
    expect(
      activationState(
        roster({ invitedAt: "2026-08-20T01:44:00Z", inviteError: "bounced" }),
        null
      )
    ).toBe("send_failed");
  });

  it("distinguishes emailed-no-account from never-emailed", () => {
    expect(
      activationState(roster({ invitedAt: "2026-08-20T01:44:00Z" }), null)
    ).toBe("emailed_no_account");
    expect(activationState(roster(), null)).toBe("not_emailed");
  });

  it("classifies a student added to the roster after the only send", () => {
    // The 8 real students in this position across the four live courses.
    expect(activationState(roster(), null)).toBe("not_emailed");
  });
});

describe("remedies", () => {
  it("never offers a re-invite to someone already holding a confirmed account", () => {
    // The whole point: re-sending an invite to the locked-out cohort sends
    // them back down the link that already failed.
    const state = activationState(roster(), account({ everSignedIn: false }));
    expect(ACTIVATION_META[state].remedy).toBe("set_password");
  });

  it("offers a re-invite to everyone an email can still reach", () => {
    for (const state of [
      "not_emailed",
      "send_failed",
      "emailed_no_account",
    ] as const) {
      expect(ACTIVATION_META[state].remedy).toBe("reinvite");
    }
  });

  it("asks nothing of a student already in the class", () => {
    expect(ACTIVATION_META.active.remedy).toBe("none");
  });

  it("has copy and a badge tone for every state", () => {
    for (const state of ACTIVATION_STATES) {
      expect(ACTIVATION_META[state].label.length).toBeGreaterThan(0);
      expect(ACTIVATION_META[state].blurb.length).toBeGreaterThan(0);
      expect(ACTIVATION_META[state].tone).toBeTruthy();
    }
  });
});

describe("summarize", () => {
  it("counts every state, including the zeroes", () => {
    const counts = summarize([
      "active",
      "active",
      "stuck_no_session",
      "not_emailed",
    ]);
    expect(counts.active).toBe(2);
    expect(counts.stuck_no_session).toBe(1);
    expect(counts.not_emailed).toBe(1);
    expect(counts.send_failed).toBe(0);
  });

  it("returns a zeroed row for an empty roster", () => {
    const counts = summarize([]);
    for (const state of ACTIVATION_STATES) expect(counts[state]).toBe(0);
  });
});
