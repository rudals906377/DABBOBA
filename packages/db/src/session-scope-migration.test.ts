import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0077_session_scope.sql", import.meta.url);

test("session scope column defaults to FULL and admits only reviewed scopes", async () => {
  const source = await readFile(migration, "utf8");
  assert.match(
    source,
    /ALTER TABLE public\.sessions\s+ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'FULL'/i,
  );
  assert.match(source, /CHECK \(scope IN \('FULL','ACCOUNT_DELETION'\)\)/);
  assert.match(source, /CHECK \(scope = 'FULL' OR session_kind = 'USER'\)/);
  // Constraints are guarded so a re-run is a no-op.
  assert.equal(source.match(/IF NOT EXISTS \(\s+SELECT 1 FROM pg_constraint/g)?.length, 2);
  // No privilege change: the worker's reviewed column allow-list stays untouched.
  assert.doesNotMatch(source.replace(/^--.*$/gm, ""), /GRANT|REVOKE/i);
});
