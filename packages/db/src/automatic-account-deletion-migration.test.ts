import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0056_legal_acceptance_and_automatic_account_deletion.sql", import.meta.url),
  "utf8",
);

test("published legal documents and acceptance evidence are canonical, append-only, and backend-only", async () => {
  const source = await migration;
  assert.match(source, /CREATE TABLE public\.legal_document_versions/i);
  assert.match(source, /content_sha256 char\(64\)/i);
  assert.match(source, /CREATE TABLE public\.user_policy_acceptance_events/i);
  assert.match(source, /user_policy_acceptance_events_immutable/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.legal_document_versions, public\.user_policy_acceptance_events\s+FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(source, /GRANT\s+(?:UPDATE|DELETE|TRUNCATE)[^;]*user_policy_acceptance_events/i);
  assert.match(source, /intentionally stores no raw IP address or user-agent/i);
});

test("automatic deletion adds a retry-safe processing state and preserves local identity until the worker", async () => {
  const source = await migration;
  assert.match(source, /'PROCESSING'/);
  assert.match(source, /ALTER COLUMN supabase_user_id DROP NOT NULL/i);
  assert.match(source, /ADD COLUMN external_deleted_at timestamptz/i);
  assert.match(source, /status IN \('PROCESSING','APPROVED'\)/i);
  assert.match(source, /AUTOMATED_ACCOUNT_DELETION/);
  assert.match(source, /GRANT SELECT, DELETE ON TABLE public\.auth_identities TO dabboba_worker/i);
});
