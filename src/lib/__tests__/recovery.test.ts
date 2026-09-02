import { describe, expect, test } from "vitest";
import {
  buildAuthLinkUrl,
  buildRecoveryUrl,
  recoveryOutcome,
  RECOVERY_SENT_MESSAGE,
  RECOVERY_LIMIT,
  SIGN_IN_LINK_SENT_MESSAGE,
} from "@/lib/recovery";

describe("buildRecoveryUrl", () => {
  test("points at the callback with a token_hash, not a PKCE code", () => {
    const url = new URL(
      buildRecoveryUrl("https://classact.college", "abc123", "/update-password")
    );

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("recovery");
    expect(url.searchParams.get("next")).toBe("/update-password");
    expect(url.searchParams.get("code")).toBeNull();
  });

  test("keeps the destination inside the app", () => {
    const url = new URL(
      buildRecoveryUrl("https://classact.college", "abc123", "https://evil.test/steal")
    );

    expect(url.searchParams.get("next")).toBe("/update-password");
  });
});

describe("recoveryOutcome", () => {
  test("sends when the account exists", () => {
    const outcome = recoveryOutcome({
      accountExists: true,
      emailConfigured: true,
      recentRequests: 0,
    });

    expect(outcome.send).toBe(true);
    expect(outcome.result).toEqual({ ok: true });
  });

  test("does not send when there is no account", () => {
    const outcome = recoveryOutcome({
      accountExists: false,
      emailConfigured: true,
      recentRequests: 0,
    });

    expect(outcome.send).toBe(false);
  });

  test("answers identically whether or not the account exists", () => {
    // The whole point: a public endpoint that distinguishes these two is an
    // account-existence oracle, and this roster is the student body.
    const exists = recoveryOutcome({
      accountExists: true,
      emailConfigured: true,
      recentRequests: 0,
    });
    const missing = recoveryOutcome({
      accountExists: false,
      emailConfigured: true,
      recentRequests: 0,
    });

    expect(exists.result).toEqual(missing.result);
  });

  test("goes quiet once an address is over the limit, still without leaking", () => {
    const limited = recoveryOutcome({
      accountExists: true,
      emailConfigured: true,
      recentRequests: RECOVERY_LIMIT,
    });

    expect(limited.send).toBe(false);
    // Same answer as a successful send — otherwise the response tells an
    // attacker they found a real address, and tells a pest their mail bomb
    // is landing.
    expect(limited.result).toEqual({ ok: true });
  });

  test("still refuses to send one request under the limit", () => {
    const allowed = recoveryOutcome({
      accountExists: true,
      emailConfigured: true,
      recentRequests: RECOVERY_LIMIT - 1,
    });

    expect(allowed.send).toBe(true);
  });

  test("reports a server misconfiguration plainly rather than pretending", () => {
    const outcome = recoveryOutcome({
      accountExists: true,
      emailConfigured: false,
      recentRequests: 0,
    });

    expect(outcome.send).toBe(false);
    expect(outcome.result.ok).toBe(false);
    // Not about the account, so uniformity does not apply — telling a student
    // "check your email" when no mailer exists strands them silently.
    if (!outcome.result.ok) {
      expect(outcome.result.error).toMatch(/email/i);
    }
  });

  test("the message sent to students never confirms an account exists", () => {
    expect(RECOVERY_SENT_MESSAGE).not.toMatch(/\byour account\b/i);
    expect(RECOVERY_SENT_MESSAGE).toMatch(/if/i);
  });
});

describe("buildAuthLinkUrl", () => {
  test("mints a token_hash magic link, never a PKCE code", () => {
    const url = new URL(
      buildAuthLinkUrl("https://classact.college", {
        hashedToken: "tok123",
        type: "magiclink",
        next: "/auth/join?code=AIT-WWRM",
        fallbackNext: "/dashboard",
      })
    );

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("tok123");
    expect(url.searchParams.get("type")).toBe("magiclink");
    expect(url.searchParams.get("next")).toBe("/auth/join?code=AIT-WWRM");
    // The whole point of this path: no device-bound code, so the link opens
    // on whatever phone or laptop the student actually reads mail on.
    expect(url.searchParams.get("code")).toBeNull();
  });

  test("falls back rather than following an absolute destination", () => {
    const url = new URL(
      buildAuthLinkUrl("https://classact.college", {
        hashedToken: "tok123",
        type: "magiclink",
        next: "https://evil.test/steal",
        fallbackNext: "/dashboard",
      })
    );

    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  test("refuses a protocol-relative destination", () => {
    // "//evil.test" is a valid absolute URL to a browser and starts with "/",
    // so a naive startsWith check lets a login token walk off-site.
    const url = new URL(
      buildAuthLinkUrl("https://classact.college", {
        hashedToken: "tok123",
        type: "magiclink",
        next: "//evil.test/steal",
        fallbackNext: "/dashboard",
      })
    );

    expect(url.searchParams.get("next")).toBe("/dashboard");
  });
});

describe("SIGN_IN_LINK_SENT_MESSAGE", () => {
  test("never confirms an account exists", () => {
    expect(SIGN_IN_LINK_SENT_MESSAGE).not.toMatch(/\byour account\b/i);
    expect(SIGN_IN_LINK_SENT_MESSAGE).toMatch(/if/i);
  });

  test("tells students where the mail actually lands", () => {
    // Andrew Paul's link was DELIVERED to his university address and he never
    // saw it. "Check your email" was true and useless.
    expect(SIGN_IN_LINK_SENT_MESSAGE).toMatch(/junk|spam/i);
    expect(RECOVERY_SENT_MESSAGE).toMatch(/junk|spam/i);
  });
});
