import { describe, expect, it } from "vitest";
import {
  asOtpType,
  failPath,
  one,
  reasonFromProviderError,
  safeNext,
} from "@/lib/authcallback";

describe("safeNext", () => {
  it("keeps an in-app destination", () => {
    expect(safeNext("/course/abc/checkin")).toBe("/course/abc/checkin");
  });

  it("falls back to the dashboard when there is nothing to honour", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext("")).toBe("/dashboard");
  });

  // The URL this runs on carries a live sign-in token. Sending it anywhere
  // off-site would hand that token to whoever asked for the redirect.
  it("refuses to leave the app", () => {
    expect(safeNext("https://evil.example/steal")).toBe("/dashboard");
    expect(safeNext("//evil.example/steal")).toBe("/dashboard");
    expect(safeNext("dashboard")).toBe("/dashboard");
  });
});

describe("asOtpType", () => {
  it("accepts the types Supabase actually sends", () => {
    for (const t of ["signup", "invite", "magiclink", "recovery", "email"]) {
      expect(asOtpType(t)).toBe(t);
    }
  });

  it("rejects anything else rather than passing it through", () => {
    expect(asOtpType("sms")).toBeNull();
    expect(asOtpType("")).toBeNull();
    expect(asOtpType(null)).toBeNull();
  });
});

describe("failPath", () => {
  it("carries the reason", () => {
    expect(failPath("link_expired", "/dashboard")).toBe(
      "/login?reason=link_expired"
    );
  });

  it("carries the destination when it isn't the default", () => {
    expect(failPath("no_token", "/join/ABC123")).toBe(
      "/login?reason=no_token&next=%2Fjoin%2FABC123"
    );
  });
});

describe("reasonFromProviderError", () => {
  it("treats Supabase's expiry codes as expiry", () => {
    expect(reasonFromProviderError("otp_expired")).toBe("link_expired");
    expect(reasonFromProviderError("access_denied")).toBe("link_expired");
  });

  it("reports anything else as the provider's own problem", () => {
    expect(reasonFromProviderError("server_error")).toBe("provider_error");
  });
});

describe("one", () => {
  it("takes the first of a repeated parameter", () => {
    expect(one(["a", "b"])).toBe("a");
    expect(one("a")).toBe("a");
    expect(one(undefined)).toBeUndefined();
  });
});
