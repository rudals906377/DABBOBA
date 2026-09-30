#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

export const DEMO = Object.freeze({
  fixtureTag: "supabase-demo-v1",
  projectRef: "yxkmvgfruphgghowzvmo",
  baseUrl: "http://127.0.0.1:8788",
  gacha: Object.freeze({
    id: "gacha-demon-slayer-onemutan-13",
    sku: "DEMO-TEST-GACHA",
    name: "예시상품 A (가챠)",
    category: "gacha",
  }),
  kuji: Object.freeze({
    id: "kuji-sylvanian-adventure",
    sku: "DEMO-TEST-KUJI",
    name: "예시상품 B (쿠지)",
    category: "kuji",
  }),
  account: Object.freeze({
    id: "da000000-0000-4000-8000-00000000000a",
    email: "member01@dabboba.local",
  }),
  capabilities: Object.freeze({
    enabled: true,
    profile: "supabase-demo",
    paymentProvider: "TEST_PG",
    actions: Object.freeze(["approve", "fail", "cancel", "refund"]),
  }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_REQUESTS = 96;
const REQUEST_TIMEOUT_MS = 15_000;

const SAFE_ROUTES = Object.freeze([
  ["GET", /^\/v1\/demo\/capabilities$/],
  ["POST", /^\/v1\/demo\/session$/],
  ["GET", /^\/v1\/account\/policy-acceptances$/],
  ["POST", /^\/v1\/account\/policy-acceptances$/],
  ["GET", /^\/v1\/catalog\/products$/],
  ["GET", /^\/v1\/catalog\/home-sections$/],
  ["GET", /^\/v1\/catalog\/products\/(?:gacha-demon-slayer-onemutan-13|kuji-sylvanian-adventure)$/],
  ["GET", /^\/v1\/catalog\/products\/(?:gacha-demon-slayer-onemutan-13|kuji-sylvanian-adventure)\/draw-odds$/],
  ["GET", /^\/v1\/catalog\/products\/kuji-sylvanian-adventure\/kuji-slots$/],
  ["POST", /^\/v1\/orders$/],
  ["GET", /^\/v1\/orders\/[0-9a-f-]{36}$/i],
  ["GET", /^\/v1\/orders\/[0-9a-f-]{36}\/draw-completion$/i],
  ["POST", /^\/v1\/demo\/payments\/[0-9a-f-]{36}\/transition$/i],
  ["POST", /^\/v1\/draws\/[0-9a-f-]{36}\/consume$/i],
  ["GET", /^\/v1\/account\/inventory$/],
  ["GET", /^\/v1\/account\/draw-entitlements$/],
  ["GET", /^\/v1\/account\/points$/],
  ["POST", /^\/v1\/account\/point-returns$/],
  ["POST", /^\/v1\/kuji\/rooms\/kuji-sylvanian-adventure\/entries$/],
  ["POST", /^\/v1\/kuji\/rooms\/kuji-sylvanian-adventure\/entries\/[0-9a-f-]{36}\/slots$/i],
]);

export class DemoSmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DemoSmokeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DemoSmokeError(code, message);
}

function expect(condition, code, message) {
  if (!condition) fail(code, message);
}

function object(value, label) {
  expect(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_RESPONSE", `${label} was not an object.`);
  return value;
}

function string(value, label) {
  expect(typeof value === "string" && value.length > 0, "INVALID_RESPONSE", `${label} was not a non-empty string.`);
  return value;
}

function uuid(value, label) {
  const result = string(value, label);
  expect(UUID.test(result), "INVALID_RESPONSE", `${label} was not a UUID.`);
  return result;
}

function positiveInteger(value, label) {
  expect(Number.isSafeInteger(value) && value > 0, "INVALID_RESPONSE", `${label} was not a positive integer.`);
  return value;
}

function integer(value, label) {
  expect(Number.isSafeInteger(value), "INVALID_RESPONSE", `${label} was not an integer.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort();
  expect(isDeepStrictEqual(actual, [...keys].sort()), "INVALID_RESPONSE", `${label} fields did not match the exact demo contract.`);
}

export function parseCliArgs(argv) {
  let run = false;
  let baseUrl = DEMO.baseUrl;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run") {
      expect(!run, "USAGE", "--run may be supplied only once.");
      run = true;
    } else if (argument === "--base-url") {
      expect(index + 1 < argv.length, "USAGE", "--base-url requires a value.");
      baseUrl = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--base-url=")) {
      baseUrl = argument.slice("--base-url=".length);
    } else {
      fail("USAGE", "Unsupported argument. Use only --run and an optional --base-url.");
    }
  }
  expect(run, "RUN_FLAG_REQUIRED", "Refusing to exercise persistent demo commerce without explicit --run.");
  return { baseUrl: assertLoopbackApiBaseUrl(baseUrl) };
}

export function assertLoopbackApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("UNSAFE_BASE_URL", "The API base URL is invalid.");
  }
  expect(url.protocol === "http:", "UNSAFE_BASE_URL", "The demo verifier accepts only loopback HTTP.");
  expect(LOOPBACK_HOSTS.has(url.hostname), "UNSAFE_BASE_URL", "The demo verifier accepts only a loopback host.");
  expect(url.port === "8788", "UNSAFE_BASE_URL", "The demo verifier accepts only API port 8788.");
  expect(url.username === "" && url.password === "", "UNSAFE_BASE_URL", "Credentials are forbidden in the API URL.");
  expect(url.pathname === "/" && url.search === "" && url.hash === "", "UNSAFE_BASE_URL", "The API base URL must not include a path, query, or fragment.");
  return url.origin;
}

export function assertSafeRequestTarget(method, relativePath) {
  expect(["GET", "POST"].includes(method), "UNSAFE_REQUEST", "Only bounded GET and POST requests are allowed.");
  expect(typeof relativePath === "string" && relativePath.startsWith("/v1/") && !relativePath.startsWith("//"), "UNSAFE_REQUEST", "Only relative v1 API paths are allowed.");
  const parsed = new URL(relativePath, DEMO.baseUrl);
  expect(parsed.origin === DEMO.baseUrl, "UNSAFE_REQUEST", "Cross-origin API requests are forbidden.");
  expect(!parsed.pathname.includes("/admin/") && !parsed.pathname.includes("/webhooks/"), "UNSAFE_REQUEST", "Admin and webhook routes are forbidden.");
  const matched = SAFE_ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(parsed.pathname));
  expect(matched, "UNSAFE_REQUEST", `The route is outside the bounded demo exercise: ${method} ${parsed.pathname}`);
  return parsed.pathname;
}

export function assertDemoCapabilities(value) {
  exactKeys(value, ["enabled", "profile", "paymentProvider", "actions"], "Demo capabilities");
  expect(isDeepStrictEqual(value, DEMO.capabilities), "CAPABILITY_MISMATCH", "The exact supabase-demo TEST_PG capability profile is not enabled.");
  return value;
}

export function assertFixedDemoProduct(value, expectedProduct) {
  const product = object(value, "Catalog product");
  expect(product.id === expectedProduct.id, "FIXTURE_MISMATCH", "Catalog product ID did not match the fixed demo seed.");
  expect(product.sku === expectedProduct.sku, "FIXTURE_MISMATCH", "Catalog product SKU did not match the fixed demo seed.");
  expect(product.name === expectedProduct.name, "FIXTURE_MISMATCH", "Catalog product name did not match the fixed local example.");
  expect(product.ipId === "demo-test-ip", "FIXTURE_MISMATCH", "Catalog product IP did not match the fixed demo seed.");
  expect(product.category === expectedProduct.category, "FIXTURE_MISMATCH", "Catalog product category did not match the fixed demo seed.");
  expect(product.isActive === true && product.isPrizeOnly === false, "FIXTURE_MISMATCH", "Catalog product was not an active sellable demo product.");
  expect(product.metadata?.dabbobaFixture === DEMO.fixtureTag, "FIXTURE_MISMATCH", "Catalog product did not carry the exact demo fixture tag.");
  expect(product.metadata?.catalogGeneration === "product-photos-2026-09-10" && product.metadata?.internalTestOnly === true, "FIXTURE_MISMATCH", "Catalog product did not carry the isolated test generation.");
  expect(product.saleStatus === "ON_SALE" && Number.isSafeInteger(product.price) && product.price > 0, "FIXTURE_MISMATCH", "Catalog product was not safely priced for the local commerce exercise.");
  integer(product.availableQuantity, "Catalog availableQuantity");
  return product;
}

function assertSession(value) {
  exactKeys(value, ["token", "expiresAt", "actor"], "Internal customer session");
  string(value.token, "Internal customer session token");
  string(value.expiresAt, "Internal customer session expiresAt");
  const actor = object(value.actor, "Internal customer session actor");
  exactKeys(actor, ["userId", "email", "nickname", "role", "status", "sessionId"], "Internal customer session actor");
  uuid(actor.userId, "Internal customer session actor.userId");
  uuid(actor.sessionId, "Internal customer session actor.sessionId");
  expect(actor.userId === DEMO.account.id, "SESSION_MISMATCH", "Internal customer session user ID did not match.");
  expect(actor.email === DEMO.account.email, "SESSION_MISMATCH", "Internal customer session email did not match.");
  string(actor.nickname, "Internal customer session actor.nickname");
  expect(actor.role === "USER" && actor.status === "ACTIVE", "SESSION_MISMATCH", "Internal customer session was not an active user.");
  return value;
}

function assertOrder(value, expected) {
  const order = object(value, expected.label);
  uuid(order.id, `${expected.label}.id`);
  uuid(order.userId, `${expected.label}.userId`);
  uuid(order.paymentId, `${expected.label}.paymentId`);
  expect(order.userId === expected.userId, "ORDER_MISMATCH", `${expected.label} owner did not match.`);
  expect(order.status === expected.status, "ORDER_MISMATCH", `${expected.label} status did not match ${expected.status}.`);
  expect(order.currency === "KRW", "ORDER_MISMATCH", `${expected.label} currency did not match KRW.`);
  for (const field of ["subtotal", "discountTotal", "pointTotal", "total"]) integer(order[field], `${expected.label}.${field}`);
  expect(Array.isArray(order.lines) && order.lines.length === 1, "ORDER_MISMATCH", `${expected.label} did not contain one line.`);
  const line = object(order.lines[0], `${expected.label}.lines[0]`);
  expect(line.productId === expected.productId && line.category === expected.category, "ORDER_MISMATCH", `${expected.label} product did not match.`);
  expect(line.quantity === expected.quantity, "ORDER_MISMATCH", `${expected.label} quantity did not match.`);
  if (expected.entitlements !== undefined) {
    expect(Array.isArray(order.drawEntitlementIds) && order.drawEntitlementIds.length === expected.entitlements, "ORDER_MISMATCH", `${expected.label} entitlement count did not match.`);
    for (const [index, id] of order.drawEntitlementIds.entries()) uuid(id, `${expected.label}.drawEntitlementIds[${index}]`);
  }
  return order;
}

function assertDrawResult(value, expected) {
  const result = object(value, expected.label);
  uuid(result.id, `${expected.label}.id`);
  expect(result.entitlementId === expected.entitlementId, "DRAW_MISMATCH", `${expected.label} entitlement did not match.`);
  expect(result.productId === expected.productId, "DRAW_MISMATCH", `${expected.label} product did not match.`);
  expect(expected.prizeIds.includes(result.prizeProductId), "DRAW_MISMATCH", `${expected.label} prize was outside the published product pool.`);
  uuid(result.prizeInventoryUnitId, `${expected.label}.prizeInventoryUnitId`);
  if (expected.slotNumber !== undefined) {
    expect(result.kujiSlotNumber === expected.slotNumber, "DRAW_MISMATCH", `${expected.label} kuji slot did not match.`);
  }
  return result;
}

class ApiClient {
  constructor(baseUrl, fetchImpl) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.requestCount = 0;
  }

  async request(method, path, { token, key, body, expected = [200], label = path } = {}) {
    assertSafeRequestTarget(method, path);
    this.requestCount += 1;
    expect(this.requestCount <= MAX_REQUESTS, "REQUEST_LIMIT", "The bounded demo request limit was exceeded.");
    const headers = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (key) headers["idempotency-key"] = key;
    if (body !== undefined) headers["content-type"] = "application/json";
    let response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      fail("API_UNREACHABLE", `${label} could not reach the loopback API.`);
    }
    expect(expected.includes(response.status), "API_STATUS", `${label} returned HTTP ${response.status}.`);
    if (response.status === 204) return { data: null, status: response.status, headers: response.headers };
    let data;
    try {
      data = JSON.parse(await response.text());
    } catch {
      fail("INVALID_RESPONSE", `${label} did not return JSON.`);
    }
    return { data, status: response.status, headers: response.headers };
  }
}

function key(runId, name) {
  return `demo-smoke-${runId}-${name}`;
}

async function listAll(client, path, token) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const target = new URL(path, DEMO.baseUrl);
    target.searchParams.set("limit", "100");
    if (cursor) target.searchParams.set("cursor", cursor);
    const relativeTarget = `${target.pathname}${target.search}`;
    const result = await client.request("GET", relativeTarget, { token, label: `Page ${page + 1} of ${target.pathname}` });
    const body = object(result.data, `${path} page`);
    expect(Array.isArray(body.items), "INVALID_RESPONSE", `${path} page items were missing.`);
    items.push(...body.items);
    if (body.nextCursor === null || body.nextCursor === undefined) return items;
    cursor = string(body.nextCursor, `${path} nextCursor`);
  }
  fail("PAGE_LIMIT", `${path} exceeded the bounded pagination limit.`);
}

async function productSnapshot(client, expectedProduct) {
  const { data } = await client.request("GET", `/v1/catalog/products/${expectedProduct.id}`, { label: `${expectedProduct.id} catalog` });
  return assertFixedDemoProduct(data, expectedProduct);
}

async function createOrder(client, { session, product, version, quantity, runId, name, kujiRoomEntryId }) {
  const idempotencyKey = key(runId, `order-${name}`);
  const body = {
    items: [{ productId: product.id, quantity, expectedDrawVersion: version }],
    ...(kujiRoomEntryId ? { kujiRoomEntryId } : {}),
  };
  const first = await client.request("POST", "/v1/orders", {
    token: session.token,
    key: idempotencyKey,
    body,
    expected: [201],
    label: `${name} order create`,
  });
  const order = assertOrder(first.data, {
    label: `${name} pending order`,
    userId: session.actor.userId,
    productId: product.id,
    category: product.category,
    quantity,
    status: "PENDING_PAYMENT",
  });
  const replay = await client.request("POST", "/v1/orders", {
    token: session.token,
    key: idempotencyKey,
    body,
    expected: [201],
    label: `${name} order replay`,
  });
  expect(isDeepStrictEqual(replay.data, first.data), "IDEMPOTENCY_FAILURE", `${name} order replay changed the reserved order.`);
  return order;
}

async function transition(client, { session, order, product, quantity, action, runId, name, status, replay = false }) {
  const idempotencyKey = key(runId, `payment-${name}-${action}`);
  const request = () => client.request("POST", `/v1/demo/payments/${order.id}/transition`, {
    token: session.token,
    key: idempotencyKey,
    body: { action },
    expected: [200],
    label: `${name} payment ${action}`,
  });
  const first = await request();
  const transitioned = assertOrder(first.data, {
    label: `${name} ${status} order`,
    userId: session.actor.userId,
    productId: product.id,
    category: product.category,
    quantity,
    status,
    entitlements: action === "approve" ? quantity : undefined,
  });
  if (replay) {
    const second = await request();
    expect(isDeepStrictEqual(second.data, first.data), "IDEMPOTENCY_FAILURE", `${name} payment replay changed the response.`);
  }
  return transitioned;
}

async function consume(client, { session, entitlementId, productId, prizeIds, runId, name, slotNumber, replay = false }) {
  const idempotencyKey = key(runId, `draw-${name}`);
  const request = () => client.request("POST", `/v1/draws/${entitlementId}/consume`, {
    token: session.token,
    key: idempotencyKey,
    expected: [200],
    label: `${name} draw consume`,
  });
  const first = await request();
  const result = assertDrawResult(first.data, { label: `${name} draw`, entitlementId, productId, prizeIds, slotNumber });
  if (replay) {
    const second = await request();
    expect(isDeepStrictEqual(second.data, first.data), "IDEMPOTENCY_FAILURE", `${name} draw replay changed the committed result.`);
  }
  return result;
}

async function getPublishedOdds(client, product) {
  const { data } = await client.request("GET", `/v1/catalog/products/${product.id}/draw-odds`, { label: `${product.category} odds` });
  const odds = object(data, `${product.category} odds`);
  expect(odds.productId === product.id, "FIXTURE_MISMATCH", "Published odds product did not match the fixed catalog product.");
  expect(Array.isArray(odds.entries) && odds.entries.length > 0, "FIXTURE_MISMATCH", "Published odds did not include a prize pool.");
  const prizeIds = odds.entries.map((entry) => string(object(entry, "Odds entry").prizeProductId, "Odds prizeProductId"));
  expect(new Set(prizeIds).size === prizeIds.length, "FIXTURE_MISMATCH", "Published odds repeated a prize product.");
  return { version: positiveInteger(odds.version, "Published odds version"), prizeIds };
}

async function assertCommittedGachaConsumption(client, { session, order, product, version, results, label }) {
  const completion = object((await client.request("GET", `/v1/orders/${order.id}/draw-completion`, {
    token: session.token,
    label: `${label} draw completion`,
  })).data, `${label} draw completion`);
  expect(
    completion.orderId === order.id
      && completion.userId === session.actor.userId
      && completion.productId === product.id
      && completion.probabilityVersion === version,
    "DRAW_MISMATCH",
    `${label} draw completion identity did not match.`,
  );
  expect(Array.isArray(completion.results) && completion.results.length === results.length, "DRAW_MISMATCH", `${label} draw completion count did not match.`);
  for (const result of results) {
    const committed = completion.results.find((item) => item.entitlementId === result.entitlementId);
    expect(committed?.resultId === result.id, "DRAW_MISMATCH", `${label} immutable result ID did not match the consume response.`);
    expect(typeof committed.committedAt === "string" && Number.isFinite(Date.parse(committed.committedAt)), "DRAW_MISMATCH", `${label} committed timestamp was invalid.`);
  }
  const consumed = await listAll(client, "/v1/account/draw-entitlements?status=CONSUMED", session.token);
  for (const result of results) {
    const entitlement = consumed.find((item) => item.id === result.entitlementId);
    expect(
      entitlement?.orderId === order.id
        && entitlement.product?.id === product.id
        && entitlement.probabilityVersion === version
        && entitlement.status === "CONSUMED"
        && typeof entitlement.consumedAt === "string"
        && Number.isFinite(Date.parse(entitlement.consumedAt)),
      "DRAW_MISMATCH",
      `${label} consumed entitlement did not persist.`,
    );
  }
}

async function coreGachaScenario(client, session, product, odds, runId) {
  const { version, prizeIds } = odds;
  const inventoryBefore = await listAll(client, "/v1/account/inventory", session.token);
  const order = await createOrder(client, { session, product, version, quantity: 1, runId, name: "core-gacha" });
  const paid = await transition(client, {
    session, order, product, quantity: 1, action: "approve", runId, name: "core-gacha", status: "PAID", replay: true,
  });
  const entitlementId = paid.drawEntitlementIds[0];
  const result = await consume(client, {
    session, entitlementId, productId: product.id, prizeIds, runId, name: "core-gacha", replay: true,
  });
  const currentOrder = await client.request("GET", `/v1/orders/${order.id}`, { token: session.token, label: "Consumed gacha order" });
  assertOrder(currentOrder.data, {
    label: "Consumed gacha order",
    userId: session.actor.userId,
    productId: product.id,
    category: product.category,
    quantity: 1,
    status: "PAID",
    entitlements: 1,
  });
  await assertCommittedGachaConsumption(client, {
    session, order, product, version, results: [result], label: "Core gacha",
  });
  const inventoryAfter = await listAll(client, "/v1/account/inventory", session.token);
  expect(!inventoryBefore.some((item) => item.id === result.prizeInventoryUnitId), "DRAW_MISMATCH", "The committed inventory ID already existed before the draw.");
  const committed = inventoryAfter.filter((item) => item.id === result.prizeInventoryUnitId);
  expect(committed.length === 1, "IDEMPOTENCY_FAILURE", "The replayed draw did not produce exactly one inventory unit.");
  expect(committed[0].ownerId === session.actor.userId && committed[0].sourceType === "GACHA", "DRAW_MISMATCH", "The committed gacha inventory provenance did not match.");
}

async function stockReleaseScenario(client, session, product, version, runId, action) {
  const before = await productSnapshot(client, product);
  const order = await createOrder(client, { session, product, version, quantity: 1, runId, name: `stock-${action}` });
  const reserved = await productSnapshot(client, product);
  expect(reserved.availableQuantity === before.availableQuantity - 1, "STOCK_MISMATCH", `${action} order did not reserve exactly one unit.`);
  await transition(client, { session, order, product, quantity: 1, action, runId, name: `stock-${action}`, status: "CANCELLED" });
  const released = await productSnapshot(client, product);
  expect(released.availableQuantity === before.availableQuantity, "STOCK_MISMATCH", `${action} did not release exactly one unit.`);
}

async function refundScenario(client, session, product, version, runId) {
  const before = await productSnapshot(client, product);
  const order = await createOrder(client, { session, product, version, quantity: 1, runId, name: "refund" });
  const paid = await transition(client, { session, order, product, quantity: 1, action: "approve", runId, name: "refund", status: "PAID" });
  const paidStock = await productSnapshot(client, product);
  expect(paidStock.availableQuantity === before.availableQuantity - 1, "STOCK_MISMATCH", "Paid unconsumed gacha stock did not decrease exactly once.");
  await transition(client, { session, order: paid, product, quantity: 1, action: "refund", runId, name: "refund", status: "REFUNDED" });
  const refundedStock = await productSnapshot(client, product);
  expect(refundedStock.availableQuantity === before.availableQuantity, "STOCK_MISMATCH", "Refund did not restore the unconsumed gacha stock.");
  const cancelled = await listAll(client, "/v1/account/draw-entitlements?status=CANCELLED", session.token);
  expect(cancelled.some((item) => item.id === paid.drawEntitlementIds[0] && item.status === "CANCELLED"), "REFUND_MISMATCH", "Refunded entitlement was not durably cancelled.");
}

async function createGachaInventory(client, session, product, odds, quantity, runId, name) {
  const { version, prizeIds } = odds;
  const order = await createOrder(client, { session, product, version, quantity, runId, name });
  const paid = await transition(client, { session, order, product, quantity, action: "approve", runId, name, status: "PAID" });
  const results = [];
  for (const [index, entitlementId] of paid.drawEntitlementIds.entries()) {
    results.push(await consume(client, { session, entitlementId, productId: product.id, prizeIds, runId, name: `${name}-${index + 1}` }));
  }
  const currentOrder = await client.request("GET", `/v1/orders/${order.id}`, { token: session.token, label: `${name} consumed order` });
  assertOrder(currentOrder.data, {
    label: `${name} consumed order`, userId: session.actor.userId, productId: product.id, category: product.category,
    quantity, status: "PAID", entitlements: quantity,
  });
  await assertCommittedGachaConsumption(client, { session, order, product, version, results, label: name });
  return results;
}

async function pointReturnScenario(client, session, inventoryUnitId, runId) {
  const ownedBefore = await listAll(client, "/v1/account/inventory", session.token);
  const inventory = ownedBefore.find((item) => item.id === inventoryUnitId);
  expect(inventory, "POINT_RETURN_MISMATCH", "Point-return inventory was not owned before the request.");
  const referenceAmount = integer(inventory.product?.price, "Point-return inventory product price");
  const expectedPointAmount = Math.floor(referenceAmount / 2);
  expect(expectedPointAmount > 0, "POINT_RETURN_MISMATCH", "Point-return inventory had no positive server reference value.");
  const beforeResponse = await client.request("GET", "/v1/account/points?limit=100", { token: session.token, label: "Points before return" });
  const before = object(beforeResponse.data, "Points before return");
  integer(before.balance, "Points before return balance");
  const returnedResponse = await client.request("POST", "/v1/account/point-returns", {
    token: session.token,
    key: key(runId, "point-return"),
    body: { inventoryUnitIds: [inventoryUnitId] },
    expected: [201],
    label: "Point return",
  });
  const returned = object(returnedResponse.data, "Point return");
  expect(isDeepStrictEqual(returned.inventoryUnitIds, [inventoryUnitId]), "POINT_RETURN_MISMATCH", "Point return inventory did not match.");
  expect(returned.totalPointAmount === expectedPointAmount, "POINT_RETURN_MISMATCH", "Point return was not exactly half the inventory product price rounded down.");
  expect(returned.balance === before.balance + returned.totalPointAmount, "POINT_RETURN_MISMATCH", "Point return balance did not increase by the committed amount.");
  const after = object((await client.request("GET", "/v1/account/points?limit=100", { token: session.token, label: "Points after return" })).data, "Points after return");
  expect(after.balance === returned.balance, "POINT_RETURN_MISMATCH", "Point return balance did not persist.");
  const ownedAfter = await listAll(client, "/v1/account/inventory", session.token);
  expect(!ownedAfter.some((item) => item.id === inventoryUnitId), "POINT_RETURN_MISMATCH", "Returned inventory remained in owned inventory.");
}

async function kujiScenario(client, session, product, runId) {
  const odds = await getPublishedOdds(client, product);
  const beforeResponse = await client.request("GET", `/v1/catalog/products/${product.id}/kuji-slots`, { label: "Kuji deck before" });
  const before = object(beforeResponse.data, "Kuji deck before");
  expect(before.productId === product.id && Array.isArray(before.slots), "KUJI_MISMATCH", "Kuji deck did not match the demo product.");
  const version = positiveInteger(before.probabilityVersion, "Kuji probabilityVersion");
  expect(version === odds.version, "KUJI_MISMATCH", "Kuji board and published odds did not agree on the active version.");
  const available = before.slots.find((slot) => slot.available === true);
  expect(available && Number.isSafeInteger(available.slotNumber), "KUJI_MISMATCH", "Kuji deck had no available finite slot.");
  const remainingBefore = before.tiers.reduce((sum, tier) => sum + integer(tier.remainingQuantity, "Kuji tier remainingQuantity"), 0);
  const joinedResponse = await client.request("POST", `/v1/kuji/rooms/${product.id}/entries`, {
    token: session.token,
    expected: [201],
    label: "Kuji room join",
  });
  const room = object(joinedResponse.data, "Kuji room");
  const viewer = object(room.viewer, "Kuji room viewer");
  uuid(viewer.entryId, "Kuji room viewer.entryId");
  expect(viewer.state === "CHECKOUT_PENDING", "KUJI_MISMATCH", "Kuji room did not grant the checkout lease.");
  const order = await createOrder(client, {
    session, product, version, quantity: 1, runId, name: "kuji", kujiRoomEntryId: viewer.entryId,
  });
  const paid = await transition(client, { session, order, product, quantity: 1, action: "approve", runId, name: "kuji", status: "PAID" });
  const entitlementId = paid.drawEntitlementIds[0];
  const boundResponse = await client.request("POST", `/v1/kuji/rooms/${product.id}/entries/${viewer.entryId}/slots`, {
    token: session.token,
    key: key(runId, "kuji-slot"),
    body: { probabilityVersion: version, slotNumbers: [available.slotNumber] },
    expected: [201],
    label: "Kuji slot binding",
  });
  const bound = object(boundResponse.data, "Kuji slot binding");
  expect(bound.productId === product.id && bound.roomEntryId === viewer.entryId && bound.probabilityVersion === version, "KUJI_MISMATCH", "Kuji binding identity did not match.");
  expect(bound.bindings?.length === 1 && bound.bindings[0].entitlementId === entitlementId && bound.bindings[0].slotNumber === available.slotNumber && bound.bindings[0].state === "RESERVED", "KUJI_MISMATCH", "Kuji binding did not reserve the selected slot.");
  await consume(client, { session, entitlementId, productId: product.id, prizeIds: odds.prizeIds, runId, name: "kuji", slotNumber: available.slotNumber });
  const after = object((await client.request("GET", `/v1/catalog/products/${product.id}/kuji-slots`, { label: "Kuji deck after" })).data, "Kuji deck after");
  const selectedAfter = after.slots.find((slot) => slot.slotNumber === available.slotNumber);
  expect(selectedAfter?.available === false, "KUJI_MISMATCH", "Consumed kuji slot remained available.");
  const remainingAfter = after.tiers.reduce((sum, tier) => sum + integer(tier.remainingQuantity, "Kuji tier remainingQuantity"), 0);
  expect(remainingAfter === remainingBefore - 1, "KUJI_MISMATCH", "Kuji finite remaining count did not decrease exactly once.");
}

export function safeSummary({ requestCount, scenarios }) {
  return JSON.stringify({
    verifier: "demo-commerce",
    fixture: DEMO.fixtureTag,
    profile: DEMO.capabilities.profile,
    paymentProvider: DEMO.capabilities.paymentProvider,
    requestCount,
    scenarios,
    persistent: true,
    realMoney: false,
    externalWorkersRun: false,
  });
}

export async function runDemoCommerce({ argv = [], fetchImpl = globalThis.fetch, stdout = process.stdout } = {}) {
  const { baseUrl } = parseCliArgs(argv);
  expect(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "fetch is unavailable.");
  const client = new ApiClient(baseUrl, fetchImpl);
  const runId = randomUUID();
  const capabilities = (await client.request("GET", "/v1/demo/capabilities", { label: "Demo capabilities" })).data;
  assertDemoCapabilities(capabilities);

  const session = assertSession((await client.request("POST", "/v1/demo/session", {
    expected: [201], label: "Internal customer session",
  })).data);

  const policyStatus = object((await client.request("GET", "/v1/account/policy-acceptances", {
    token: session.token,
    label: "Local customer policy status",
  })).data, "Local customer policy status");
  const documents = policyStatus.documents;
  expect(Array.isArray(documents) && documents.length === 2, "POLICY_MISMATCH", "Exactly two current policy documents are required.");
  const policyByKey = new Map(documents.map((document) => [document.key, document]));
  const terms = policyByKey.get("TERMS");
  const privacy = policyByKey.get("PRIVACY");
  for (const document of [terms, privacy]) {
    expect(document && typeof document.version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(document.version)
      && typeof document.contentSha256 === "string" && /^[0-9a-f]{64}$/i.test(document.contentSha256)
      && typeof document.publicUrl === "string" && document.publicUrl.startsWith("https://dabboba.net/"),
    "POLICY_MISMATCH", "The current local policy document did not match the published test contract.");
  }
  if (!terms.accepted || !privacy.accepted) {
    await client.request("POST", "/v1/account/policy-acceptances", {
      token: session.token,
      body: { acceptedPolicies: { terms: terms.version, privacy: privacy.version } },
      expected: [204],
      label: "Automated local customer policy acceptance",
    });
  }

  const gacha = await productSnapshot(client, DEMO.gacha);
  const kuji = await productSnapshot(client, DEMO.kuji);
  const catalog = await listAll(client, "/v1/catalog/products", undefined);
  for (const product of [gacha, kuji]) {
    const listed = catalog.find((item) => item.id === product.id);
    expect(listed?.name === product.name && listed.saleStatus === "ON_SALE", "FIXTURE_MISMATCH", `${product.name} was not visible in the internal catalog.`);
  }
  const home = object((await client.request("GET", "/v1/catalog/home-sections", {
    label: "Internal Home sections",
  })).data, "Internal Home sections");
  expect(home.configured === true && Array.isArray(home.items), "FIXTURE_MISMATCH", "Internal Home sections were not configured.");
  for (const [id, layoutKind, product] of [
    ["local-example-gacha", "gacha", gacha],
    ["local-example-kuji", "kuji", kuji],
  ]) {
    const section = home.items.find((item) => item.id === id);
    expect(section?.layoutKind === layoutKind && section.products?.some((item) => item.id === product.id),
      "FIXTURE_MISMATCH", `${product.name} was not visible on the internal Home screen.`);
  }
  const gachaOdds = await getPublishedOdds(client, gacha);
  const scenarios = [];

  await coreGachaScenario(client, session, gacha, gachaOdds, runId);
  scenarios.push("gacha-approve-consume-idempotency-persistence");
  await stockReleaseScenario(client, session, gacha, gachaOdds.version, runId, "fail");
  scenarios.push("failed-payment-stock-release");
  await stockReleaseScenario(client, session, gacha, gachaOdds.version, runId, "cancel");
  scenarios.push("cancelled-payment-stock-release");
  await refundScenario(client, session, gacha, gachaOdds.version, runId);
  scenarios.push("paid-unconsumed-refund");

  const assets = await createGachaInventory(client, session, gacha, gachaOdds, 1, runId, "customer-assets");
  await pointReturnScenario(client, session, assets[0].prizeInventoryUnitId, runId);
  scenarios.push("gacha-point-return");
  await kujiScenario(client, session, kuji, runId);
  scenarios.push("finite-kuji-room-order-select-consume");

  const summary = safeSummary({ requestCount: client.requestCount, scenarios });
  stdout.write(`${summary}\n`);
  return { requestCount: client.requestCount, scenarios };
}

function safeFailure(error) {
  if (error instanceof DemoSmokeError) return `${error.code}: ${error.message}`;
  return "UNEXPECTED_FAILURE: inspect the loopback API and verifier privately.";
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runDemoCommerce({ argv: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`Demo commerce verification failed: ${safeFailure(error)}\n`);
    process.exitCode = error instanceof DemoSmokeError && ["USAGE", "RUN_FLAG_REQUIRED"].includes(error.code) ? 64 : 1;
  });
}
