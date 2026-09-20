#!/usr/bin/env node
// Opt-in, clone-only: never loads .env, contacts Supabase or drops a database.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { backupMain, openArchive, sealArchive } from './backup.mjs';
import { packBackupBundle, unpackBackupBundle } from './backup-pgmq.mjs';

const { Pool } = createRequire(new URL('../../packages/db/package.json', import.meta.url))('pg');
const run = promisify(execFile);
const container = process.env.DABBOBA_BACKUP_TEST_CONTAINER;
const source = process.env.DABBOBA_BACKUP_TEST_SOURCE_DATABASE;
if (container !== 'dabboba-backend-integration-20260905') throw new Error('Explicit dedicated test container required.');
if (!/^dabboba_restore_drill_[a-z0-9_]+$/.test(source ?? '')) throw new Error('An explicit disposable restore-clone source is required.');
const target = `dabboba_restore_drill_${Date.now()}`;
const ports = JSON.parse((await run('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Ports}}'])).stdout);
const mapping = ports['5432/tcp']?.find((entry) => entry.HostIp === '127.0.0.1');
assert.ok(mapping && /^[0-9]+$/.test(mapping.HostPort), 'fixture PostgreSQL needs a known loopback port');
const pools = new Map();
const password = 'dabboba-disposable-local-only-20260905';
const latestMigrations = [
  '0038_shipping_request_item_snapshots.sql',
  '0039_retire_prototype_catalog.sql',
  '0049_shipping_storage_policy.sql',
  '0050_shipping_fee_policy.sql',
];
const latestMigrationSources = Object.fromEntries(await Promise.all(latestMigrations.map(async (version) => [
  version, await readFile(new URL(`../../packages/db/migrations/${version}`, import.meta.url), 'utf8'),
])));
const latestMigrationChecksums = Object.fromEntries(latestMigrations.map((version) => [
  version, createHash('sha256').update(latestMigrationSources[version]).digest('hex'),
]));
const retiredPrototypeProductIds = [
  'one-piece-tcg', 'dragon-ball-figure', 'demon-slayer-gacha', 'jujutsu-kaisen-gacha',
  'naruto-figure', 'bleach-figure', 'my-hero-academia-figure', 'hunter-x-hunter-kuji',
  'chainsaw-man-figure', 'attack-on-titan-figure', 'jojos-bizarre-adventure-kuji',
  'spy-x-family-gacha', 'haikyu-gacha', 'blue-lock-gacha', 'oshi-no-ko-gacha',
  'frieren-figure', 'cyberpunk-edgerunners-figure', 'dandadan-gacha', 'kaiju-no-8-kuji',
  'evangelion-kuji', 'mobile-suit-gundam-kuji', 'pokemon-tcg', 'detective-conan-gacha',
  'tokyo-revengers-kuji', 'that-time-i-got-reincarnated-as-a-slime-kuji',
];
const retiredPrototypeIpIds = [
  'one-piece', 'dragon-ball', 'demon-slayer', 'jujutsu-kaisen', 'naruto', 'bleach',
  'my-hero-academia', 'hunter-x-hunter', 'chainsaw-man', 'attack-on-titan',
  'jojos-bizarre-adventure', 'spy-x-family', 'haikyu', 'blue-lock', 'oshi-no-ko',
  'frieren', 'cyberpunk-edgerunners', 'dandadan', 'kaiju-no-8', 'evangelion',
  'mobile-suit-gundam', 'pokemon', 'detective-conan', 'tokyo-revengers',
  'that-time-i-got-reincarnated-as-a-slime',
];
const ident = (name) => `"${name.replaceAll('"','""')}"`;
function pool(database) {
  if (!pools.has(database)) pools.set(database, new Pool({
    host: '127.0.0.1', port: Number(mapping.HostPort), user: 'postgres', password, database,
    ssl: false, max: 3, connectionTimeoutMillis: 5000, query_timeout: 120000,
    options: '-c statement_timeout=120000 -c search_path=pg_catalog -c timezone=UTC',
  }));
  return pools.get(database);
}
async function rows(database, statement, parameters) { return (await pool(database).query(statement, parameters)).rows; }
async function scalar(database, statement, parameters) { return Object.values((await rows(database, statement, parameters))[0])[0]; }
async function fingerprint(database) {
  const output = {};
  const tables = await rows(database, "SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgmq') AND c.relkind IN ('r','p') ORDER BY 1,2");
  for (const { nspname, relname } of tables) output[`${nspname}.${relname}`] = await scalar(database,
    `SELECT count(*) || ':' || md5(COALESCE(string_agg(row_hash, ',' ORDER BY row_hash),'')) FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM ${ident(nspname)}.${ident(relname)} t) hashes`);
  return output;
}
async function sequenceState(database) {
  const sequences = await rows(database, `SELECT n.nspname,c.relname,format_type(s.seqtypid,-1) AS type,
    s.seqstart::text,s.seqincrement::text,s.seqmin::text,s.seqmax::text,s.seqcache::text,s.seqcycle,
    owner_ns.nspname AS owner_schema,owner_table.relname AS owner_table,a.attname AS owner_column,d.deptype
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')
    LEFT JOIN pg_class owner_table ON owner_table.oid=d.refobjid
    LEFT JOIN pg_namespace owner_ns ON owner_ns.oid=owner_table.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
    WHERE n.nspname IN ('public','pgmq') ORDER BY 1,2`);
  for (const sequence of sequences) Object.assign(sequence, (await rows(database,
    `SELECT last_value::text,is_called FROM ${ident(sequence.nspname)}.${ident(sequence.relname)}`))[0]);
  return sequences;
}

async function compareConstraints(sourceDatabase, targetDatabase) {
  const query = `SELECT ns.nspname,t.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,c.connoinherit,
    c.confupdtype,c.confdeltype,c.confmatchtype,fn.nspname AS foreign_schema,ft.relname AS foreign_table,
    (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) AS columns,
    (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) AS foreign_columns,
    pg_get_constraintdef(c.oid,false) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    LEFT JOIN pg_class ft ON ft.oid=c.confrelid LEFT JOIN pg_namespace fn ON fn.oid=ft.relnamespace
    WHERE ns.nspname IN ('public','pgmq') ORDER BY 1,2,3`;
  const [original, restored] = await Promise.all([rows(sourceDatabase, query), rows(targetDatabase, query)]);
  const metadata = (items) => items.map(({ definition, ...entry }) => entry);
  assert.deepEqual(metadata(restored), metadata(original), 'constraint identity/column/enforcement metadata differs');
  const client = await pool(targetDatabase).connect();
  let checkCount = 0;
  try {
    await client.query('BEGIN');
    for (const [index, constraint] of original.entries()) {
      const targetConstraint = restored[index];
      if (constraint.contype !== 'c') {
        assert.equal(targetConstraint.definition, constraint.definition);
        continue;
      }
      // Parse both CHECK definitions on the SAME empty table. Do not strip casts
      // or Boolean grouping: PostgreSQL supplies the semantic normalization.
      const probeName = `backup_check_probe_${checkCount++}`;
      const probe = ident(probeName);
      await client.query(`CREATE TEMP TABLE ${probe} (LIKE ${ident(constraint.nspname)}.${ident(constraint.relname)}) ON COMMIT DROP`);
      await client.query(`ALTER TABLE pg_temp.${probe} ADD CONSTRAINT probe_source ${constraint.definition}`);
      await client.query(`ALTER TABLE pg_temp.${probe} ADD CONSTRAINT probe_restored ${targetConstraint.definition}`);
      const expressions = (await client.query('SELECT pg_get_expr(conbin,conrelid,false) AS expression FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname', [`pg_temp.${probeName}`])).rows;
      assert.equal(expressions.length, 2);
      assert.equal(expressions[0].expression, expressions[1].expression, `${constraint.relname}.${constraint.conname}`);
    }
  } finally { await client.query('ROLLBACK'); client.release(); }
  return { constraints: original.length, checksReparsed: checkCount };
}

async function createLatestMigrationFixture(database) {
  const suffix = randomBytes(6).toString('hex');
  const userId = randomUUID();
  const ipId = `backup-retired-ip-${suffix}`;
  const productId = `backup-retired-product-${suffix}`;
  const originalIpName = `복원 전 IP ${suffix}`;
  const originalProductName = `복원 전 상품 ${suffix}`;
  const originalImageUrl = `https://example.test/${suffix}/before.webp`;
  const currentIpName = `변경 후 IP ${suffix}`;
  const currentProductName = `변경 후 상품 ${suffix}`;
  const currentImageUrl = `https://example.test/${suffix}/after.webp`;
  await rows(database, 'INSERT INTO public.users(id,email,nickname) VALUES($1,$2,$3)', [
    userId, `backup-${suffix}@example.test`, `백업 ${suffix}`,
  ]);
  await rows(database, 'INSERT INTO public.catalog_ips(id,slug,name_ko,name_en,is_active) VALUES($1,$2,$3,$4,false)', [
    ipId, ipId, originalIpName, `Backup retired IP ${suffix}`,
  ]);
  await rows(database, `INSERT INTO public.catalog_products(
    id,sku,ip_id,category,name,price,image_url,is_active,metadata
  ) VALUES($1,$2,$3,'figure',$4,12000,$5,false,$6::jsonb)`, [
    productId, `BACKUP-RETIRED-${suffix}`.toUpperCase(), ipId, originalProductName,
    originalImageUrl, JSON.stringify({ developmentFixture: true, backupRestoreDrill: true }),
  ]);
  const inventoryUnitId = await scalar(database, `INSERT INTO public.inventory_units(
    owner_id,product_id,source_type,status
  ) VALUES($1,$2,'ADMIN_ADJUSTMENT','OWNED') RETURNING id`, [userId, productId]);
  const shippingRequestId = await scalar(database, `INSERT INTO public.shipping_requests(
    user_id,address_snapshot,reference_subtotal,free_shipping_threshold,
    qualifies_for_free_shipping,contains_kuji
  ) VALUES($1,'{}'::jsonb,12000,24900,false,false) RETURNING id`, [userId]);
  const snapshot = {
    productId,
    productName: originalProductName,
    ipId,
    ipNameKo: originalIpName,
    category: 'figure',
    imageUrl: originalImageUrl,
    productVersion: 1,
  };
  await rows(database, `INSERT INTO public.shipping_request_items(
    shipping_request_id,inventory_unit_id,product_snapshot
  ) VALUES($1,$2,$3::jsonb)`, [shippingRequestId, inventoryUnitId, JSON.stringify(snapshot)]);
  await rows(database, 'UPDATE public.catalog_ips SET name_ko=$2 WHERE id=$1', [ipId, currentIpName]);
  await rows(database, `UPDATE public.catalog_products
    SET name=$2,image_url=$3,version=version+1 WHERE id=$1`, [productId, currentProductName, currentImageUrl]);
  return {
    ipId, productId, inventoryUnitId, shippingRequestId, snapshot,
    currentIpName, currentProductName, currentImageUrl,
  };
}

const hasSqlState = (expected) => (error) => error && typeof error === 'object' && error.code === expected;

async function verifyLatestMigrationResults(database, fixture) {
  const migrations = await rows(database, `SELECT version,checksum
    FROM public.schema_migrations WHERE version=ANY($1::text[]) ORDER BY version`, [latestMigrations]);
  assert.deepEqual(migrations, latestMigrations.map((version) => ({
    version, checksum: latestMigrationChecksums[version],
  })),
    '0038/0039 and 0049/0050 migration identities and checksums must survive restore');
  assert.deepEqual(await rows(database, `SELECT data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipping_request_items' AND column_name='product_snapshot'`),
  [{ data_type: 'jsonb', is_nullable: 'NO' }]);
  assert.equal(await scalar(database, `SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.shipping_request_items'::regclass
      AND conname='shipping_request_items_product_snapshot_object' AND contype='c' AND convalidated`), '1');
  assert.equal(await scalar(database, `SELECT count(*) FROM pg_trigger
    WHERE tgrelid='public.shipping_request_items'::regclass
      AND tgname='shipping_request_items_snapshot_guard' AND NOT tgisinternal AND tgenabled='O'`), '1');
  assert.deepEqual(await rows(database, `SELECT column_name,data_type,is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipping_requests'
      AND column_name=ANY($1::text[]) ORDER BY column_name`, [[
    'contains_kuji', 'free_shipping_threshold', 'qualifies_for_free_shipping',
    'reference_subtotal', 'shipping_fee',
  ]]), [
    { column_name: 'contains_kuji', data_type: 'boolean', is_nullable: 'YES' },
    { column_name: 'free_shipping_threshold', data_type: 'integer', is_nullable: 'YES' },
    { column_name: 'qualifies_for_free_shipping', data_type: 'boolean', is_nullable: 'YES' },
    { column_name: 'reference_subtotal', data_type: 'integer', is_nullable: 'YES' },
    { column_name: 'shipping_fee', data_type: 'integer', is_nullable: 'YES' },
  ]);
  assert.deepEqual(await rows(database, `SELECT conname,contype,convalidated
    FROM pg_constraint
    WHERE conrelid=ANY($1::regclass[]) AND conname=ANY($2::text[]) ORDER BY conname`, [[
    'public.inventory_units', 'public.shipping_requests',
  ], [
    'inventory_units_storage_minimum_60_days',
    'shipping_requests_free_shipping_policy_snapshot',
    'shipping_requests_shipping_fee_policy_snapshot',
  ]]), [
    { conname: 'inventory_units_storage_minimum_60_days', contype: 'c', convalidated: true },
    { conname: 'shipping_requests_free_shipping_policy_snapshot', contype: 'c', convalidated: true },
    { conname: 'shipping_requests_shipping_fee_policy_snapshot', contype: 'c', convalidated: true },
  ]);
  assert.deepEqual(await rows(database, `SELECT tgname,tgenabled
    FROM pg_trigger
    WHERE tgrelid='public.shipping_requests'::regclass AND NOT tgisinternal
      AND tgname=ANY($1::text[]) ORDER BY tgname`, [[
    'shipping_requests_fill_shipping_fee', 'shipping_requests_guard_policy_snapshot',
  ]]), [
    { tgname: 'shipping_requests_fill_shipping_fee', tgenabled: 'O' },
    { tgname: 'shipping_requests_guard_policy_snapshot', tgenabled: 'O' },
  ]);
  assert.match(await scalar(database, `SELECT pg_get_expr(d.adbin,d.adrelid,false)
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    WHERE d.adrelid='public.inventory_units'::regclass AND a.attname='storage_expires_at'`), /60 days/);
  assert.deepEqual(await rows(database, `SELECT
      storage_expires_at >= acquired_at + interval '60 days' AS storage_minimum_60_days
    FROM public.inventory_units WHERE id=$1`, [fixture.inventoryUnitId]), [
    { storage_minimum_60_days: true },
  ]);
  assert.deepEqual(await rows(database, `SELECT reference_subtotal,free_shipping_threshold,
      qualifies_for_free_shipping,contains_kuji,shipping_fee
    FROM public.shipping_requests WHERE id=$1`, [fixture.shippingRequestId]), [{
    reference_subtotal: 12000,
    free_shipping_threshold: 24900,
    qualifies_for_free_shipping: false,
    contains_kuji: false,
    shipping_fee: 3000,
  }]);

  const restored = await rows(database, `SELECT item.product_snapshot,product.name AS current_product_name,
    product.image_url AS current_image_url,product.version AS current_product_version,
    product.is_active AS product_active,product.metadata,ip.name_ko AS current_ip_name,
    ip.is_active AS ip_active,inventory.owner_id=request.user_id AS history_owner_matches
    FROM public.shipping_request_items item
    JOIN public.inventory_units inventory ON inventory.id=item.inventory_unit_id
    JOIN public.shipping_requests request ON request.id=item.shipping_request_id
    JOIN public.catalog_products product ON product.id=inventory.product_id
    JOIN public.catalog_ips ip ON ip.id=product.ip_id
    WHERE item.shipping_request_id=$1 AND item.inventory_unit_id=$2`, [
    fixture.shippingRequestId, fixture.inventoryUnitId,
  ]);
  assert.equal(restored.length, 1, '0038 shipping history and 0039 retired catalog row must both survive restore');
  assert.deepEqual(restored[0].product_snapshot, fixture.snapshot);
  assert.equal(restored[0].current_product_name, fixture.currentProductName);
  assert.equal(restored[0].current_image_url, fixture.currentImageUrl);
  assert.equal(restored[0].current_product_version, 2);
  assert.equal(restored[0].current_ip_name, fixture.currentIpName);
  assert.equal(restored[0].product_active, false);
  assert.equal(restored[0].ip_active, false);
  assert.equal(restored[0].metadata.developmentFixture, true);
  assert.equal(restored[0].history_owner_matches, true);
  assert.equal(await scalar(database, `SELECT count(*) FROM public.catalog_products
    WHERE is_active AND (id=ANY($1::text[]) OR metadata ? 'developmentFixture')`, [retiredPrototypeProductIds]), '0');
  assert.equal(await scalar(database, `SELECT count(*) FROM public.catalog_ips ip
    WHERE ip.id=ANY($1::text[]) AND ip.is_active AND NOT EXISTS (
      SELECT 1 FROM public.catalog_products product WHERE product.ip_id=ip.id AND product.is_active
    )`, [retiredPrototypeIpIds]), '0');

  const missingPrototypeIpId = await scalar(database, `SELECT candidate FROM unnest($1::text[]) candidate
    WHERE NOT EXISTS (SELECT 1 FROM public.catalog_ips ip WHERE ip.id=candidate) LIMIT 1`, [retiredPrototypeIpIds]);
  assert.ok(missingPrototypeIpId, 'restore drill needs one unused prototype IP fixture identity');
  const client = await pool(database).connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(client.query(`UPDATE public.shipping_request_items
      SET product_snapshot=jsonb_set(product_snapshot,'{productName}','"tampered"')
      WHERE shipping_request_id=$1 AND inventory_unit_id=$2`, [
      fixture.shippingRequestId, fixture.inventoryUnitId,
    ]), hasSqlState('55000'));
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await assert.rejects(client.query(`UPDATE public.shipping_requests
      SET shipping_fee=0 WHERE id=$1`, [fixture.shippingRequestId]), hasSqlState('55000'));
    await client.query('ROLLBACK');

    // Reapply the idempotent retirement migration inside a rollback-only
    // transaction to prove its data result against the restored schema.
    const suffix = randomBytes(6).toString('hex');
    const activeIpId = `backup-retirement-execution-ip-${suffix}`;
    const activeProductId = `backup-retirement-execution-product-${suffix}`;
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.catalog_ips(id,slug,name_ko,name_en,is_active)
      VALUES($1,$2,$3,$4,true)`, [
      activeIpId, activeIpId, `퇴역 재실행 IP ${suffix}`, `Retirement execution IP ${suffix}`,
    ]);
    await client.query(`INSERT INTO public.catalog_products(
      id,sku,ip_id,category,name,price,image_url,is_active,metadata
    ) VALUES($1,$2,$3,'figure',$4,12000,$5,true,'{"developmentFixture":true}'::jsonb)`, [
      activeProductId, `BACKUP-RETIREMENT-EXECUTION-${suffix}`.toUpperCase(), activeIpId,
      `퇴역 재실행 상품 ${suffix}`, `https://example.test/${suffix}/retirement.webp`,
    ]);
    await client.query(`INSERT INTO public.catalog_ips(id,slug,name_ko,name_en,is_active)
      VALUES($1,$2,$3,$4,true)`, [
      missingPrototypeIpId, `backup-prototype-ip-${suffix}`, `프로토타입 IP ${suffix}`, `Prototype IP ${suffix}`,
    ]);
    await client.query(latestMigrationSources['0039_retire_prototype_catalog.sql']);
    assert.deepEqual((await client.query(`SELECT id,is_active FROM public.catalog_products
      WHERE id=$1`, [activeProductId])).rows, [{ id: activeProductId, is_active: false }]);
    assert.deepEqual((await client.query(`SELECT id,is_active FROM public.catalog_ips
      WHERE id=$1`, [missingPrototypeIpId])).rows, [{ id: missingPrototypeIpId, is_active: false }]);
  } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
}

const started = Date.now();
try {
  assert.equal(await scalar(source, 'SELECT count(*) FROM public.schema_migrations'), '51');
  const latestMigrationFixture = await createLatestMigrationFixture(source);
  // Fixtures mutate ONLY the explicitly named disposable clone.
  await rows(source, "SELECT pgmq.create('dabboba_worker')");
  await rows(source, 'ALTER TABLE pgmq.q_dabboba_worker ENABLE ROW LEVEL SECURITY; ALTER TABLE pgmq.a_dabboba_worker ENABLE ROW LEVEL SECURITY');
  await rows(source, "SELECT pgmq.create('dabboba_backup_unused')");
  await rows(source, 'CREATE TABLE IF NOT EXISTS public.backup_snapshot_probe (id integer PRIMARY KEY, label text NOT NULL)');
  await rows(source, "INSERT INTO public.backup_snapshot_probe VALUES (1,'before snapshot') ON CONFLICT DO NOTHING");
  const payload = { fixture: "'); DROP DATABASE unrelated; --\n\\! touch /tmp/never", label: 'backup-live-fixture' };
  const fixtureId = await scalar(source, "SELECT pgmq.send('dabboba_worker',$1::jsonb,0) AS id", [JSON.stringify(payload)]);
  const archiveFixtureId = await scalar(source, "SELECT pgmq.send('dabboba_worker','{\"fixture\":\"archived-backup-row\"}'::jsonb,0)");
  await rows(source, "SELECT pgmq.archive('dabboba_worker',$1::bigint)", [archiveFixtureId]);
  await rows(source, "UPDATE pgmq.q_dabboba_worker SET read_ct=7,vt='2030-01-01T00:00:00.123456Z',headers=$2::jsonb WHERE msg_id=$1", [fixtureId, '{"large":9223372036854775002}']);
  assert.ok(Number(await scalar(source, 'SELECT count(*) FROM pgmq.q_dabboba_worker')) > 0);
  assert.ok(Number(await scalar(source, 'SELECT count(*) FROM pgmq.a_dabboba_worker')) > 0, 'clone needs an archived-message fixture');
  const before = await fingerprint(source);
  const sequencesBefore = await sequenceState(source);
  await rows('postgres', `CREATE DATABASE ${ident(target)}`);
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-encrypted-restore-drill-'));
  await chmod(directory, 0o700);
  const key = join(directory, 'disposable-test-key');
  const archive = join(directory, 'fixture.dbbenc');
  await writeFile(key, randomBytes(32), { mode: 0o600 });
  const env = {
    DABBOBA_DB_TOOL_CONTAINER: container,
    DABBOBA_BACKUP_SOURCE_URL: `postgresql://postgres:${password}@127.0.0.1:5432/${source}`,
    DABBOBA_RESTORE_DRILL_URL: `postgresql://postgres:${password}@127.0.0.1:5432/${target}`,
    DABBOBA_APPROVE_LOCAL_RESTORE: 'YES',
  };
  assert.equal((await backupMain(['backup', archive, key], env)).queueSnapshotIncluded, true);
  assert.equal((await backupMain(['verify', archive, key], {})).status, 'archive-authenticated');
  const metadataTarget = `${target}_metadata`;
  await rows('postgres', `CREATE DATABASE ${ident(metadataTarget)}`);
  await rows(metadataTarget, "CREATE FUNCTION public.existing_operator_function() RETURNS integer LANGUAGE sql AS 'SELECT 7'");
  const restoreEnv = (database) => ({ ...env, DABBOBA_RESTORE_DRILL_URL: env.DABBOBA_RESTORE_DRILL_URL.replace(target, database) });
  await assert.rejects(backupMain(['restore', archive, key], restoreEnv(metadataTarget)), /not empty/);
  assert.equal(await scalar(metadataTarget, 'SELECT public.existing_operator_function()'), 7);
  assert.equal((await backupMain(['restore', archive, key], env)).queueSnapshotRestored, true);
  assert.deepEqual(await fingerprint(target), before, 'all application/PGMQ row hashes must match');
  assert.deepEqual(await sequenceState(target), sequencesBefore, 'sequence counters/is_called/ownership must match');
  assert.deepEqual(await fingerprint(source), before, 'quiescent backup must preserve source rows');
  assert.deepEqual(await sequenceState(source), sequencesBefore, 'backup must not advance source sequences');
  await assert.rejects(backupMain(['restore', archive, key], env), /not empty/);
  const constraints = await compareConstraints(source, target);
  for (const query of [
    "SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgmq') AND c.relkind IN ('r','p') ORDER BY 1,2",
    "SELECT * FROM pg_policies WHERE schemaname IN ('public','pgmq') ORDER BY schemaname,tablename,policyname",
    "SELECT extname,extversion FROM pg_extension ORDER BY extname",
    "SELECT ns.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,false),pg_get_functiondef(t.tgfoid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname IN ('public','pgmq') ORDER BY 1,2,3",
    "SELECT ns.nspname,t.relname,i.relname AS index_name,x.indisunique,x.indisvalid,x.indisready,x.indimmediate,x.indnullsnotdistinct,pg_get_indexdef(i.oid) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname IN ('public','pgmq') ORDER BY 1,2,3",
  ]) assert.deepEqual(await rows(target, query), await rows(source, query));
  await verifyLatestMigrationResults(target, latestMigrationFixture);

  // A late supplement failure rolls back ordinary tables and extension DDL too.
  const rollbackTarget = `${target}_rollback`;
  await rows('postgres', `CREATE DATABASE ${ident(rollbackTarget)}`);
  const privateKey = await readFile(key);
  const decrypted = openArchive(await readFile(archive), privateKey);
  const unpacked = unpackBackupBundle(decrypted);
  const invalidManifest = structuredClone(unpacked.manifest);
  invalidManifest.extensions.find((extension) => extension.name === 'pgmq').version = '0.0.0';
  const invalidArchive = join(directory, 'late-error.dbbenc');
  await writeFile(invalidArchive, sealArchive(packBackupBundle(unpacked.dump, invalidManifest), privateKey), { mode: 0o600 });
  privateKey.fill(0);
  decrypted.fill(0);
  await assert.rejects(backupMain(['restore', invalidArchive, key], restoreEnv(rollbackTarget)), /psql failed/);
  assert.equal(await scalar(rollbackTarget, "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace"), '0');
  assert.equal(await scalar(rollbackTarget, "SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql'"), '0');

  // Commit a normal row and queue publish while pg_dump is held at a known lock
  // barrier. Both readers must continue using the earlier exported snapshot.
  const writer = await pool(source).connect();
  const concurrentArchive = join(directory, 'concurrent.dbbenc');
  const concurrentTarget = `${target}_snapshot`;
  const concurrentProbeId = Number(await scalar(source, 'SELECT COALESCE(max(id),0)+1 FROM public.backup_snapshot_probe'));
  const concurrentMarker = `after-snapshot-publish-${target}`;
  await rows('postgres', `CREATE DATABASE ${ident(concurrentTarget)}`);
  let concurrentBackup;
  try {
    await writer.query('BEGIN');
    await writer.query('LOCK TABLE public.backup_snapshot_probe IN ACCESS EXCLUSIVE MODE');
    await writer.query("INSERT INTO public.backup_snapshot_probe VALUES ($1,'after snapshot')", [concurrentProbeId]);
    await writer.query("SELECT pgmq.send('dabboba_worker',$1::jsonb,0)", [JSON.stringify({ fixture: concurrentMarker })]);
    concurrentBackup = backupMain(['backup', concurrentArchive, key], env);
    concurrentBackup.catch(() => {});
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = await scalar(source, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='dabboba-backup' AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE%')");
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, 'pg_dump must reach the snapshot/lock barrier');
    await writer.query('COMMIT');
    await concurrentBackup;
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    if (concurrentBackup) await concurrentBackup.catch(() => {});
  }
  await backupMain(['restore', concurrentArchive, key], restoreEnv(concurrentTarget));
  assert.equal(await scalar(concurrentTarget, 'SELECT count(*) FROM public.backup_snapshot_probe WHERE id=$1', [concurrentProbeId]), '0');
  assert.equal(await scalar(concurrentTarget, "SELECT count(*) FROM pgmq.q_dabboba_worker WHERE message->>'fixture'=$1", [concurrentMarker]), '0');
  assert.equal(await scalar(source, 'SELECT count(*) FROM public.backup_snapshot_probe WHERE id=$1', [concurrentProbeId]), '1');
  assert.equal(await scalar(source, "SELECT count(*) FROM pgmq.q_dabboba_worker WHERE message->>'fixture'=$1", [concurrentMarker]), '1');
  process.stdout.write(`${JSON.stringify({
    status: 'local-restore-drill-passed', tablesCompared: Object.keys(before).length, migrations: 51, ...constraints,
    queueRowsAndArchiveAndSequenceRestored: true, payloadSqlInjectionPrevented: true,
    sharedSnapshotConcurrentCommitExcluded: true, lateRestoreErrorRolledBack: true,
    constraintTriggerPolicyIndexSequenceChecksPassed: true, metadataOnlyTargetRejected: true,
    sourceUnchangedDuringQuiescentBackup: true, nonemptyTargetRejected: true,
    shippingSnapshotMigrationRestored: true, prototypeCatalogRetirementRestoredAndReapplied: true,
    shippingAndStoragePolicyRestored: true, shippingFeePolicyRestored: true,
    elapsedMs: Date.now() - started, sourceDatabase: source, targetDatabase: target, fixtureArtifacts: directory,
    automaticBackups: false, productionDataUsed: false, roleGrantsRestored: false,
  })}\n`);
} finally { await Promise.all([...pools.values()].map((entry) => entry.end())); }
