import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachOrderToGachaCheckoutIntent,
  canAutomaticallyReplayGachaOrderCreation,
  canRetireGachaCheckoutIntentForOrderStatus,
  createGachaCheckoutOrderIntent,
  GACHA_CHECKOUT_IDEMPOTENCY_WINDOW_MS,
  matchesGachaCheckoutOrderIntent,
  paidGachaOrderEntitlementIdsForIntent,
  parseGachaCheckoutOrderIntent,
  resolveGachaCheckoutOrderIntent,
  serializeGachaCheckoutOrderIntent,
} from "../apps/mobile/src/features/checkout/gacha-checkout-intent.ts";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "10000000-0000-4000-8000-000000000002";
const ORDER_ID = "20000000-0000-4000-8000-000000000001";
const ENTITLEMENT_IDS = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
];
const CREATED_AT = "2026-09-05T00:00:00.000Z";
const PAYLOAD = {
  productId: "gacha-product-a",
  quantity: 2,
  expectedDrawVersion: 7,
  pointAmount: 1_000,
};

function createIntent() {
  return createGachaCheckoutOrderIntent(
    ACTOR_ID,
    PAYLOAD,
    "gacha-order-40000000-0000-4000-8000-000000000001",
    CREATED_AT,
  );
}

function createOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    userId: ACTOR_ID,
    status: "PAID",
    subtotal: 20_000,
    discountTotal: 0,
    pointTotal: 1_000,
    total: 19_000,
    lines: [{
      productId: PAYLOAD.productId,
      category: "gacha",
      unitPrice: 10_000,
      quantity: 2,
      lineTotal: 20_000,
    }],
    drawEntitlementIds: ENTITLEMENT_IDS,
    ...overrides,
  };
}

test("a durable gacha intent reuses one key for the same actor and exact payload", () => {
  let generated = 0;
  const created = resolveGachaCheckoutOrderIntent(null, {
    actorId: ACTOR_ID,
    payload: PAYLOAD,
    createIdempotencyKey: () => {
      generated += 1;
      return "gacha-order-40000000-0000-4000-8000-000000000001";
    },
    nowIso: CREATED_AT,
  });
  const reused = resolveGachaCheckoutOrderIntent(created.intent, {
    actorId: ACTOR_ID,
    payload: { ...PAYLOAD },
    createIdempotencyKey: () => {
      generated += 1;
      return "gacha-order-40000000-0000-4000-8000-000000000002";
    },
    nowIso: "2026-09-05T00:01:00.000Z",
  });

  assert.equal(created.kind, "created");
  assert.equal(reused.kind, "reused");
  assert.equal(reused.intent.idempotencyKey, created.intent.idempotencyKey);
  assert.equal(generated, 1);
  assert.deepEqual(
    parseGachaCheckoutOrderIntent(serializeGachaCheckoutOrderIntent(reused.intent)),
    reused.intent,
  );
});

test("payload changes do not replace an unresolved intent and cross-account reuse is rejected", () => {
  const existing = createIntent();
  let generated = false;
  const conflict = resolveGachaCheckoutOrderIntent(existing, {
    actorId: ACTOR_ID,
    payload: { ...PAYLOAD, quantity: 3 },
    createIdempotencyKey: () => {
      generated = true;
      return "gacha-order-40000000-0000-4000-8000-000000000002";
    },
    nowIso: "2026-09-05T00:01:00.000Z",
  });

  assert.equal(conflict.kind, "payload-conflict");
  assert.equal(conflict.intent, existing);
  assert.equal(generated, false);
  assert.throws(() => resolveGachaCheckoutOrderIntent(existing, {
    actorId: OTHER_ACTOR_ID,
    payload: PAYLOAD,
    createIdempotencyKey: () => "gacha-order-40000000-0000-4000-8000-000000000003",
    nowIso: "2026-09-05T00:01:00.000Z",
  }), /다른 계정이나 상품/);
});

test("automatic create replay is finite and never posts an order-bearing intent again", () => {
  const intent = createIntent();
  const createdAtMs = Date.parse(CREATED_AT);
  assert.equal(canAutomaticallyReplayGachaOrderCreation(intent, createdAtMs), true);
  assert.equal(
    canAutomaticallyReplayGachaOrderCreation(
      intent,
      createdAtMs + GACHA_CHECKOUT_IDEMPOTENCY_WINDOW_MS - 1,
    ),
    true,
  );
  assert.equal(
    canAutomaticallyReplayGachaOrderCreation(
      intent,
      createdAtMs + GACHA_CHECKOUT_IDEMPOTENCY_WINDOW_MS,
    ),
    false,
  );
  assert.equal(canAutomaticallyReplayGachaOrderCreation(intent, createdAtMs - 1), false);

  const attached = attachOrderToGachaCheckoutIntent(
    intent,
    { id: ORDER_ID, status: "PENDING_PAYMENT" },
    "2026-09-05T00:02:00.000Z",
  );
  assert.equal(canAutomaticallyReplayGachaOrderCreation(attached, createdAtMs + 1), false);
});

test("only an exact paid order with valid unique entitlements opens committed gacha", () => {
  const intent = createIntent();
  const order = createOrder();
  assert.equal(matchesGachaCheckoutOrderIntent(order, intent), true);
  assert.deepEqual(paidGachaOrderEntitlementIdsForIntent(order, intent), ENTITLEMENT_IDS);

  assert.equal(matchesGachaCheckoutOrderIntent(createOrder({ userId: OTHER_ACTOR_ID }), intent), false);
  assert.equal(matchesGachaCheckoutOrderIntent(createOrder({ pointTotal: 999 }), intent), false);
  assert.equal(matchesGachaCheckoutOrderIntent(createOrder({ total: 19_001 }), intent), false);
  assert.equal(matchesGachaCheckoutOrderIntent(createOrder({
    lines: [{ ...order.lines[0], quantity: 1 }],
  }), intent), false);
  assert.equal(paidGachaOrderEntitlementIdsForIntent(
    createOrder({ status: "PENDING_PAYMENT" }),
    intent,
  ), null);
  assert.equal(paidGachaOrderEntitlementIdsForIntent(
    createOrder({ drawEntitlementIds: [ENTITLEMENT_IDS[0], ENTITLEMENT_IDS[0]] }),
    intent,
  ), null);
  assert.equal(paidGachaOrderEntitlementIdsForIntent(
    createOrder({ drawEntitlementIds: [ENTITLEMENT_IDS[0], "not-a-uuid"] }),
    intent,
  ), null);
});

test("known order identity and terminal intent retirement stay fail closed", () => {
  const attached = attachOrderToGachaCheckoutIntent(
    createIntent(),
    { id: ORDER_ID, status: "PAID" },
    "2026-09-05T00:02:00.000Z",
  );
  assert.equal(matchesGachaCheckoutOrderIntent(createOrder(), attached), true);
  assert.equal(matchesGachaCheckoutOrderIntent(
    createOrder({ id: "20000000-0000-4000-8000-000000000002" }),
    attached,
  ), false);
  assert.equal(canRetireGachaCheckoutIntentForOrderStatus("CANCELLED"), true);
  assert.equal(canRetireGachaCheckoutIntentForOrderStatus("REFUNDED"), true);
  assert.equal(canRetireGachaCheckoutIntentForOrderStatus("PAID"), false);
  assert.equal(parseGachaCheckoutOrderIntent("{broken"), null);
});

test("native checkout persists and validates the intent before committed navigation", async () => {
  const [api, screen] = await Promise.all([
    readFile(new URL(
      "../apps/mobile/src/features/checkout/checkout-api.ts",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../apps/mobile/src/features/checkout/CheckoutScreen.tsx",
      import.meta.url,
    ), "utf8"),
  ]);

  assert.match(api, /GET\("\/v1\/account\/profile"\)/);
  assert.match(api, /withExclusiveTransactionAsync/);
  assert.match(api, /INSERT INTO app_preferences[\s\S]*?serializeGachaCheckoutOrderIntent/);
  assert.match(api, /GACHA_CHECKOUT_INTENT_PREFERENCE_PREFIX\}\.\$\{actorId\.toLowerCase\(\)\}\.\$\{encodeURIComponent\(productId\)\}/);
  assert.match(api, /matchesGachaCheckoutOrderIntent\(order, intent\)[\s\S]*?withExclusiveTransactionAsync/);
  assert.match(api, /error\.code === "PAYMENT_NOT_CONFIGURED"/);
  assert.doesNotMatch(api, /error\.status >= 400/);

  const gachaCreateStart = api.indexOf("export async function createGachaCheckoutOrder");
  const gachaCreateEnd = api.indexOf("export async function fetchCheckoutOrder", gachaCreateStart);
  const gachaCreate = api.slice(gachaCreateStart, gachaCreateEnd);
  assert.match(gachaCreate, /POST\("\/v1\/orders"/);
  assert.match(gachaCreate, /"Idempotency-Key": input\.idempotencyKey/);
  assert.match(gachaCreate, /expectedDrawVersion: input\.expectedDrawVersion/);
  assert.match(gachaCreate, /pointAmount: input\.pointAmount/);
  assert.doesNotMatch(gachaCreate, /kujiRoomEntryId/);

  assert.match(screen, /readPendingGachaCheckoutOrderIntent\(db,[\s\S]*?productId/);
  assert.match(screen, /fetchCheckoutOrder\([\s\S]*?nextPendingGachaIntent\.orderId/);
  assert.match(screen, /payloadChanged && !existingIntent\.orderId/);
  assert.match(screen, /claim\.kind === "payload-conflict" && !claim\.intent\.orderId/);
  assert.match(screen, /현재 선택으로 새 주문을 자동 생성하지 않아요/);
  assert.match(screen, /intentCreatedThisAttempt[\s\S]*?canRetireGachaIntentAfterCreateError/);
  assert.match(screen, /creatingOrder && !options\.intentCreatedThisAttempt[\s\S]*?fetchCheckoutOrder\(runtime\.apiBaseUrl, accessToken, order\.id\)[\s\S]*?recordPendingGachaCheckoutOrder\(db, recordedIntent, order\)/);
  assert.match(screen, /paidGachaOrderEntitlementIds\(order, recordedIntent\)/);
  assert.match(screen, /order\.status === "PENDING_PAYMENT"[\s\S]*?뽑기로 이동하지 않았어요/);
  assert.match(screen, /`\/draw\/reveal\/\$\{encodeURIComponent\(entitlementIds\[0\]!\)\}/);

  const paidStart = screen.indexOf("if (entitlementIds) {");
  const paidEnd = screen.indexOf("if (order.status === \"PENDING_PAYMENT\")", paidStart);
  const paidBranch = screen.slice(paidStart, paidEnd);
  assert.notEqual(paidStart, -1);
  assert.notEqual(paidEnd, -1);
  assert.doesNotMatch(paidBranch, /clearPendingGachaCheckoutOrderIntent/);
  assert.match(paidBranch, /openCommittedGachaReveal/);
  assert.doesNotMatch(screen, /text: "새 주문 준비"/);
});
