import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import process from "node:process";

const ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const KEY_BYTE_LENGTH = 32;

export type EncryptedSecretPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function resolveEncryptionKey(source?: string): Buffer {
  const value = source ?? process.env.APP_ENCRYPTION_KEY;

  if (!value || value.trim().length === 0) {
    throw new Error("APP_ENCRYPTION_KEY is required");
  }

  const key = Buffer.from(value, "utf8");

  if (key.length !== KEY_BYTE_LENGTH) {
    throw new Error("APP_ENCRYPTION_KEY must be exactly 32 bytes");
  }

  return key;
}

export function encryptSecret(
  plaintext: string,
  options?: { key?: string; keyVersion?: number },
): EncryptedSecretPayload {
  const key = resolveEncryptionKey(options?.key);
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: options?.keyVersion ?? 1,
  };
}

export function decryptSecret(
  payload: EncryptedSecretPayload,
  options?: { key?: string },
): string {
  const key = resolveEncryptionKey(options?.key);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
