import { describe, expect, test } from "vitest";
import { canResetAccount } from "@/lib/accountreset";

describe("canResetAccount", () => {
  test("allows resetting an account that has never been signed into", () => {
    // The whole stuck cohort: confirmed their email, never obtained a
    // session, no password they have ever used.
    expect(canResetAccount({ hasAccount: true, everSignedIn: false })).toEqual({
      allowed: true,
    });
  });

  test("refuses an account that has been signed into", () => {
    // They have a working login. Deleting it destroys something real and
    // gains nothing — their problem is enrolment, not access.
    const verdict = canResetAccount({ hasAccount: true, everSignedIn: true });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.reason).toMatch(/sign(ed)? in/i);
  });

  test("refuses when there is no account to reset", () => {
    const verdict = canResetAccount({ hasAccount: false, everSignedIn: false });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("expected refusal");
    expect(verdict.reason).toMatch(/no account/i);
  });

  test("never treats a signed-in account as resettable, even with no account flag", () => {
    // Defensive: the two inputs come from different lookups and could
    // disagree. Signed-in always wins, because that is the destructive case.
    const verdict = canResetAccount({ hasAccount: false, everSignedIn: true });

    expect(verdict.allowed).toBe(false);
  });
});
