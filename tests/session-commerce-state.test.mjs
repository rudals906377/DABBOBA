import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENT_USER_ID,
  createInitialSessionCommerceState,
  eligibleDrawExchangeProposalUnits,
  decideSessionExchangeApplication,
  eligibleSessionInventoryUnits,
  exchangeDecisionKey,
  recordSessionInventoryUnitOnce,
  recordSessionOrderOnce,
  requestSessionShipping,
  updateSessionOrderStatus,
} from "../src/data/sessionCommerceFixtures.ts";

test("initial commerce sessions are isolated and expose only stored gacha inventory for exchange or point return", () => {
  const first = createInitialSessionCommerceState();
  const second = createInitialSessionCommerceState();

  assert.notEqual(first, second);
  assert.notEqual(first.orders, second.orders);
  assert.notEqual(first.inventoryUnits, second.inventoryUnits);
  first.wishlistProductIds.pop();
  assert.equal(second.wishlistProductIds.length, 6);

  const eligible = eligibleSessionInventoryUnits(second, CURRENT_USER_ID);
  assert.equal(eligible.length, 2);
  for (const item of eligible) {
    assert.equal(item.ownerId, CURRENT_USER_ID);
    assert.equal(item.source, "gacha");
    assert.equal(item.shippingStatus, "stored");
    assert.equal(item.exchangeStatus, "available");
    assert.ok(item.itemName.trim());
    assert.ok(item.itemImage.startsWith("/assets/dabboba/products/"));
    assert.ok(item.ipId.trim());
    assert.ok(item.categoryId.trim());
    assert.ok(item.appReferenceValue > 0);
  }
});

test("exchange and point-return eligibility follows acquisition source instead of product category", () => {
  const initial = createInitialSessionCommerceState();
  const gachaTemplate = initial.inventoryUnits.find((item) => item.source === "gacha");
  assert.ok(gachaTemplate);

  const state = {
    ...initial,
    inventoryUnits: [
      { ...gachaTemplate, id: "gacha-won-figure", categoryId: "figure", source: "gacha" },
      { ...gachaTemplate, id: "kuji-with-gacha-category", categoryId: "gacha", source: "kuji" },
      { ...gachaTemplate, id: "purchased-with-gacha-category", categoryId: "gacha", source: "direct-purchase" },
      { ...gachaTemplate, id: "admin-with-gacha-category", categoryId: "gacha", source: "admin-adjustment" },
      { ...gachaTemplate, id: "other-users-gacha", ownerId: "another-user", source: "gacha" },
      { ...gachaTemplate, id: "shipping-gacha", shippingStatus: "requested", source: "gacha" },
      { ...gachaTemplate, id: "reserved-gacha", exchangeStatus: "listed", source: "gacha" },
    ],
  };

  const eligibleIds = eligibleSessionInventoryUnits(state).map((item) => item.id);
  const proposalIds = eligibleDrawExchangeProposalUnits(state).map((item) => item.id);

  assert.deepEqual(eligibleIds, ["gacha-won-figure"]);
  assert.deepEqual(proposalIds, eligibleIds);
});

test("orders, point usage, inventory, and draw completion are recorded exactly once", () => {
  const initial = createInitialSessionCommerceState();
  const order = {
    id: "DBB-order-focused-test",
    userId: CURRENT_USER_ID,
    productId: "one-piece-tcg",
    productTitle: "원피스 카드게임 OP-13 계승되는 의지",
    productImage: "/assets/dabboba/products/ip/one-piece.jpg",
    categoryId: "tcg",
    orderedAt: "2026.08.24",
    quantity: 1,
    paidTotal: 1_500,
    pointsUsed: 500,
    status: "배송 신청 전",
  };
  const inventoryUnit = {
    id: `${order.id}-unit-1`,
    ownerId: CURRENT_USER_ID,
    catalogItemId: "catalog-one-piece-tcg",
    productId: order.productId,
    ipId: "one-piece",
    categoryId: "tcg",
    itemName: order.productTitle,
    itemImage: order.productImage,
    appReferenceValue: 2_000,
    source: "direct-purchase",
    acquiredAt: order.orderedAt,
    shippingDeadline: "2026.09.23",
    shippingStatus: "stored",
    exchangeStatus: "available",
  };

  const afterOrder = recordSessionOrderOnce(initial, order);
  const afterDuplicateOrder = recordSessionOrderOnce(afterOrder, order);
  assert.equal(afterOrder.orders.filter((candidate) => candidate.id === order.id).length, 1);
  assert.equal(afterOrder.pointBalance, initial.pointBalance - order.pointsUsed);
  assert.equal(afterOrder.pointLedger.filter((entry) => entry.referenceId === order.id).length, 1);
  assert.equal(afterDuplicateOrder, afterOrder);

  const afterInventory = recordSessionInventoryUnitOnce(afterOrder, inventoryUnit);
  const afterDuplicateInventory = recordSessionInventoryUnitOnce(afterInventory, inventoryUnit);
  assert.equal(afterInventory.inventoryUnits.filter((candidate) => candidate.id === inventoryUnit.id).length, 1);
  assert.equal(afterDuplicateInventory, afterInventory);

  const completed = updateSessionOrderStatus(afterInventory, order.id, "뽑기 완료");
  assert.equal(completed.orders.find((candidate) => candidate.id === order.id)?.status, "뽑기 완료");
  assert.equal(updateSessionOrderStatus(completed, order.id, "뽑기 완료"), completed);
});

test("shipping requests persist once and immediately remove units from exchange eligibility", () => {
  const initial = createInitialSessionCommerceState();
  const inventoryUnitId = eligibleSessionInventoryUnits(initial)[0].id;
  const request = {
    id: "shipping-request-focused-test",
    userId: CURRENT_USER_ID,
    inventoryUnitIds: [inventoryUnitId],
    requestedAt: "2026.08.24",
    status: "requested",
  };

  const requested = requestSessionShipping(initial, request);
  const duplicate = requestSessionShipping(requested, request);
  assert.equal(requested.shippingRequests.length, 1);
  assert.equal(requested.inventoryUnits.find((unit) => unit.id === inventoryUnitId)?.shippingStatus, "requested");
  assert.ok(!eligibleSessionInventoryUnits(requested).some((unit) => unit.id === inventoryUnitId));
  assert.equal(duplicate, requested);
});

test("exchange decisions are denied to non-authors and persist for the owning author", () => {
  const initial = createInitialSessionCommerceState();
  const input = {
    actorId: CURRENT_USER_ID,
    postId: "post-focused-test",
    postAuthorId: "another-user",
    applicationId: "application-a",
    applicationIds: ["application-a", "application-b"],
    decision: "accepted",
  };

  const denied = decideSessionExchangeApplication(initial, input);
  assert.equal(denied, initial);

  const accepted = decideSessionExchangeApplication(initial, {
    ...input,
    postAuthorId: CURRENT_USER_ID,
  });
  assert.equal(accepted.exchangeApplicationDecisions[exchangeDecisionKey(input.postId, "application-a")], "accepted");
  assert.equal(accepted.exchangeApplicationDecisions[exchangeDecisionKey(input.postId, "application-b")], "rejected");

  const revisitedStatus = accepted.exchangeApplicationDecisions[exchangeDecisionKey(input.postId, "application-a")];
  assert.equal(revisitedStatus, "accepted");
});
