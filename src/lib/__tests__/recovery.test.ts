import { describe, expect, test } from "vitest";
import {
  buildRecoveryUrl,
  recoveryOutcome,
  RECOVERY_SENT_MESSAGE,
  RECOVERY_LIMIT,
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
