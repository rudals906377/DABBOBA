import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("0089 lets the API only record an orphan broker user and the worker alone process it", async () => {
  const source = await readFile(
    new URL("../migrations/0089_supabase_auth_orphan_cleanups.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /supabase_user_id uuid NOT NULL UNIQUE/);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /REVOKE ALL ON TABLE public\.supabase_auth_orphan_cleanups FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(source, /GRANT SELECT, INSERT ON TABLE public\.supabase_auth_orphan_cleanups TO dabboba_runtime;/);
  assert.match(source, /GRANT SELECT, UPDATE, DELETE ON TABLE public\.supabase_auth_orphan_cleanups TO dabboba_worker;/);
  assert.doesNotMatch(source, /GRANT [A-Z, ]*(UPDATE|DELETE)[A-Z, ]* ON TABLE public\.supabase_auth_orphan_cleanups TO dabboba_runtime/);
});
