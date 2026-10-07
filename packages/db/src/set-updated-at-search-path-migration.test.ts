import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMigrationDatabasePool } from "./index.js";

const migration = readFile(
  new URL("../migrations/0092_set_updated_at_search_path.sql", import.meta.url),
  "utf8",
);

test("0092 restores the 0025 search_path pin that 0088's CREATE OR REPLACE dropped", async () => {
  const source = await migration;
  assert.match(source, /ALTER FUNCTION public\.set_updated_at\(\) SET search_path = public, extensions, pg_temp;/);
  assert.doesNotMatch(source, /CREATE OR REPLACE FUNCTION/i);
});

test("0092: set_updated_at keeps its pinned search_path and the 0088 preservation body", {
  skip: !process.env.DATABASE_MIGRATION_URL,
}, async () => {
  const pool = createMigrationDatabasePool(process.env.DATABASE_MIGRATION_URL!, "dabboba-set-updated-at-search-path");
  try {
    const result = await pool.query<{ config: string[] | null; body: string }>(
      `SELECT proconfig AS config, prosrc AS body
         FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure`,
    );
    assert.deepEqual(result.rows[0]?.config, ["search_path=public, extensions, pg_temp"]);
    assert.match(result.rows[0]?.body ?? "", /dabboba\.preserve_updated_at/);
  } finally {
    await pool.end();
  }
});
