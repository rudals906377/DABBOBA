import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0058_active_policy_gate_and_apple_revocation.sql", import.meta.url),
  "utf8",
);

test("Apple revocation material is encrypted, backend-only, and deleted by the worker", async () => {
  const source = await migration;
  assert.match(source, /CREATE TABLE public\.apple_auth_credentials/i);
  assert.match(source, /credential_kind = 'REFRESH_TOKEN'/i);
  assert.match(source, /ciphertext bytea/i);
  assert.match(source, /nonce bytea[\s\S]*octet_length\(nonce\) = 12/i);
  assert.match(source, /auth_tag bytea[\s\S]*octet_length\(auth_tag\) = 16/i);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE[\s\S]*TO dabboba_runtime/i);
  assert.match(source, /GRANT SELECT, DELETE[\s\S]*TO dabboba_worker/i);
  assert.match(source, /ADD COLUMN apple_revoked_at timestamptz/i);
  assert.doesNotMatch(source, /APPLE_CLIENT_SECRET|refresh_token\s+text|PASSWORD/i);
});

test("active-session reconsent has its own append-only evidence source", async () => {
  const source = await migration;
  assert.match(source, /MOBILE_RECONSENT/);
  assert.match(source, /MOBILE_LOGIN/);
  assert.match(source, /WEB_ACCOUNT_DELETION/);
  assert.match(source, /UGC_OPERATION/);
});
