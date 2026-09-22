import { createCipheriv, randomBytes } from "node:crypto";
import { badRequest } from "./errors.js";

export type SealedAppleCredential = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

function encryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, encoded.includes("-") || encoded.includes("_") ? "base64url" : "base64");
  if (key.length !== 32) throw new Error("Apple credential encryption is not configured correctly");
  return key;
}

export function validateAppleRefreshToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 32 || value.length > 16_384 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw badRequest("Apple 로그인 삭제 자격 증명을 확인하지 못했습니다.");
  }
  return value;
}

export function appleCredentialAad(userId: string, keyVersion: number): Buffer {
  return Buffer.from(`dabboba:apple-refresh-token:${userId}:v${keyVersion}`, "utf8");
}

export function sealAppleRefreshToken(input: {
  token: string;
  userId: string;
  encodedKey: string;
  keyVersion: number;
}): SealedAppleCredential {
  const token = validateAppleRefreshToken(input.token);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(input.encodedKey), nonce);
  cipher.setAAD(appleCredentialAad(input.userId, input.keyVersion));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: input.keyVersion,
  };
}
