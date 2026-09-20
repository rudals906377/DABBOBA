import assert from "node:assert/strict";
import test from "node:test";
import { sealAppleRefreshToken, validateAppleRefreshToken } from "./apple-credential.js";

test("Apple refresh tokens are sealed with randomized AES-GCM envelopes", () => {
  const token = "apple-refresh-" + "x".repeat(64);
  const input = {
    token,
    userId: "7aa68a27-b48f-4ad9-bfac-5cf8b1ae8077",
    encodedKey: Buffer.alloc(32, 5).toString("base64url"),
    keyVersion: 1,
  };
  const first = sealAppleRefreshToken(input);
  const second = sealAppleRefreshToken(input);
  assert.equal(first.nonce.length, 12);
  assert.equal(first.authTag.length, 16);
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.equal(first.ciphertext.includes(Buffer.from(token, "utf8")), false);
  assert.equal(JSON.stringify(first).includes(token), false);
});

test("Apple refresh token validation rejects absent and whitespace-bearing credentials", () => {
  assert.throws(() => validateAppleRefreshToken(undefined));
  assert.throws(() => validateAppleRefreshToken("x".repeat(32) + "\n"));
  assert.equal(validateAppleRefreshToken("x".repeat(64)), "x".repeat(64));
});
