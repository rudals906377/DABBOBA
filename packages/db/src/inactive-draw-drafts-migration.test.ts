import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/0048_inactive_draw_drafts.sql", import.meta.url);

test("inactive sale products may prepare drafts but cannot publish them", async () => {
  const source = await readFile(migrationUrl, "utf8");

  assert.match(source, /new_draw_is_prize_only OR new_draw_category NOT IN \('gacha','kuji'\)/);
  assert.doesNotMatch(source, /NOT new_draw_is_active OR new_draw_is_prize_only/);
  assert.match(source, /OLD\.status = 'DRAFT' AND NEW\.status = 'ACTIVE'/);
  assert.match(source, /OR NOT draw_is_active/);
  assert.match(source, /draw_probability_versions_active_product_guard/);
  assert.match(source, /Draw pool prizes must reference active prize-only products/);
  assert.match(source, /NEW\.remaining_quantity = OLD\.remaining_quantity - 1/);
});
