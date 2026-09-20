import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../migrations/0041_customer_auth_runtime_grant.sql", import.meta.url),
  "utf8",
);

test("0041 grants only the verified timestamp update needed by idempotent customer identity linking", () => {
  assert.match(
    sql,
    /GRANT UPDATE \(verified_at\)\s+ON TABLE public\.auth_identities\s+TO dabboba_runtime/i,
  );
  assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE|UPDATE \([^)]*(?:user_id|provider|provider_subject)/i);
  assert.doesNotMatch(sql, /GRANT\s+(?:DELETE|TRUNCATE|TRIGGER|REFERENCES|ALL)/i);
});
