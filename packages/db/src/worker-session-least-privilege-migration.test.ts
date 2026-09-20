import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../migrations/0060_worker_session_least_privilege.sql",
  import.meta.url,
);

test("worker session visibility excludes token and request metadata", async () => {
  const source = await readFile(migration, "utf8");
  assert.match(source, /REVOKE SELECT ON TABLE public\.sessions FROM dabboba_worker/i);
  assert.match(
    source,
    /GRANT SELECT \(id,user_id,session_kind,revoked_at,expires_at\)\s+ON TABLE public\.sessions TO dabboba_worker/i,
  );
  const grant = source.match(/GRANT SELECT \(([^)]+)\)/i)?.[1] ?? "";
  for (const forbidden of ["token_digest", "ip_address", "user_agent", "revoke_reason"]) {
    assert.doesNotMatch(grant, new RegExp(forbidden, "i"));
  }
  assert.match(source, /information_schema\.column_privileges/i);
});
