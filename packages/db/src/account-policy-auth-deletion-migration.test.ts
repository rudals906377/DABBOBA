import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0053_account_policy_and_auth_deletion.sql", import.meta.url),
  "utf8",
);

test("account policy evidence is versioned, immutable, and backend-only", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE user_policy_acceptances/i);
  assert.match(source, /policy_key IN \('TERMS','PRIVACY'\)/i);
  assert.match(source, /policy_version ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'/i);
  assert.match(source, /UNIQUE \(user_id, policy_key, policy_version\)/i);
  assert.match(source, /ALTER TABLE user_policy_acceptances ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE user_policy_acceptances FROM PUBLIC, anon, authenticated/i);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE user_policy_acceptances TO dabboba_runtime/i);
  assert.match(source, /GRANT UPDATE \(ip_address, user_agent\) ON TABLE user_policy_acceptances TO dabboba_runtime/i);
  assert.doesNotMatch(source, /GRANT\s+(?:DELETE|TRUNCATE)[^;]*user_policy_acceptances/i);
});

test("Supabase Auth deletion work is transient and split between API and worker", async () => {
  const source = await migration;

  assert.match(source, /auth_deletion_status IN \('NOT_REQUIRED','PENDING','COMPLETED'\)/i);
  assert.match(source, /CREATE TABLE account_auth_deletion_jobs/i);
  assert.match(source, /supabase_user_id uuid NOT NULL/i);
  assert.match(source, /status text NOT NULL DEFAULT 'PENDING' CHECK \(status IN \('PENDING','PROCESSING'\)\)/i);
  assert.match(source, /deletion_request_id uuid NOT NULL UNIQUE[\s\S]*ON DELETE CASCADE/i);
  assert.match(source, /ALTER TABLE account_auth_deletion_jobs ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE account_auth_deletion_jobs FROM PUBLIC, anon, authenticated/i);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE account_auth_deletion_jobs TO dabboba_runtime/i);
  assert.match(source, /GRANT SELECT, UPDATE, DELETE ON TABLE account_auth_deletion_jobs TO dabboba_worker/i);
  assert.match(source, /GRANT UPDATE \(auth_deletion_status, auth_deleted_at\)[\s\S]*TO dabboba_worker/i);
  assert.doesNotMatch(source, /PASSWORD|DATABASE_URL|service_role/i);
});
