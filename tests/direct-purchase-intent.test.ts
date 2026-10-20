import assert from "node:assert/strict";
import test from "node:test";
import { assertDirectPurchaseOrder, parseDirectPurchaseIntent } from "../apps/mobile/src/features/checkout/direct-purchase-intent.ts";

const intent = {
  actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  key: "direct-order:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  payload: {productId: "selected-product", quantity: 2, pointAmount: 100, unitPrice: 5000},
  createdAt: 1, orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const order = {
  id: intent.orderId, userId: intent.actorId, status: "PAID", subtotal: 10000, discountTotal: 0, pointTotal: 100, total: 9900,
  lines: [{productId: "selected-product", quantity: 2, unitPrice: 5000, lineTotal: 10000}], drawEntitlementIds: [] as string[],
};
test("direct purchase recovery preserves the chosen SKU, quantity, price and account across reload", () => {
  const restored = parseDirectPurchaseIntent(JSON.stringify(intent));
  assert.deepEqual(restored, intent);
  assert.doesNotThrow(() => assertDirectPurchaseOrder(restored, order));
});
test("a changed product, quantity, price, account or paid draw cannot be accepted as the chosen purchase", () => {
  for (const changed of [
    {...order, userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    {...order, lines: [{...order.lines[0]!, productId: "random-other-product"}]},
    {...order, lines: [{...order.lines[0]!, quantity: 3}]},
    {...order, lines: [{...order.lines[0]!, unitPrice: 6000}]},
    {...order, drawEntitlementIds: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]},
  ]) assert.throws(() => assertDirectPurchaseOrder(intent, changed));
});
