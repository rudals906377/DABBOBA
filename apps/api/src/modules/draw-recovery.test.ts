import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { AppError, registerErrorHandler, unauthorized } from "../lib/errors.js";
import type { ApiContext } from "../types.js";
import {
  paidKujiRecoveryResponse,
  paidKujiSelectionResponse,
  paidGachaCompletionResponse,
  registerDrawRecoveryRoutes,
  type PaidKujiRecoveryRow,
  type PaidKujiSelectionRow,
  type PaidGachaCompletionRow,
} from "./draw-recovery.js";

const userId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const firstId = "55555555-5555-4555-8555-555555555555";
const secondId = "66666666-6666-4666-8666-666666666666";

function completionRow(): PaidGachaCompletionRow {
  return {
    order_id: orderId, user_id: userId, order_status: "PAID", payment_status: "PAID",
    product_id: "paid-gacha", quantity: 2, probability_version_id: versionId,
    probability_version: 7, server_now: new Date("2026-09-06T00:00:05.000Z"),
    entitlements: [firstId, secondId].map((id, index) => ({
      id, userId, productId: "paid-gacha", probabilityVersionId: versionId,
      status: "CONSUMED", consumedAt: "2026-09-06T00:00:04.000Z",
      resultId: [roomId, orderId][index]!, resultUserId: userId,
      resultProductId: "paid-gacha", resultVersion: 7, committedAt: "2026-09-06T00:00:04.000Z",
    })),
  };
}

test("whole-order gacha completion returns only every original entitlement's immutable result identity", () => {
  const snapshot = completionRow();
  const before = structuredClone(snapshot);
  const result = paidGachaCompletionResponse(snapshot);
  assert.deepEqual(result, {
    orderId, userId, productId: "paid-gacha", probabilityVersion: 7,
    serverNow: "2026-09-06T00:00:05.000Z",
    results: [firstId, secondId].map((entitlementId, index) => ({
      entitlementId, resultId: [roomId, orderId][index], committedAt: "2026-09-06T00:00:04.000Z",
    })),
  });
  assert.doesNotMatch(JSON.stringify(result), /prize|pool|rarity|inventory|entropy|seed/i);
  assert.deepEqual(snapshot, before);
});

test("an applied partial refund of unused draws settles the order: refunded entitlements are named, never required to hold a result", () => {
  const snapshot = completionRow();
  snapshot.entitlements[1] = {
    ...snapshot.entitlements[1]!, status: "CANCELLED", consumedAt: null, resultId: null, resultUserId: null,
    resultProductId: null, resultVersion: null, committedAt: null, partialRefundApplied: true,
  };
  const result = paidGachaCompletionResponse(snapshot);
  assert.deepEqual(result, {
    orderId, userId, productId: "paid-gacha", probabilityVersion: 7,
    serverNow: "2026-09-06T00:00:05.000Z",
    results: [{ entitlementId: firstId, resultId: roomId, committedAt: "2026-09-06T00:00:04.000Z" }],
    refundedEntitlementIds: [secondId],
  });
  // A refunded entitlement that somehow still carries a result is not a clean proof.
  const contradictory = completionRow();
  contradictory.entitlements[1] = { ...contradictory.entitlements[1]!, status: "CANCELLED", partialRefundApplied: true };
  assert.throws(() => paidGachaCompletionResponse(contradictory), (error: unknown) => error instanceof AppError && error.statusCode === 409);
  // An order whose every draw was refunded is a full refund, not a completion.
  const allRefunded = completionRow();
  allRefunded.entitlements = allRefunded.entitlements.map((item) => ({
    ...item, status: "CANCELLED", consumedAt: null, resultId: null, resultUserId: null,
    resultProductId: null, resultVersion: null, committedAt: null, partialRefundApplied: true,
  }));
  assert.throws(() => paidGachaCompletionResponse(allRefunded), (error: unknown) => error instanceof AppError && error.statusCode === 409);
});

test("partial, unbacked, foreign, mismatched, cancelled and unpaid completion snapshots fail closed", () => {
  const changes: Array<(snapshot: PaidGachaCompletionRow) => void> = [
    (snapshot) => { snapshot.quantity = 3; },
    (snapshot) => { snapshot.entitlements = []; },
    (snapshot) => { snapshot.entitlements[1]!.id = firstId; },
    (snapshot) => { snapshot.entitlements[1]!.status = "AVAILABLE"; },
    (snapshot) => { snapshot.entitlements[1]!.status = "CANCELLED"; },
    (snapshot) => { snapshot.entitlements[1]!.consumedAt = null; },
    (snapshot) => { snapshot.entitlements[1]!.resultId = null; },
    (snapshot) => { snapshot.entitlements[1]!.resultId = snapshot.entitlements[0]!.resultId; },
    (snapshot) => { snapshot.entitlements[1]!.userId = roomId; },
    (snapshot) => { snapshot.entitlements[1]!.productId = "other-gacha"; },
    (snapshot) => { snapshot.entitlements[1]!.probabilityVersionId = roomId; },
    (snapshot) => { snapshot.entitlements[1]!.resultUserId = roomId; },
    (snapshot) => { snapshot.entitlements[1]!.resultProductId = "other-gacha"; },
    (snapshot) => { snapshot.entitlements[1]!.resultVersion = 8; },
    (snapshot) => { snapshot.entitlements[1]!.committedAt = null; },
  ];
  for (const status of ["PENDING_PAYMENT", "CANCELLED", "REFUND_REVIEW", "REFUNDED"]) {
    changes.push((snapshot) => { snapshot.order_status = status; });
    changes.push((snapshot) => { snapshot.payment_status = status; });
  }
  for (const change of changes) {
    const snapshot = completionRow();
    change(snapshot);
    assert.throws(() => paidGachaCompletionResponse(snapshot), (error: unknown) => (
      error instanceof AppError && error.statusCode === 409
    ));
  }
});

test("gacha completion is an authenticated owner-only no-store single SELECT, never a consume probe", async (t) => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const snapshot = completionRow();
  const app = Fastify();
  app.decorateRequest("actor", null);
  registerErrorHandler(app);
  const context = {
    auth: { async requireUser(request: { headers: Record<string, string>; actor: unknown }) {
      if (request.headers.authorization !== "Bearer test-session") throw unauthorized();
      request.actor = { userId };
    } },
    pool: { async query(sql: string, values: unknown[]) {
      queries.push({ sql, values });
      return values[0] === orderId ? { rows: [snapshot], rowCount: 1 } : { rows: [], rowCount: 0 };
    } },
  } as unknown as ApiContext;
  await registerDrawRecoveryRoutes(app, context);
  t.after(() => app.close());
  const url = `/v1/orders/${orderId}/draw-completion`;
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal(queries.length, 0);
  const response = await app.inject({ method: "GET", url, headers: { authorization: "Bearer test-session" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]!.values, [orderId, userId]);
  assert.match(queries[0]!.sql, /orders\.id=\$1 AND orders\.user_id=\$2/);
  assert.match(queries[0]!.sql, /LEFT JOIN draw_results draw ON draw\.entitlement_id=entitlement\.id/);
  assert.doesNotMatch(queries[0]!.sql, /\b(?:INSERT|UPDATE|DELETE)\b|is_active|status='ACTIVE'/i);
  snapshot.entitlements[1]!.resultId = null;
  assert.equal((await app.inject({ method: "GET", url, headers: { authorization: "Bearer test-session" } })).statusCode, 409);
  assert.equal((await app.inject({ method: "GET", url: `/v1/orders/${roomId}/draw-completion`, headers: { authorization: "Bearer test-session" } })).statusCode, 404);
});

function row(): PaidKujiRecoveryRow {
  return {
    order_id: orderId,
    user_id: userId,
    order_status: "PAID",
    payment_status: "PAID",
    product_id: "paid-kuji",
    quantity: 2,
    probability_version_id: versionId,
    probability_version: 7,
    room_entry_id: roomId,
    room_state: "EXPIRED",
    drawing_expires_at: new Date("2026-09-05T00:05:00.000Z"),
    total_slots: 50,
    server_now: new Date("2026-09-06T00:00:00.000Z"),
    entitlements: [firstId, secondId].map((id) => ({
      id, userId, productId: "paid-kuji", probabilityVersionId: versionId,
      status: "AVAILABLE", slotNumber: null, bindingState: null,
    })),
  };
}

function selectionRow(): PaidKujiSelectionRow {
  return {
    ...row(),
    total_slots: 4,
    product_name_snapshot: "구매 당시 쿠지 이름",
    unit_price: 900,
    current_image_url: null,
    current_ip_name: "현재 작품명",
    published_at: new Date("2026-09-01T00:00:00.000Z"),
    snapshot_version: 12,
    reserved_slot_count: 1,
    slots: [true, false, true, false].map((available, index) => ({ slotNumber: index + 1, available })),
    tiers: [
      { tierCode: "A", tierRank: 0, label: "A상", initialQuantity: 1, remainingQuantity: 1 },
      { tierCode: "B", tierRank: 1, label: "B상", initialQuantity: 3, remainingQuantity: 2 },
    ],
  };
}

test("owned selection discloses original order display values and consistent aggregate counts without hidden slot mappings", () => {
  const snapshot = selectionRow();
  const result = paidKujiSelectionResponse(snapshot);
  assert.deepEqual(result.product, {
    name: "구매 당시 쿠지 이름", category: "kuji", unitPrice: 900,
    currentImageUrl: null, currentIpName: "현재 작품명",
  });
  assert.equal(result.board?.probabilityVersion, 7);
  assert.equal(result.board?.calculatedAt, result.recovery.serverNow);
  assert.equal(result.board?.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0), 3);
  assert.equal(result.board?.slots.filter((slot) => slot.available).length, 2);
  for (const slot of result.board!.slots) assert.deepEqual(Object.keys(slot).sort(), ["available", "slotNumber"]);
  assert.doesNotMatch(JSON.stringify(result.board!.slots), /tier|pool|prize|assignment|seed/i);
  assert.throws(() => paidKujiSelectionResponse({ ...snapshot, reserved_slot_count: 0 }), /남은 수량/);
  assert.throws(() => paidKujiSelectionResponse({ ...snapshot, slots: snapshot.slots.slice(1) }), /남은 수량/);
});

test("an already bound or partially opened order never receives a fresh selectable board", () => {
  const snapshot = selectionRow();
  snapshot.entitlements = snapshot.entitlements.map((item, index) => ({
    ...item, status: index === 0 ? "CONSUMED" : "AVAILABLE",
    slotNumber: index + 1, bindingState: index === 0 ? "CONSUMED" : "RESERVED",
  }));
  const result = paidKujiSelectionResponse(snapshot);
  assert.equal(result.board, null);
  assert.deepEqual(result.recovery.bindings, [{ entitlementId: secondId, slotNumber: 2, state: "RESERVED" }]);
});

test("an unselected paid order recovers original entitlements and elapsed deadline without a new lease", () => {
  const snapshot = selectionRow();
  const before = structuredClone(snapshot);
  const result = paidKujiRecoveryResponse(snapshot);
  assert.deepEqual(result.entitlementIds, [firstId, secondId]);
  assert.deepEqual(result.bindings, []);
  assert.equal(result.roomEntryId, roomId);
  assert.equal(result.roomState, "EXPIRED");
  assert.equal(result.drawingExpiresAt, "2026-09-05T00:05:00.000Z");
  assert.equal(result.probabilityVersion, 7);
  assert.deepEqual(snapshot, before);
});

test("partially opened recovery keeps each remaining entitlement's exact original slot without prize disclosure", () => {
  const snapshot = row();
  snapshot.entitlements[0] = { ...snapshot.entitlements[0]!, status: "CONSUMED", slotNumber: 3, bindingState: "CONSUMED" };
  snapshot.entitlements[1] = { ...snapshot.entitlements[1]!, slotNumber: 27, bindingState: "RESERVED" };
  const result = paidKujiRecoveryResponse(snapshot);
  assert.deepEqual(result.entitlementIds, [secondId]);
  assert.deepEqual(result.bindings, [{ entitlementId: secondId, slotNumber: 27, state: "RESERVED" }]);
  assert.deepEqual(Object.keys(result).sort(), [
    "bindings", "drawingExpiresAt", "entitlementIds", "orderId", "probabilityVersion",
    "productId", "roomEntryId", "roomState", "serverNow", "totalSlots", "userId",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /prize|poolEntry|tier|seed|assignment/i);
});

test("completed paid orders return no available draw and cannot invent a new purchase", () => {
  const snapshot = row();
  snapshot.room_state = "COMPLETED";
  snapshot.entitlements = snapshot.entitlements.map((item, index) => ({
    ...item, status: "CONSUMED", slotNumber: index + 1, bindingState: "CONSUMED",
  }));
  const result = paidKujiRecoveryResponse(snapshot);
  assert.deepEqual(result.entitlementIds, []);
  assert.deepEqual(result.bindings, []);
  assert.equal(result.orderId, orderId);
});

test("recovery rejects unpaid, refunded, foreign, partial, and mismatched entitlement bindings", () => {
  const changes: Array<(snapshot: PaidKujiRecoveryRow) => void> = [
    (snapshot) => { snapshot.order_status = "PENDING_PAYMENT"; },
    (snapshot) => { snapshot.payment_status = "REFUND_REVIEW"; },
    (snapshot) => { snapshot.room_state = "CHECKOUT_PENDING"; },
    (snapshot) => { snapshot.drawing_expires_at = null; },
    (snapshot) => { snapshot.entitlements[0]!.userId = secondId; },
    (snapshot) => { snapshot.entitlements[0]!.productId = "different"; },
    (snapshot) => { snapshot.entitlements[0]!.probabilityVersionId = secondId; },
    (snapshot) => { snapshot.entitlements[0]!.status = "CANCELLED"; },
    (snapshot) => { snapshot.entitlements[0]!.id = secondId; },
    (snapshot) => { snapshot.entitlements.pop(); },
    (snapshot) => { snapshot.entitlements[0]!.bindingState = "RESERVED"; snapshot.entitlements[0]!.slotNumber = 1; },
    (snapshot) => { snapshot.entitlements = snapshot.entitlements.map((item) => ({ ...item, slotNumber: 1, bindingState: "RESERVED" })); },
    (snapshot) => { snapshot.entitlements[0]!.status = "CONSUMED"; },
    (snapshot) => { snapshot.room_state = "COMPLETED"; },
  ];
  for (const change of changes) {
    const snapshot = row();
    change(snapshot);
    assert.throws(() => paidKujiRecoveryResponse(snapshot), (error: unknown) => (
      error instanceof AppError && error.statusCode === 409
    ));
  }
});

test("the recovery GET requires authentication and uses one owned no-store read without catalog availability gates", async (t) => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const snapshot = selectionRow();
  const app = Fastify();
  app.decorateRequest("actor", null);
  registerErrorHandler(app);
  const context = {
    auth: {
      async requireUser(request: { headers: Record<string, string>; actor: unknown }) {
        if (request.headers.authorization !== "Bearer test-session") throw unauthorized();
        request.actor = { userId };
      },
    },
    pool: {
      async query(sql: string, values: unknown[]) {
        queries.push({ sql, values });
        return values[0] === orderId ? { rows: [snapshot], rowCount: 1 } : { rows: [], rowCount: 0 };
      },
    },
  } as unknown as ApiContext;
  await registerDrawRecoveryRoutes(app, context);
  t.after(() => app.close());
  const url = `/v1/orders/${orderId}/draw-recovery`;
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal(queries.length, 0);
  const response = await app.inject({ method: "GET", url, headers: { authorization: "Bearer test-session" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]!.values, [orderId, userId]);
  assert.match(queries[0]!.sql, /orders\.id=\$1 AND orders\.user_id=\$2/);
  assert.doesNotMatch(queries[0]!.sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(queries[0]!.sql, /is_active|on_hand|product_stock|FOR UPDATE/i);
  const absent = await app.inject({ method: "GET", url: `/v1/orders/${secondId}/draw-recovery`, headers: { authorization: "Bearer test-session" } });
  assert.equal(absent.statusCode, 404);
  const selectionUrl = `/v1/orders/${orderId}/kuji-selection`;
  assert.equal((await app.inject({ method: "GET", url: selectionUrl })).statusCode, 401);
  const selection = await app.inject({ method: "GET", url: selectionUrl, headers: { authorization: "Bearer test-session" } });
  assert.equal(selection.statusCode, 200, selection.body);
  assert.equal(selection.headers["cache-control"], "no-store");
  assert.equal(queries.length, 3);
  assert.doesNotMatch(queries[2]!.sql, /is_active|status='ACTIVE'|LIMIT 100|\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(queries[2]!.sql, /assignment\.probability_version_id=line\.probability_version_id/);
  assert.match(queries[2]!.sql, /line\.product_name_snapshot,line\.unit_price/);
});
