#!/usr/bin/env node
// Opt-in local clone fixture. Never loads .env, alters roles, drops a DB, or contacts a provider.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveMobileQaFixtureOrder } from './mobile-qa-fixture-order.mjs';

const container = 'dabboba-backend-integration-20260905';
const sourceDatabase = 'dabboba_integration';
const database = 'dabboba_restore_drill_mobile_20260906';
const apiPort = 8879;
const fixture = 'mobile-recovery-qa-20260906';
const cwd = fileURLToPath(new URL('../', import.meta.url));
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--container', container, '--approve-clone-fixtures'])) {
  process.stderr.write(`Usage: node scripts/serve-mobile-qa.mjs --container ${container} --approve-clone-fixtures\n`);
  process.exit(64);
}
// Programmatic API config is explicit; inherited production/provider flags are not accepted.
for (const name of Object.keys(process.env)) {
  if (!['PATH', 'HOME', 'TMPDIR'].includes(name)) delete process.env[name];
}
process.env.NODE_ENV = 'test';
const execute = promisify(execFile);
const { Pool } = createRequire(new URL('../packages/db/package.json', import.meta.url))('pg');
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' };
let admin;
let owner;
let runtime;
let app;
let phase = 'local guard';
async function close() {
  await app?.close();
  await runtime?.end();
  await owner?.end();
  await admin?.end();
}

try {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(apiPort, '127.0.0.1', () => probe.close(resolve));
  });
  const inspected = await execute('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], { timeout: 10_000 });
  const bindings = JSON.parse(inspected.stdout)['5432/tcp'];
  assert.ok(Array.isArray(bindings) && bindings.length === 1 && bindings[0].HostIp === '127.0.0.1');
  const port = Number(bindings[0].HostPort);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  phase = 'fresh shared/API build';
  await execute('corepack', ['pnpm', 'run', 'workspace:packages'], { cwd, env: cleanEnv, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  await execute('corepack', ['pnpm', '--filter', '@dabboba/api', 'build'], { cwd, env: cleanEnv, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  phase = 'clone identity';
  const ownerConfig = {
    host: '127.0.0.1', port, user: 'postgres', password: 'dabboba-disposable-local-only-20260905',
    ssl: false, max: 1, connectionTimeoutMillis: 5000, query_timeout: 15_000,
    options: '-c statement_timeout=15000 -c lock_timeout=5000 -c search_path=pg_catalog,public -c timezone=UTC',
  };
  admin = new Pool({ ...ownerConfig, database: 'postgres' });
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
  if (!exists.rowCount) {
    // Both identifiers are fixed constants. The source is copied, never modified.
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE "${sourceDatabase}"`);
  }
  await admin.end();
  admin = undefined;
  owner = new Pool({ ...ownerConfig, database });
  assert.equal((await owner.query('SELECT current_database() AS name')).rows[0].name, database);
  assert.equal(Number((await owner.query('SELECT count(*) FROM schema_migrations')).rows[0].count), 38);
  const runtimeUrl = `postgresql://dabboba_runtime:dabboba-runtime-disposable-only-20260905@127.0.0.1:${port}/${database}`;
  const { createDatabasePool } = await import('../packages/db/dist/index.js');
  const { buildApp } = await import('../apps/api/dist/app.js');
  runtime = createDatabasePool(runtimeUrl, 'dabboba-mobile-qa', { max: 3, queryTimeoutMs: 12_000, statementTimeoutMs: 10_000 });
  assert.equal((await runtime.query('SELECT current_user')).rows[0].current_user, 'dabboba_runtime');
  ({ app } = await buildApp({ pool: runtime, redis: null, config: {
    environment: 'test', surface: 'customer', host: '127.0.0.1', port: apiPort,
    databaseUrl: runtimeUrl, redisUrl: null, webOrigins: [], adminOrigins: [],
    sessionTokenPepper: randomBytes(32).toString('hex'), sessionTtlDays: 1,
    adminProxyIdentitySecret: null, supabaseUrl: null, supabaseJwtAudience: null,
    paymentProvider: 'UNCONFIGURED', paymentWebhookSecret: null,
    gcsBucket: null, gcsProjectId: null, logLevel: 'silent',
  } }));
  const request = async (method, url, payload, token, key) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}), headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    } });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`QA API ${method} ${url} failed (${response.statusCode}).`);
    }
    return response.json();
  };
  phase = 'canonical local dev login';
  const login = await request('POST', '/v1/auth/dev-session', { email: 'mobile-test@dabboba.local' });
  const token = login.token;
  const userId = login.actor.userId;
  assert.ok(typeof token === 'string' && typeof userId === 'string');
  const products = [
    { id: `${fixture}-gacha`, category: 'gacha', label: '복구 QA · 캡슐 가챠', prize: '복구 QA · 별 마스코트' },
    { id: `${fixture}-kuji`, category: 'kuji', label: '복구 QA · 봉인 쿠지', prize: '복구 QA · 별 피규어' },
  ];
  phase = 'bounded clone catalog/point fixtures';
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [fixture]);
    await client.query('INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1::text,$1::text,$2,$3) ON CONFLICT (id) DO NOTHING',
      [fixture, '모바일 복구 QA', 'Mobile recovery QA']);
    for (const product of products) {
      const found = await client.query('SELECT metadata FROM catalog_products WHERE id=$1', [product.id]);
      if (found.rowCount) {
        assert.equal(found.rows[0].metadata.developmentFixture, fixture);
        continue;
      }
      await client.query(`INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only,metadata)
        VALUES($1::text,$1::text,$2,$3,$4,1000,false,$5),($6::text,$6::text,$2,'figure',$7,0,true,$5)`,
      [product.id, fixture, product.category, product.label, { developmentFixture: fixture }, `${product.id}-prize`, product.prize]);
      await client.query('INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,6,0)', [product.id]);
      const versionId = (await client.query('INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id', [product.id])).rows[0].id;
      const poolId = (await client.query(`INSERT INTO draw_pool_entries(
        probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
        prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
        SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,6,6 FROM catalog_products p WHERE p.id=$2 RETURNING id`,
      [versionId, `${product.id}-prize`])).rows[0].id;
      if (product.category === 'kuji') {
        await client.query('INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,6)', [versionId]);
        await client.query("INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)", [versionId, poolId]);
        await client.query('INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id) SELECT $1,n,$2 FROM generate_series(1,6) n', [versionId, poolId]);
      }
      await client.query("UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1", [versionId, userId]);
    }
    await client.query('INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT (user_id) DO NOTHING', [userId]);
    const credited = await client.query(`INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
      VALUES($1,'EARN',8000,'DEVELOPMENT_FIXTURE',$2,'모바일 복구 QA 포인트')
      ON CONFLICT (user_id,entry_type,reference_type,reference_id) DO NOTHING RETURNING id`, [userId, fixture]);
    if (credited.rowCount) await client.query('UPDATE point_accounts SET balance=balance+8000,version=version+1 WHERE user_id=$1', [userId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  phase = 'runtime API paid recovery fixtures';
  const orderSummaries = [];
  for (const product of products) {
    const fixtureOrderKey = `${fixture}-${product.category}-order`;
    const existing = await owner.query(`SELECT DISTINCT o.id,o.user_id,i.product_id FROM orders o JOIN order_lines i ON i.order_id=o.id
      WHERE o.user_id=$1 AND i.product_id=$2 ORDER BY o.id`, [userId, product.id]);
    const canonical = await owner.query(`SELECT actor_id,scope,idempotency_key,state,resource_type,resource_id
      FROM idempotency_keys
      WHERE actor_id=$1 AND scope='CREATE_ORDER' AND idempotency_key=$2`, [userId, fixtureOrderKey]);
    const fixtureOrderId = resolveMobileQaFixtureOrder({
      actorId: userId, productId: product.id, idempotencyKey: fixtureOrderKey,
      orders: existing.rows, records: canonical.rows,
    });
    let order;
    if (fixtureOrderId) order = await request('GET', `/v1/orders/${fixtureOrderId}`, null, token);
    else {
      let kujiRoomEntryId;
      if (product.category === 'kuji') {
        const room = await request('POST', `/v1/kuji/rooms/${product.id}/entries`, null, token);
        assert.equal(room.viewer.state, 'CHECKOUT_PENDING');
        kujiRoomEntryId = room.viewer.entryId;
      }
      order = await request('POST', '/v1/orders', {
        items: [{ productId: product.id, quantity: 2, expectedDrawVersion: 1 }], pointAmount: 2000,
        ...(kujiRoomEntryId ? { kujiRoomEntryId } : {}),
      }, token, fixtureOrderKey);
    }
    if (fixtureOrderId) assert.equal(order.id, fixtureOrderId);
    assert.equal(order.userId, userId);
    assert.equal(order.lines.length, 1);
    assert.equal(order.lines[0].productId, product.id);
    assert.equal(order.lines[0].quantity, 2);
    assert.equal(order.status, 'PAID');
    assert.equal(order.drawEntitlementIds.length, 2);
    if (product.category === 'gacha') {
      // Deliberate fixture action, not screen-mount behavior: leave the second entitlement untouched.
      await request('POST', `/v1/draws/${order.drawEntitlementIds[0]}/consume`, null, token, `${fixture}-gacha-first-consume`);
    }
    const states = (await owner.query(`SELECT e.status,count(*)::integer AS count FROM draw_entitlements e
      JOIN order_lines line ON line.id=e.order_line_id
      WHERE line.order_id=$1 GROUP BY e.status ORDER BY e.status`, [order.id])).rows;
    const summary = { productId: product.id, name: product.label, orderId: order.id, states };
    if (product.category === 'kuji') {
      const selection = await request('GET', `/v1/orders/${order.id}/kuji-selection`, null, token);
      summary.remaining = selection.recovery.entitlementIds.length;
      summary.bound = selection.recovery.bindings.length;
      summary.roomState = selection.recovery.roomState;
      summary.boardSlots = selection.board?.totalSlots ?? null;
    }
    orderSummaries.push(summary);
  }
  await request('GET', '/v1/account/draw-entitlements?status=AVAILABLE&limit=50', null, token);
  await owner.end();
  owner = undefined;
  phase = 'loopback API listen';
  await app.listen({ host: '127.0.0.1', port: apiPort });
  assert.equal((await fetch(`http://127.0.0.1:${apiPort}/readyz`)).status, 200);
  // Reopening this server preserves tickets already opened during QA. Server health
  // is not proof that the original partial-gacha/unbound-kuji baseline still exists.
  const fixtureBaselineReady = orderSummaries.every((summary) => {
    const counts = Object.fromEntries(summary.states.map((state) => [state.status, state.count]));
    return summary.productId.endsWith('-gacha')
      ? counts.AVAILABLE === 1 && counts.CONSUMED === 1
      : counts.AVAILABLE === 2 && !counts.CONSUMED && summary.remaining === 2 && summary.bound === 0;
  });
  process.stdout.write(`${JSON.stringify({ status: 'mobile-qa-server-ready', fixtureBaselineReady,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    database, runtimeRole: 'dabboba_runtime', loginEmail: 'mobile-test@dabboba.local', fixtures: orderSummaries,
    externalPayment: false, productionData: false, simulatorVerified: false })}\n`);
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
} catch (error) {
  // Do not expose DB diagnostics, credentials, session tokens or provider state.
  process.stderr.write(`Mobile QA failed during ${phase}; local details were suppressed.\n`);
  if (/^[A-Z0-9]{5}$/.test(error?.code ?? '')) process.stderr.write(`PostgreSQL SQLSTATE: ${error.code}\n`);
  if (/^[a-z0-9_]{1,100}$/.test(error?.constraint ?? '')) process.stderr.write(`Constraint: ${error.constraint}\n`);
  await close();
  process.exitCode = 1;
}
