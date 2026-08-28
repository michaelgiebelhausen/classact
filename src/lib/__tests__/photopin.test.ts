import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPhotoPins,
  photoPathKey,
  stablePhotoUrl,
} from "@/lib/photopin";

const PATH = "https://x.supabase.co/storage/v1/object/sign/photos/u1/roster";
const SIGNED_A = `${PATH}?token=aaa`;
const SIGNED_B = `${PATH}?token=bbb`;
const OTHER = "https://x.supabase.co/storage/v1/object/sign/photos/u2/roster?token=ccc";

const TEN_MIN = 10 * 60 * 1000;

describe("photoPathKey", () => {
  it("strips the query string", () => {
    expect(photoPathKey(SIGNED_A)).toBe(PATH);
    expect(photoPathKey(SIGNED_B)).toBe(PATH);
  });

  it("passes through a URL without a query", () => {
    expect(photoPathKey(PATH)).toBe(PATH);
  });
});

describe("stablePhotoUrl", () => {
  beforeEach(() => clearPhotoPins());

  it("passes null and undefined through", () => {
    expect(stablePhotoUrl(null)).toBeNull();
    expect(stablePhotoUrl(undefined)).toBeNull();
  });

  it("returns the first-seen URL for a path even when a re-signed one arrives", () => {
    expect(stablePhotoUrl(SIGNED_A)).toBe(SIGNED_A);
    expect(stablePhotoUrl(SIGNED_B)).toBe(SIGNED_A);
  });

  it("pins per path — other photos are unaffected", () => {
    expect(stablePhotoUrl(SIGNED_A)).toBe(SIGNED_A);
    expect(stablePhotoUrl(OTHER)).toBe(OTHER);
  });

  it("keeps returning the same URL when the identical string arrives again", () => {
    expect(stablePhotoUrl(SIGNED_A)).toBe(SIGNED_A);
    expect(stablePhotoUrl(SIGNED_A)).toBe(SIGNED_A);
  });

  it("re-stamps an expired pin for free when the identical string arrives", () => {
    let t = 0;
    const now = () => t;
    expect(stablePhotoUrl(SIGNED_A, now)).toBe(SIGNED_A);
    t = TEN_MIN + 1;
    // Same string after expiry: re-pinned, no change.
    expect(stablePhotoUrl(SIGNED_A, now)).toBe(SIGNED_A);
    // The re-stamp holds: a different URL arriving now is inside the new
    // pin window and is NOT adopted.
    t = TEN_MIN + 2;
    expect(stablePhotoUrl(SIGNED_B, now)).toBe(SIGNED_A);
  });

  it("does not swap to a different URL cold after expiry — keeps the old one while warming", () => {
    let t = 0;
    const now = () => t;
    expect(stablePhotoUrl(SIGNED_A, now)).toBe(SIGNED_A);
    t = TEN_MIN - 1;
    expect(stablePhotoUrl(SIGNED_B, now)).toBe(SIGNED_A);
    t = TEN_MIN + 1;
    // Expired + different: still the old URL — adoption waits for the
    // replacement's bytes to be in the browser cache (jsdom never fires
    // the load event, so the pin persists for the whole test).
    expect(stablePhotoUrl(SIGNED_B, now)).toBe(SIGNED_A);
    expect(stablePhotoUrl(SIGNED_B, now)).toBe(SIGNED_A);
  });
});
