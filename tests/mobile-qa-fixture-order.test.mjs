import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveMobileQaFixtureOrder } from '../scripts/mobile-qa-fixture-order.mjs';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nativeId = '11111111-1111-4111-8111-111111111111';
const productId = 'mobile-recovery-qa-20260906-gacha';
const idempotencyKey = `${productId}-order`;
const order = (id) => ({ id, user_id: actorId, product_id: productId });
const canonical = {
  actor_id: actorId, scope: 'CREATE_ORDER', idempotency_key: idempotencyKey,
  state: 'COMPLETED', resource_type: 'ORDER', resource_id: originalId,
};
const resolve = (orders, records) => resolveMobileQaFixtureOrder({ actorId, productId, idempotencyKey, orders, records });

test('QA restart resolves only the canonical fixture despite later native purchases', () => {
  const orders = [order(nativeId), order(originalId)];
  const records = [{ ...canonical }];
  const before = JSON.stringify({ orders, records });
  assert.equal(resolve(orders, records), originalId);
  assert.equal(resolve([...orders].reverse(), records), originalId);
  assert.equal(JSON.stringify({ orders, records }), before, 'lookup must not mutate either record set');
});

test('QA setup allows fixture creation only when both canonical record and orders are absent', () => {
  assert.equal(resolve([], []), null);
  assert.throws(() => resolve([order(originalId)], []), /canonical/i);
  assert.throws(() => resolve([order(originalId), order(nativeId)], []), /canonical/i);
  assert.throws(() => resolve([], [canonical]), /owned fixture order/i);
  assert.throws(() => resolve([order(nativeId)], [canonical]), /owned fixture order/i);
});

test('QA canonical identity rejects wrong actor, scope, key, state and resource', () => {
  for (const invalid of [
    { actor_id: nativeId }, { scope: 'CONSUME_DRAW' }, { idempotency_key: 'gacha-order-native' },
    { state: 'PROCESSING' }, { state: 'FAILED' }, { resource_type: 'MEDIA' },
    { resource_id: null }, { resource_id: '../another-order' },
  ]) assert.throws(() => resolve([order(originalId)], [{ ...canonical, ...invalid }]), /canonical/i);
  assert.throws(() => resolve([order(originalId)], [canonical, canonical]), /canonical/i);
});

test('QA lookup never adopts a foreign user/product order or malformed query results', () => {
  assert.throws(() => resolve([{ ...order(originalId), user_id: nativeId }], [canonical]), /order scope/i);
  assert.throws(() => resolve([{ ...order(originalId), product_id: 'another-product' }], [canonical]), /order scope/i);
  assert.throws(() => resolve([order('not-a-uuid')], [canonical]), /order scope/i);
  assert.throws(() => resolve([order(originalId), order(originalId)], [canonical]), /ambiguous/i);
  for (const bad of [null, {}, 'rows']) {
    assert.throws(() => resolve(bad, []));
    assert.throws(() => resolve([], bad));
  }
});

test('QA startup wires the canonical resource lookup and never uses an arbitrary first order', async () => {
  const source = await readFile(new URL('../scripts/serve-mobile-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /FROM idempotency_keys[\s\S]*?actor_id=\$1 AND scope='CREATE_ORDER' AND idempotency_key=\$2/);
  assert.match(source, /resolveMobileQaFixtureOrder\(/);
  assert.match(source, /orders: existing\.rows, records: canonical\.rows/);
  assert.doesNotMatch(source, /existing\.rowCount <= 1|existing\.rows\[0\]\.id/);
  assert.doesNotMatch(source, /DELETE FROM orders|TRUNCATE|DROP DATABASE/);
});
