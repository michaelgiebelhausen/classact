import { describe, expect, it } from "vitest";
import {
  CALLBACK_MESSAGES,
  CALLBACK_REASONS,
  isCallbackReason,
  reasonFromAuthError,
  reasonFromQuery,
  type CallbackReason,
} from "@/lib/authreason";

describe("reasonFromAuthError", () => {
  it("names the cross-device case by its own code", () => {
    // The failure 37 students hit: signed up on a laptop, opened the
    // confirmation email on a phone. Nothing expired.
    expect(
      reasonFromAuthError({ code: "pkce_code_verifier_not_found" })
    ).toBe("wrong_browser");
  });

  it("recognises the cross-device case by error name alone", () => {
    // Older auth-js builds surfaced the class name without a code.
    expect(
      reasonFromAuthError({ name: "AuthPKCECodeVerifierMissingError" })
    ).toBe("wrong_browser");
  });

  it("keeps genuinely expired links separate from wrong-browser ones", () => {
    for (const code of [
      "flow_state_expired",
      "flow_state_not_found",
      "otp_expired",
    ]) {
      expect(reasonFromAuthError({ code })).toBe("link_expired");
    }
  });

  it("falls back to link_invalid rather than guessing", () => {
    expect(reasonFromAuthError({ code: "something_new" })).toBe("link_invalid");
    expect(reasonFromAuthError(null)).toBe("link_invalid");
    expect(reasonFromAuthError(undefined)).toBe("link_invalid");
  });

  it("never blames expiry for a missing verifier", () => {
    // Regression guard: calling this "expired" is what sent students to
    // request a replacement link that failed the same way.
    expect(
      reasonFromAuthError({ code: "pkce_code_verifier_not_found" })
    ).not.toBe("link_expired");
  });
});

describe("reasonFromQuery", () => {
  it("passes through a current reason", () => {
    expect(reasonFromQuery("wrong_browser", null)).toBe("wrong_browser");
  });

  it("translates the legacy error values still in inboxes", () => {
    expect(reasonFromQuery(null, "expired")).toBe("link_expired");
    expect(reasonFromQuery(null, "missing")).toBe("no_token");
  });

  it("prefers the current vocabulary when both are present", () => {
    expect(reasonFromQuery("wrong_browser", "expired")).toBe("wrong_browser");
  });

  it("returns null when there is nothing to explain", () => {
    expect(reasonFromQuery(null, null)).toBeNull();
    expect(reasonFromQuery("not-a-reason", null)).toBeNull();
  });
});

describe("isCallbackReason", () => {
  it("accepts every declared reason and nothing else", () => {
    for (const reason of CALLBACK_REASONS) expect(isCallbackReason(reason)).toBe(true);
    expect(isCallbackReason("expired")).toBe(false);
    expect(isCallbackReason(null)).toBe(false);
    expect(isCallbackReason(undefined)).toBe(false);
    expect(isCallbackReason(42)).toBe(false);
  });
});

describe("CALLBACK_MESSAGES", () => {
  it("has copy for every reason", () => {
    // The whole point of the union: a new reason without copy is a blank page.
    for (const reason of CALLBACK_REASONS) {
      const entry = CALLBACK_MESSAGES[reason as CallbackReason];
      expect(entry.headline.length).toBeGreaterThan(0);
      expect(entry.help.length).toBeGreaterThan(0);
    }
  });

  it("tells the cross-device student to sign in, not to fetch a new link", () => {
    // Their email is already confirmed by the time the exchange fails, so a
    // replacement link is the one thing that cannot help them.
    const { help } = CALLBACK_MESSAGES.wrong_browser;
    expect(help.toLowerCase()).toContain("sign in");
  });
});
