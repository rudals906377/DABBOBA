import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0017_active_draw_prize_guards.sql", import.meta.url),
  "utf8",
);
const concurrencyMigration = readFile(
  new URL("../migrations/0018_draw_prize_concurrency_guard.sql", import.meta.url),
  "utf8",
);

test("active draw prize migration fails closed for an invalid legacy pool", async () => {
  const source = await migration;

  assert.match(source, /version\.status = 'ACTIVE'/);
  assert.match(source, /NOT prize_product\.is_active OR NOT prize_product\.is_prize_only/);
  assert.match(source, /retire the affected version before migrating/);
});

test("draw activation and later prize deactivation remain database guarded", async () => {
  const source = await migration;

  assert.match(source, /OLD\.status = 'DRAFT' AND NEW\.status = 'ACTIVE'/);
  assert.match(source, /entry\.prize_name_snapshot IS DISTINCT FROM prize_product\.name/);
  assert.match(source, /entry\.prize_image_url_snapshot IS DISTINCT FROM prize_product\.image_url/);
  assert.match(source, /version\.status = 'ACTIVE'/);
  assert.match(source, /A prize used by an active draw version cannot be deactivated/);
});

test("activation and deactivation share a transaction lock and re-read locked rows", async () => {
  const source = await concurrencyMigration;

  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\('active-draw-prize-catalog-state', 0\)\)/);
  assert.match(source, /FOR EACH STATEMENT EXECUTE FUNCTION lock_active_draw_prize_catalog_state\(\)/);
  assert.match(source, /FOR SHARE OF prize_product, draw_product/);
  assert.match(source, /FOR SHARE OF version/);
});
