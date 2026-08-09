import "server-only";
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for `integration_credentials.ciphertext` — the one
 * place in this codebase that must store a genuinely RETRIEVABLE secret (a
 * provider adapter has to actually present it to send), unlike
 * `agent_credentials`' one-way SHA-256 hash. Fails closed: with no
 * `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` configured, encryption is simply
 * unavailable rather than ever falling back to plaintext storage.
 */

export class IntegrationCredentialEncryptionUnavailableError extends Error {
  constructor() {
    super("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY is not configured — cannot store a real provider credential");
    this.name = "IntegrationCredentialEncryptionUnavailableError";
  }
}

function resolveKey(rawKey: string | undefined): Buffer {
  if (!rawKey) throw new IntegrationCredentialEncryptionUnavailableError();
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)");
  }
  return key;
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptCredentialSecret(rawKey: string | undefined, plaintext: string): EncryptedSecret {
  const key = resolveKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: authTag.toString("base64") };
}

export function decryptCredentialSecret(rawKey: string | undefined, encrypted: EncryptedSecret): string {
  const key = resolveKey(rawKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Constant-time comparison for webhook signature verification — never a plain `===` on attacker-supplied bytes. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
