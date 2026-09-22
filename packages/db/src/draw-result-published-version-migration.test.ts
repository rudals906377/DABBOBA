import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0037_draw_result_published_version.sql", import.meta.url),
  "utf8",
);

function normalizeSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

test("draw results require a published active or retired probability version", async () => {
  const source = normalizeSql(await migration);

  assert.match(source, /CREATE OR REPLACE FUNCTION public\.guard_draw_result_published_version\(\)/);
  assert.match(source, /SET search_path = pg_catalog, public/);
  assert.match(source, /FOR SHARE OF version/);
  assert.match(source, /probability_version_status NOT IN \('ACTIVE','RETIRED'\)/);
  assert.match(source, /probability_version_published_at IS NULL/);
  assert.match(source, /USING ERRCODE = '23514'/);
  assert.match(source, /BEFORE INSERT ON public\.draw_results/);
  assert.match(
    source,
    /REVOKE EXECUTE ON FUNCTION public\.guard_draw_result_published_version\(\) FROM PUBLIC/,
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(source, new RegExp(`rolname = '${role}'`));
  }
  assert.doesNotMatch(source, /PASSWORD|DATABASE_URL|SECURITY DEFINER|EXECUTE\s+format/i);
});
