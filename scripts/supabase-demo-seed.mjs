#!/usr/bin/env node
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createMigrationDatabasePool } from '../packages/db/dist/index.js';
import {
  SUPABASE_DEMO_PROFILE,
  SUPABASE_DEMO_PROJECT_REF,
  assertSupabaseDemoApiEnvironment,
  readSelectedBackendProfile,
  supabaseDemoApiEnvironment,
} from './supabase-integration-profile.mjs';

const KUJI_POOL_IDS = Object.freeze([
  'da300000-0000-4000-8000-000000000001',
  'da300000-0000-4000-8000-000000000002',
  'da300000-0000-4000-8000-000000000003',
  'da300000-0000-4000-8000-000000000004',
  'da300000-0000-4000-8000-000000000005',
]);

function sealedKujiAssignmentValues() {
  const shuffled = KUJI_POOL_IDS.flatMap((id) => [id, id]);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled.map((id, index) => `(${index + 1},'${id}'::uuid)`).join(',\n  ');
}

async function main() {
  const mode = process.argv[2];
  if (!['--check', '--apply'].includes(mode) || process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/supabase-demo-seed.mjs <--check|--apply>\n');
    process.exitCode = 64;
    return;
  }
  const selected = readSelectedBackendProfile();
  if (selected !== SUPABASE_DEMO_PROFILE) {
    throw new Error('Select the explicit supabase-demo profile before checking or applying its fixtures.');
  }
  const env = assertSupabaseDemoApiEnvironment(supabaseDemoApiEnvironment(process.env));
  const source = parseEnv(readFileSync('.env', 'utf8'));
  const migrationUrl = source.DATABASE_MIGRATION_URL;
  if (!migrationUrl) throw new Error('Supabase demo migration database URL is missing.');
  const runtimeTarget = new URL(env.DATABASE_URL);
  const migrationTarget = new URL(migrationUrl);
  if (
    !['postgres:', 'postgresql:'].includes(migrationTarget.protocol)
    || migrationTarget.hostname !== runtimeTarget.hostname
    || migrationTarget.port !== '5432'
    || migrationTarget.pathname !== '/postgres'
    || decodeURIComponent(migrationTarget.username) !== `postgres.${SUPABASE_DEMO_PROJECT_REF}`
    || !migrationTarget.password
    || migrationTarget.search
    || migrationTarget.hash
  ) throw new Error('Supabase demo migration database target does not match the approved project.');
  const pool = createMigrationDatabasePool(migrationUrl, 'dabboba-supabase-demo-seed');
  try {
    if (mode === '--apply') {
      const template = await readFile(fileURLToPath(new URL('./supabase-demo-seed.sql', import.meta.url)), 'utf8');
      const marker = '__DABBOBA_KUJI_ASSIGNMENTS__';
      if (template.split(marker).length !== 2) throw new Error('Supabase demo seed template is invalid.');
      const sql = template.replace(marker, sealedKujiAssignmentValues());
      await pool.query(sql);
    }
    const result = await pool.query(`SELECT
      (SELECT count(*)::integer FROM users
        WHERE id='da000000-0000-4000-8000-00000000000a'
          AND email='member01@dabboba.local' AND role='USER' AND status='ACTIVE') AS active_customer_accounts,
      (SELECT count(*)::integer FROM users
        WHERE status='ACTIVE' AND (
          id='da000000-0000-4000-8000-00000000000b'
          OR email='mobile-test@dabboba.local')) AS duplicate_active_accounts,
      (SELECT count(*)::integer FROM catalog_products WHERE metadata->>'dabbobaFixture'='supabase-demo-v1') AS products,
      (SELECT count(*)::integer FROM draw_probability_versions WHERE product_id IN (
        'demo-test-gacha','demo-test-kuji') AND status='ACTIVE') AS active_draws,
      (SELECT count(*)::integer FROM kuji_slot_assignments WHERE probability_version_id=
        'da100000-0000-4000-8000-000000000002') AS kuji_slots,
      (SELECT count(*)::integer FROM default_shipping_addresses
        WHERE delivery_note='supabase-demo-v1: 실제 배송 금지') AS fixture_addresses`);
    const state = result.rows[0];
    if (!state || state.active_customer_accounts !== 1 || state.duplicate_active_accounts !== 0
      || state.products !== 12 || state.active_draws !== 2
      || state.kuji_slots !== 10 || state.fixture_addresses !== 0) {
      throw new Error('Supabase demo fixtures are incomplete or do not match the approved identifiers.');
    }
    process.stdout.write('Supabase demo fixtures verified: activeCustomerAccounts=1 products=12 activeDraws=2 kujiSlots=10 fixtureAddresses=0\n');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('Supabase demo fixture operation failed without exposing connection details.\n');
  process.exitCode = 1;
});
