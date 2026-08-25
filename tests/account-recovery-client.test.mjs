import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DabbobaApiClient,
  deriveAccountShippingInventoryState,
} from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../src/services/dabbobaApi.ts", import.meta.url), "utf8");

test("account recovery reads shipping history/detail and AVAILABLE draw entitlements with bearer pagination", async () => {
  const calls = [];
  const entitlement = {
    id: "entitlement-1",
    orderId: "order-1",
    orderLineId: "line-1",
    product: { id: "product-1", name: "가챠", category: "gacha", imageUrl: null },
    probabilityVersion: 7,
    status: "AVAILABLE",
    createdAt: "2026-08-25T00:00:00.000Z",
    consumedAt: null,
  };
  const shippingRequest = {
    id: "shipping-1",
    status: "SHIPPED",
    version: 3,
    inventoryUnitIds: ["inventory-1"],
    destination: {
      recipientMasked: "김*뽑",
      phoneMasked: "010-****-5678",
      postalCode: "04790",
      addressLine1: "서울특별시 성동구 ***",
      addressLine2: null,
    },
    requestedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T01:00:00.000Z",
    shippedAt: "2026-08-25T01:00:00.000Z",
    trackingCarrier: "CJ대한통운",
    trackingNumber: "1234567890",
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "user-token" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.includes("/v1/account/draw-entitlements")) {
        return Response.json({ items: [entitlement], nextCursor: null });
      }
      if (url.endsWith("/v1/account/shipping-requests/shipping-1")) return Response.json(shippingRequest);
      if (url.includes("/v1/account/shipping-requests")) {
        return Response.json({ items: [shippingRequest], nextCursor: null });
      }
      return new Response("not found", { status: 404 });
    },
  });

  assert.deepEqual(await client.listAccountDrawEntitlements(), [entitlement]);
  assert.deepEqual(await client.listAccountShippingRequests(), [shippingRequest]);
  assert.deepEqual(await client.getAccountShippingRequest("shipping-1"), shippingRequest);

  assert.equal(calls[0].url, "https://api.dabboba.test/v1/account/draw-entitlements?limit=100");
  assert.equal(calls[1].url, "https://api.dabboba.test/v1/account/shipping-requests?limit=100");
  assert.equal(calls[2].url, "https://api.dabboba.test/v1/account/shipping-requests/shipping-1");
  assert.ok(calls.every((call) => call.init.headers.get("authorization") === "Bearer user-token"));
  assert.ok(calls.every((call) => !String(call.url).includes("status=")));
});

test("active shipping wins over cancellation while cancelled-only inventory becomes requestable again", () => {
  const baseRequest = {
    id: "shipping-base",
    version: 1,
    destination: {
      recipientMasked: "김*뽑",
      phoneMasked: "010-****-5678",
      postalCode: "04790",
      addressLine1: "서울특별시 성동구",
      addressLine2: null,
    },
    requestedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    shippedAt: null,
    trackingCarrier: null,
    trackingNumber: null,
  };
  const state = deriveAccountShippingInventoryState([
    { ...baseRequest, id: "cancelled", status: "CANCELLED", inventoryUnitIds: ["cancelled-only", "active-wins"] },
    { ...baseRequest, id: "requested", status: "REQUESTED", inventoryUnitIds: ["active-wins"] },
    { ...baseRequest, id: "delivered", status: "DELIVERED", inventoryUnitIds: ["delivered"] },
  ]);

  assert.deepEqual([...state.cancelledOnlyIds], ["cancelled-only"]);
  assert.deepEqual([...state.unavailableIds].sort(), ["active-wins", "delivered"]);
});

test("authenticated snapshot includes recovery data and durable notification preferences", async () => {
  const urls = [];
  const preferences = {
    orderUpdates: true,
    exchangeUpdates: true,
    requestUpdates: false,
    restockUpdates: true,
    marketingSms: false,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: true,
    version: 4,
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "user-token" },
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/v1/account/notification-preferences")) return Response.json(preferences);
      if (String(url).includes("/v1/account/points")) {
        return Response.json({ balance: 0, version: 1, items: [], nextCursor: null });
      }
      if (String(url).endsWith("/v1/account/default-address")) {
        return Response.json({ error: { code: "NOT_FOUND", message: "missing" } }, { status: 404 });
      }
      return Response.json({ items: [], nextCursor: null });
    },
  });

  const snapshot = await client.loadSnapshot();
  assert.deepEqual(snapshot.accountDrawEntitlements, []);
  assert.deepEqual(snapshot.accountShippingRequests, []);
  assert.deepEqual(snapshot.notificationPreferences, preferences);
  assert.ok(urls.includes("https://api.dabboba.test/v1/account/draw-entitlements?limit=100"));
  assert.ok(urls.includes("https://api.dabboba.test/v1/account/shipping-requests?limit=100"));
  assert.ok(urls.includes("https://api.dabboba.test/v1/account/notification-preferences"));
});

test("notification preferences use GET plus versioned idempotent PUT without sending mandatory orderUpdates", async () => {
  const calls = [];
  const response = {
    orderUpdates: true,
    exchangeUpdates: false,
    requestUpdates: true,
    restockUpdates: false,
    marketingSms: true,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: false,
    version: 6,
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: "user-token" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(response);
    },
  });

  assert.deepEqual(await client.getNotificationPreferences(), response);
  assert.deepEqual(await client.updateNotificationPreferences({
    exchangeUpdates: false,
    requestUpdates: true,
    restockUpdates: false,
    marketingSms: true,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: false,
    expectedVersion: 5,
  }, "notification-preferences-stable-key"), response);

  assert.equal(calls[0].url, "https://api.dabboba.test/v1/account/notification-preferences");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers.get("idempotency-key"), "notification-preferences-stable-key");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    exchangeUpdates: false,
    requestUpdates: true,
    restockUpdates: false,
    marketingSms: true,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: false,
    expectedVersion: 5,
  });
});

test("customer recovery UI is server-authoritative and exposes retry-safe controls", () => {
  assert.match(serviceSource, /status: "REQUESTED" \| "PROCESSING" \| "SHIPPED" \| "DELIVERED" \| "CANCELLED"/);
  assert.match(prototypeSource, /item\.status === "SHIPPING" \|\| item\.status === "DELIVERED"/);
  assert.match(serviceSource, /request\.status === "CANCELLED"[\s\S]*?!unavailableIds\.has\(inventoryUnitId\)/);
  assert.match(prototypeSource, /cancelledOnlyIds\.has\(unit\.id\)[\s\S]*?unit\.shippingStatus === "requested"[\s\S]*?unit\.exchangeStatus === "matched"/);
  assert.match(prototypeSource, /apiRuntime\.client\.createAccountShippingRequest[\s\S]*?apiRuntime\.client\.listAccountShippingRequests\(\)/);
  assert.match(prototypeSource, /loadShippingRequestDetail\(shippingRequest\.id, controller\.signal\)/);
  assert.match(prototypeSource, /recipientMasked/);
  assert.match(prototypeSource, /phoneMasked/);
  assert.match(prototypeSource, /maskedShippingAddressLabel\(detail\.destination\)/);
  assert.match(prototypeSource, /trackingCarrier && detail\.trackingNumber/);
  assert.match(prototypeSource, /entitlementGroupsByOrder/);
  assert.match(prototypeSource, /entitlement\.orderId/);
  assert.match(prototypeSource, /entitlement\.product\.id/);
  assert.match(prototypeSource, /isRandomDrawCategory\(candidate\.categoryId\)/);
  assert.match(prototypeSource, /결제 확률표/);
  assert.match(prototypeSource, /prepareDraw\(entitlements\.length\)/);
  assert.match(prototypeSource, /entitlements\.map\(\(item\) => item\.id\)/);
  assert.match(prototypeSource, /현재 카탈로그에 없는 상품이라 이어 뽑기를 시작할 수 없습니다/);
  assert.doesNotMatch(prototypeSource, /const drawProduct = catalogProducts\.find[\s\S]{0,200}\?\? PRODUCTS/);
  assert.match(serviceSource, /listAccountDrawEntitlements\(signal\?: AbortSignal\)/);
});

test("both consent screens persist stable versioned preferences and resync on conflict", () => {
  assert.match(prototypeSource, /createSessionId\("notification-preferences"\)/);
  assert.match(prototypeSource, /createSessionId\("privacy-preferences"\)/);
  assert.match(prototypeSource, /expectedVersion: notificationPreferences\.version/);
  assert.match(prototypeSource, /error instanceof DabbobaApiError && error\.status === 409[\s\S]*?getNotificationPreferences\(\)/);
  assert.match(prototypeSource, /code: "NOTIFICATION_PREFERENCES_CONFLICT"/);
  assert.match(prototypeSource, /apiRuntime\.client\.authenticated \|\| !notificationPreferences/);
  assert.match(prototypeSource, /aria-checked="true" disabled/);
  assert.match(prototypeSource, /key === "orderUpdates"/);
  assert.match(prototypeSource, /notificationPreferencesToPrivacy\(nextPreferences\)/);
});
