import assert from 'node:assert/strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pure lookup: additional native purchases never become fixture targets. */
export function resolveMobileQaFixtureOrder({ actorId, productId, idempotencyKey, orders, records }) {
  assert.ok(typeof actorId === 'string' && UUID.test(actorId), 'Invalid fixture actor.');
  assert.ok(typeof productId === 'string' && productId.length > 0, 'Invalid fixture product.');
  assert.equal(idempotencyKey, `${productId}-order`, 'Invalid canonical fixture key.');
  assert.ok(Array.isArray(orders) && Array.isArray(records), 'Invalid fixture lookup results.');
  const ids = new Set();
  for (const order of orders) {
    assert.ok(order && typeof order.id === 'string' && UUID.test(order.id)
      && order.user_id === actorId && order.product_id === productId, 'Invalid fixture order scope.');
    assert.ok(!ids.has(order.id), 'Fixture order lookup is ambiguous.');
    ids.add(order.id);
  }
  if (records.length === 0) {
    assert.equal(orders.length, 0, 'Existing orders require the canonical fixture identity.');
    return null;
  }
  assert.equal(records.length, 1, 'Canonical fixture identity is ambiguous.');
  const canonical = records[0];
  assert.ok(canonical && canonical.actor_id === actorId && canonical.scope === 'CREATE_ORDER'
    && canonical.idempotency_key === idempotencyKey && canonical.state === 'COMPLETED'
    && canonical.resource_type === 'ORDER' && typeof canonical.resource_id === 'string'
    && UUID.test(canonical.resource_id), 'Invalid canonical fixture identity.');
  assert.ok(ids.has(canonical.resource_id), 'Canonical resource is not an owned fixture order.');
  return canonical.resource_id;
}
