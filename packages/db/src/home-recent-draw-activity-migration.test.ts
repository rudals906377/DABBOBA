import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../migrations/0046_home_recent_draw_activity.sql", import.meta.url);

test("Home recent draw activity has a global newest-first index without mutable public state", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /CREATE INDEX draw_results_committed_idx/i);
  assert.match(source, /ON public\.draw_results \(committed_at DESC, id DESC\)/i);
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|GRANT|user_id|nickname/i);
});
