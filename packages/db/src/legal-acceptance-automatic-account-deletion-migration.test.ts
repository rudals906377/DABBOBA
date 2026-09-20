import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0056_legal_acceptance_and_automatic_account_deletion.sql", import.meta.url),
  "utf8",
);

test("published legal versions are canonical, current, and backend-only", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.legal_document_versions/i);
  assert.match(source, /PRIMARY KEY \(policy_key, policy_version\)/i);
  assert.match(source, /CREATE UNIQUE INDEX legal_document_versions_current_idx[\s\S]*WHERE superseded_at IS NULL/i);
  assert.match(source, /\('TERMS','2026-09-14','[0-9a-f]{64}'/i);
  assert.match(source, /\('PRIVACY','2026-09-20','[0-9a-f]{64}'/i);
  assert.match(source, /ALTER TABLE public\.legal_document_versions ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.legal_document_versions, public\.user_policy_acceptance_events[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(source, /GRANT SELECT ON TABLE public\.legal_document_versions TO dabboba_runtime/i);
  assert.match(source, /CREATE TRIGGER legal_document_versions_immutable[\s\S]*BEFORE UPDATE OR DELETE/i);
  assert.match(source, /only first supersession is allowed/i);
  assert.doesNotMatch(source, /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*legal_document_versions[^;]*dabboba_runtime/i);
});

test("policy acceptance evidence binds the published digest and cannot be rewritten", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.user_policy_acceptance_events/i);
  assert.match(source, /content_sha256 char\(64\)[\s\S]*FOREIGN KEY \(policy_key,policy_version\)/i);
  assert.match(source, /source text NOT NULL CHECK \(source IN \('MOBILE_LOGIN','WEB_ACCOUNT_DELETION'\)\)/i);
  assert.match(source, /correlation_id text NOT NULL CHECK \(char_length\(correlation_id\) BETWEEN 1 AND 200\)/i);
  assert.match(source, /CREATE TRIGGER user_policy_acceptance_events_immutable[\s\S]*BEFORE UPDATE OR DELETE/i);
  assert.match(source, /CREATE UNIQUE INDEX user_policy_acceptance_events_document_once_idx[\s\S]*\(user_id,policy_key,policy_version\)/i);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE public\.user_policy_acceptance_events TO dabboba_runtime/i);
  assert.doesNotMatch(source, /user_policy_acceptance_events[\s\S]{0,240}\b(?:ip_address|user_agent)\b/i);
});

test("automatic deletion keeps a receipt while external identity cleanup is retryable", async () => {
  const source = await migration;

  assert.match(source, /ADD COLUMN status_token_digest char\(64\)/i);
  assert.match(source, /status IN \('PENDING_REVIEW','BLOCKED','PROCESSING','APPROVED','COMPLETED','REJECTED','CANCELLED'\)/i);
  assert.match(source, /reason = 'AUTOMATED_ACCOUNT_DELETION'/i);
  assert.match(source, /OLD\.status = 'PROCESSING' AND NEW\.status IN \('BLOCKED','COMPLETED'\)/i);
  assert.match(source, /status IN \('PROCESSING','APPROVED'\)[\s\S]*processing account deletion blocks new mutations/i);
  assert.match(source, /ALTER COLUMN supabase_user_id DROP NOT NULL/i);
  assert.match(source, /ADD COLUMN external_deleted_at timestamptz/i);
  assert.match(source, /GRANT SELECT, UPDATE[\s\S]*ON TABLE public\.account_deletion_requests TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, DELETE ON TABLE public\.auth_identities TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, DELETE ON TABLE public\.inquiry_message_media TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, UPDATE \(title\) ON TABLE public\.inquiries TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, UPDATE \(content\) ON TABLE public\.inquiry_messages TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT ON TABLE public\.draw_entitlements, public\.inventory_units,[\s\S]*public\.exchange_listings, public\.exchange_offers TO dabboba_worker/i);
});
