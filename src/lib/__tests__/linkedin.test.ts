import { describe, expect, it } from "vitest";
import { normalizeLinkedInUrl } from "@/lib/linkedin";

describe("normalizeLinkedInUrl", () => {
  it("accepts a bare handle", () => {
    expect(normalizeLinkedInUrl("jane-doe-123")).toBe(
      "https://www.linkedin.com/in/jane-doe-123"
    );
    expect(normalizeLinkedInUrl("@jane-doe-123")).toBe(
      "https://www.linkedin.com/in/jane-doe-123"
    );
  });

  it("accepts an in/handle fragment", () => {
    expect(normalizeLinkedInUrl("in/jane-doe")).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );
  });

  it("canonicalizes full URLs and drops tracking params", () => {
    expect(
      normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe?utm_source=x")
    ).toBe("https://www.linkedin.com/in/jane-doe");
    expect(normalizeLinkedInUrl("linkedin.com/in/jane-doe/")).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );
    expect(normalizeLinkedInUrl("https://uk.linkedin.com/in/jane-doe")).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );
  });

  it("rejects non-LinkedIn hosts and non-profile paths", () => {
    expect(normalizeLinkedInUrl("https://example.com/in/jane")).toBeNull();
    expect(normalizeLinkedInUrl("https://www.linkedin.com/feed")).toBeNull();
    expect(normalizeLinkedInUrl("https://notlinkedin.com/in/jane-doe")).toBeNull();
  });

  it("rejects empty and malformed input", () => {
    expect(normalizeLinkedInUrl("")).toBeNull();
    expect(normalizeLinkedInUrl("   ")).toBeNull();
  });
});
