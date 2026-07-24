import { beforeAll, describe, expect, it } from "vitest";

/**
 * APP_ENCRYPTION_KEY must exist before lib/env is first imported, so the
 * module under test is loaded dynamically after stubbing the environment.
 */

let encryptSecret: (s: string) => string;
let decryptSecret: (s: string) => string;

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  const mod = await import("@/lib/aicrypto");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
});

describe("aicrypto (BYOK vault)", () => {
  it("round-trips a key and never stores plaintext", () => {
    const secret = "sk-or-v1-test-abcdef1234567890";
    const ciphertext = encryptSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(ciphertext).not.toContain("sk-or");
    expect(decryptSecret(ciphertext)).toBe(secret);
  });

  it("produces distinct ciphertexts per call (fresh IV)", () => {
    const secret = "sk-or-v1-same-secret";
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const ciphertext = encryptSecret("sk-or-v1-integrity");
    const raw = Buffer.from(ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
});
