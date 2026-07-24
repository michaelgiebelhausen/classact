import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * At-rest encryption for professor OpenRouter keys (BYOK vault).
 * AES-256-GCM with a server-only APP_ENCRYPTION_KEY (64 hex chars).
 * Ciphertext format: base64( iv[12] | authTag[16] | data ).
 * Plaintext keys exist only transiently inside server actions — never in
 * logs, never in the client, never at rest.
 *
 * (No "server-only" marker so the vitest suite can exercise it; the
 * node:crypto import hard-fails any client bundle that touches this file.)
 */

function keyBytes(): Buffer {
  const hex = env.appEncryptionKey;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
