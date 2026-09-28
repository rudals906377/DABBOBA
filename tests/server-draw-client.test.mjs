import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

test("order refresh and draw consumption use the authenticated server contracts", async () => {
  const calls = [];
  const entitlementId = "11111111-1111-4111-8111-111111111111";
  const orderId = "22222222-2222-4222-8222-222222222222";
  const order = {
    id: orderId,
    userId: "33333333-3333-4333-8333-333333333333",
    paymentId: "44444444-4444-4444-8444-444444444444",
    status: "PAID",
    currency: "KRW",
    subtotal: 12000,
    discountTotal: 0,
    pointTotal: 0,
    total: 12000,
    lines: [{ productId: "draw-product", productName: "가챠", category: "gacha", unitPrice: 12000, quantity: 1, lineTotal: 12000 }],
    drawEntitlementIds: [entitlementId],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:01:00.000Z",
  };
  const committed = {
    id: "55555555-5555-4555-8555-555555555555",
    entitlementId,
    productId: "draw-product",
    prizeProductId: "prize-product",
    prizeSku: "PRIZE-PRODUCT",
    prizeName: "A상 피규어",
    prizeImageUrl: "https://cdn.example.test/prize.webp",
    prizeIpId: "draw-ip",
    prizeCategory: "figure",
    prizeInventoryUnitId: "66666666-6666-4666-8666-666666666666",
    probabilityVersion: 3,
    rarity: "A",
    committedAt: "2026-08-24T00:02:00.000Z",
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "opaque-user-token" },
    createId: () => "draw-request-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(url.endsWith("/consume") ? committed : order);
    },
  });

  assert.deepEqual(await client.getOrder(orderId), order);
  assert.deepEqual(await client.consumeDrawEntitlement(entitlementId, "draw-once-key"), committed);
  assert.equal(calls[0].url, `https://api.dabboba.test/v1/orders/${orderId}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.equal(calls[0].init.headers.get("idempotency-key"), null);
  assert.equal(calls[1].url, `https://api.dabboba.test/v1/draws/${entitlementId}/consume`);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers.get("idempotency-key"), "draw-once-key");
});

test("remote draw UI is server-owned while prototype random remains isolated to prototype mode", () => {
  assert.match(prototypeSource, /consumeDrawEntitlement/);
  assert.match(prototypeSource, /apiMode === "remote"/);
  assert.match(prototypeSource, /committedDrawResult/);
  assert.doesNotMatch(
    prototypeSource,
    /if \(apiMode === "remote"\)[\s\S]{0,900}rollPrizeGrade\(/,
    "the remote branch must never use the prototype random grade",
  );
  assert.match(prototypeSource, /getActiveDrawOdds/);
  assert.match(prototypeSource, /expectedDrawVersion: confirmedDrawOdds\.version/);
  assert.match(prototypeSource, /구성과 결제 조건이 확인되기 전에는 주문할 수 없습니다/);
});

test("draw odds disclosure explains the live finite-pool calculation without unsupported sales claims", () => {
  assert.equal(prototypeSource.match(/<DrawOddsDisclosure odds=\{drawOdds\}/g)?.length, 2);
  assert.match(prototypeSource, /<th scope="col">현재 확률<\/th>/);
  assert.match(prototypeSource, /각 상세상품의 남은 수량을 모든 상세상품의 남은 수량 합계로 나눠 계산/);
  assert.match(prototypeSource, /수량이 같을 때만 종류별 1\/n/);
  assert.match(prototypeSource, /같은 경품을 다시 받을 수 있습니다/);
  assert.match(prototypeSource, /probabilityNumerator\.toLocaleString/);
  assert.match(prototypeSource, /probabilityDenominator\.toLocaleString/);
  assert.match(prototypeSource, /dateTime=\{odds\.calculatedAt\}/);
  assert.doesNotMatch(prototypeSource, /정식 라이선스 정품/);
});

test("legacy product detail shows aggregate opening and prize names without detailed odds", () => {
  const detail = prototypeSource.split("function ProductDetail(")[1]?.split("function DetailFooter(")[0];
  assert.ok(detail);
  assert.match(detail, /상품 목록/);
  assert.match(detail, /openQuantityLabel/);
  assert.match(detail, /includedProducts\.map/);
  assert.match(detail, /loadCatalogIncludedProducts/);
  assert.match(detail, /50\/202/);
  assert.doesNotMatch(detail, /ServerDrawOddsTable|DrawOddsDisclosure|grade-table|probabilityPercent/);
});

test("included product list uses the public catalog contract without requesting odds", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: null },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ items: [{ id: "prize-1", name: "상세 상품", imageUrl: null }] });
    },
  });
  assert.deepEqual(await client.getCatalogIncludedProducts("draw-product"), {
    items: [{ id: "prize-1", name: "상세 상품", imageUrl: null }],
  });
  assert.equal(calls[0].url, "https://api.dabboba.test/v1/catalog/products/draw-product/included-products");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.get("authorization"), null);
});

test("public draw odds are fetched before checkout and the confirmed version is sent with the order", async () => {
  const calls = [];
  const odds = {
    id: "77777777-7777-4777-8777-777777777777",
    productId: "draw-product",
    version: 4,
    publishedAt: "2026-08-24T00:00:00.000Z",
    calculatedAt: "2026-08-24T00:01:00.000Z",
    calculation: "REMAINING_QUANTITY_RATIO",
    totalEffectiveWeight: 100,
    entries: [{
      id: "88888888-8888-4888-8888-888888888888",
      prizeProductId: "prize-product",
      prizeSku: "PRIZE-PRODUCT",
      prizeName: "A상 피규어",
      prizeImageUrl: null,
      prizeIpId: "draw-ip",
      prizeCategory: "figure",
      rarity: "A",
      weight: 1,
      initialQuantity: 100,
      remainingQuantity: 100,
      effectiveWeight: 100,
      probabilityNumerator: 100,
      probabilityDenominator: 100,
      probabilityPercent: 100,
    }],
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: null },
    createId: () => "draw-order-correlation-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/draw-odds")) return Response.json(odds);
      return Response.json({ id: "order-id" }, { status: 201 });
    },
  });

  assert.deepEqual(await client.getActiveDrawOdds("draw-product"), odds);
  client.setToken("opaque-user-token");
  await client.createOrder({
    items: [{ productId: "draw-product", quantity: 1, expectedDrawVersion: odds.version }],
  }, "draw-order-once");

  assert.equal(calls[0].url, "https://api.dabboba.test/v1/catalog/products/draw-product/draw-odds");
  assert.equal(calls[0].init.headers.has("authorization"), false);
  assert.equal(calls[1].init.headers.get("authorization"), "Bearer opaque-user-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    items: [{ productId: "draw-product", quantity: 1, expectedDrawVersion: 4 }],
  });
});
