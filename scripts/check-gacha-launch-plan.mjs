import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createMigrationDatabasePool } from '../packages/db/dist/index.js';
import { supabaseProjectRefFromDatabaseUrl, SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';

const planUrl = new URL('../ops/catalog/gacha-launch-plan-2026-10-14.json', import.meta.url);

/** Read-only reconciliation. This command never adjusts stock or publishes odds. */
export async function checkGachaLaunchPlan({ plan = JSON.parse(readFileSync(planUrl, 'utf8')), databaseUrl } = {}) {
  assert.equal(plan.sourceProject, SUPABASE_INTEGRATION_PROJECT_REF);
  assert.equal(plan.purchaseMode, 'DRAW_ENTITLEMENT');
  assert.equal(plan.status, 'DRAFT_NOT_APPLIED');
  assert.equal(plan.preserveHistoricalDirectStock, true);
  assert.equal(plan.products.length, 8);
  const ids = new Set();
  let total = 0;
  for (const product of plan.products) {
    assert.equal(product.saleStatus, 'COMING_SOON');
    assert.equal(product.publish, false);
    assert.ok(Number.isSafeInteger(product.unitPrice) && product.unitPrice > 0);
    assert.equal(product.targetOnHand, product.entries.length * 20);
    for (const entry of product.entries) {
      assert.equal(entry.quantity, 20);
      assert.equal(entry.weight, 1);
      assert.ok(entry.prizeProductId.startsWith(`${product.productId}-prize-`));
      assert.ok(!ids.has(entry.prizeProductId));
      ids.add(entry.prizeProductId);
      total += entry.quantity;
    }
  }
  assert.equal(ids.size, 46);
  assert.equal(total, 920);
  const result = { status: 'draft-validated', series: 8, includedItems: 46, targetUnits: total, productionWrites: false };
  if (!databaseUrl) return result;
  assert.equal(supabaseProjectRefFromDatabaseUrl(databaseUrl), SUPABASE_INTEGRATION_PROJECT_REF);
  const pool = createMigrationDatabasePool(databaseUrl, 'dabboba-launch-plan-readonly');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const snapshot = await client.query(`SELECT p.id,p.price,p.sale_status,s.on_hand,s.reserved,s.version,
      (SELECT count(*)::int FROM draw_probability_versions v WHERE v.product_id=p.id AND v.status='ACTIVE') AS active_versions
      FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=ANY($1::text[])`, [plan.products.map(p => p.productId)]);
    assert.equal(snapshot.rowCount, 8);
    const prizes = await client.query('SELECT id,price,is_prize_only,metadata FROM catalog_products WHERE id=ANY($1::text[])', [[...ids]]);
    assert.equal(prizes.rowCount, 46);
    result.products = plan.products.map(product => {
      const current = snapshot.rows.find(p => p.id === product.productId);
      assert.equal(Number(current.price), product.unitPrice);
      for (const entry of product.entries) {
        const prize = prizes.rows.find(p => p.id === entry.prizeProductId);
        assert.equal(prize.is_prize_only, true);
        assert.equal(prize.metadata.parentProductId, product.productId);
        assert.equal(Number(prize.price), product.unitPrice);
      }
      return { productId: product.productId, currentOnHand: current.on_hand, targetOnHand: product.targetOnHand,
        adjustmentNeeded: product.targetOnHand - current.on_hand, stockVersion: current.version,
        reserved: current.reserved, activeVersions: current.active_versions, saleStatus: current.sale_status };
    });
    await client.query('ROLLBACK');
    return result;
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--production-readonly')) throw new Error('Only --production-readonly is supported.');
  const databaseUrl = args.includes('--production-readonly')
    ? parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')).DATABASE_MIGRATION_URL : undefined;
  checkGachaLaunchPlan({ databaseUrl }).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Launch plan check failed; inspect the pinned catalog privately. No stock was changed.'); process.exitCode = 1; });
}
