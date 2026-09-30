import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  collectAvailableDrawEntitlements,
  groupAvailableDrawEntitlements,
  preparePaidDrawRecovery,
} from "../apps/mobile/src/features/profile/paid-draw-recovery-state.ts";

const actorId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const ids = [1, 2, 3].map((number) => `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
const product = { id: "sold-out-gacha", category: "gacha", name: "이전 판매 상품", imageUrl: null };
const entitlement = (id, overrides = {}) => ({
  id, orderId, orderLineId: "40000000-0000-4000-8000-000000000001", product,
  status: "AVAILABLE", probabilityVersion: 2, createdAt: "2026-09-06T00:00:00Z", consumedAt: null,
  ...overrides,
});
const order = (overrides = {}) => ({
  id: orderId, userId: actorId, status: "PAID",
  lines: [{ productId: product.id, category: "gacha", quantity: 3 }],
  drawEntitlementIds: ids,
  ...overrides,
});
const group = () => groupAvailableDrawEntitlements(ids.slice(1).map((id) => entitlement(id)))[0];
const page = (items, nextCursor = null) => ({ items, nextCursor });
const source = (overrides = {}) => ({
  fetchActorId: async () => actorId,
  fetchOrder: async () => order(),
  fetchPage: async () => page(ids.slice(1).map((id) => entitlement(id))),
  ...overrides,
});

test("account recovery groups only available draw rights and deduplicates overlapping pages", () => {
  const groups = groupAvailableDrawEntitlements([
    entitlement(ids[0], { status: "CONSUMED" }),
    entitlement(ids[1]), entitlement(ids[1]), entitlement(ids[2]),
    entitlement("other", { product: { ...product, category: "figure" } }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entitlementIds, ids.slice(1));
});

test("reinstall recovery follows pagination and resumes only remaining rights without local storage or catalog", async () => {
  const calls = [];
  const result = await preparePaidDrawRecovery(group(), actorId, source({
    fetchPage: async (cursor) => {
      calls.push(cursor);
      return cursor ? page([entitlement(ids[2])]) : page([entitlement(ids[1])], "older");
    },
  }));
  assert.deepEqual(calls, [undefined, "older"]);
  const route = new URL(result, "https://app.invalid");
  assert.equal(route.pathname, `/draw/reveal/${ids[1]}`);
  assert.equal(route.searchParams.get("entitlementIds"), ids.slice(1).join(","));
  assert.equal(route.searchParams.get("productId"), product.id);
  assert.equal(route.searchParams.get("orderId"), orderId);
  assert.equal(route.searchParams.get("category"), "gacha");
});

test("fresh status and identity checks reject refunded, pending, cross-account and unrelated entitlements", async () => {
  for (const status of ["PENDING_PAYMENT", "REFUND_REVIEW", "REFUNDED", "CANCELLED"]) {
    await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({ fetchOrder: async () => order({ status }) })), /결제 완료/);
  }
  await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({ fetchActorId: async () => "another-user" })), /계정/);
  await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({ fetchOrder: async () => order({ userId: "another-user" }) })), /계정/);
  await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({ fetchOrder: async () => order({ drawEntitlementIds: [ids[0]] }) })), /추첨권/);
  await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({ fetchPage: async () => page([]) })), /추첨권이 없어요/);
});

test("an entitlement consumed on another device disappears from the recovered sequence", async () => {
  const result = await preparePaidDrawRecovery(group(), actorId, source({ fetchPage: async () => page([entitlement(ids[2])]) }));
  assert.equal(new URL(result, "https://app.invalid").searchParams.get("entitlementIds"), ids[2]);
});

test("pagination failure, repeated cursor and cancelled focus fail without partial recovery", async () => {
  await assert.rejects(collectAvailableDrawEntitlements(async (cursor) => {
    if (cursor) throw new Error("offline");
    return page([entitlement(ids[1])], "next");
  }), /offline/);
  await assert.rejects(collectAvailableDrawEntitlements(async () => page([], "repeated")), /목록/);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(preparePaidDrawRecovery(group(), actorId, source({
    fetchActorId: async () => { controller.abort(); return actorId; },
    fetchOrder: async () => { calls += 1; return order(); },
  }), controller.signal), /취소/);
  assert.equal(calls, 0);
});

const kujiProduct = { ...product, id: "paid-kuji", category: "kuji" };
const kujiGroup = (remainingIds = ids.slice(1)) => groupAvailableDrawEntitlements(
  remainingIds.map((id) => entitlement(id, { product: kujiProduct })),
)[0];
const kujiRecovery = (overrides = {}) => ({
  orderId, userId: actorId, productId: kujiProduct.id,
  roomEntryId: "50000000-0000-4000-8000-000000000001",
  roomState: "EXPIRED", serverNow: "2026-09-06T12:00:00Z",
  drawingExpiresAt: "2026-09-06T00:05:00Z", probabilityVersion: 2, totalSlots: 50,
  entitlementIds: ids.slice(1),
  bindings: [
    { entitlementId: ids[2], slotNumber: 9, state: "RESERVED" },
    { entitlementId: ids[1], slotNumber: 21, state: "RESERVED" },
  ],
  ...overrides,
});
const kujiSource = (recoveryOverrides = {}, remainingIds = ids.slice(1)) => source({
  fetchOrder: async () => order({ lines: [{ productId: kujiProduct.id, category: "kuji", quantity: 3 }] }),
  fetchPage: async () => page(remainingIds.map((id) => entitlement(id, { product: kujiProduct }))),
  fetchKujiRecovery: async () => kujiRecovery(recoveryOverrides),
});

test("expired paid kuji recovery preserves remaining entitlement-to-slot mapping without a new lease", async () => {
  const result = await preparePaidDrawRecovery(kujiGroup(), actorId, kujiSource());
  const route = new URL(result, "https://app.invalid");
  assert.equal(route.pathname, `/draw/reveal/${ids[1]}`);
  assert.equal(route.searchParams.get("tickets"), "21,09");
  assert.equal(route.searchParams.get("entitlementIds"), ids.slice(1).join(","));
  assert.equal(route.searchParams.get("kujiEntryId"), kujiRecovery().roomEntryId);
  assert.equal(route.searchParams.has("drawingExpiresAt"), false);
});

test("unselected paid kuji restores exact purchased selection count using its original server room", async () => {
  const result = await preparePaidDrawRecovery(kujiGroup(ids), actorId, kujiSource({
    roomState: "DRAWING", entitlementIds: ids, bindings: [],
  }, ids));
  const route = new URL(result, "https://app.invalid");
  assert.equal(route.pathname, `/kuji/draw/${kujiProduct.id}`);
  assert.equal(route.searchParams.get("count"), "3");
  assert.equal(route.searchParams.get("entitlementIds"), ids.join(","));
  assert.equal(route.searchParams.get("kujiEntryId"), kujiRecovery().roomEntryId);
});

test("kuji rejects incomplete, duplicate, foreign or invalid slot mapping and version changes", async () => {
  const cases = [
    { userId: "another-user" }, { orderId: "another-order" }, { productId: "other-kuji" },
    { probabilityVersion: 3 }, { roomState: "CHECKOUT_PENDING" }, { roomEntryId: "fake" },
    { serverNow: "invalid" }, { drawingExpiresAt: "invalid" }, { totalSlots: 0 },
    { entitlementIds: [ids[1], ids[1]] }, { entitlementIds: [ids[0]] },
    { bindings: [] }, { bindings: [kujiRecovery().bindings[0]] },
    { bindings: kujiRecovery().bindings.map((item) => ({ ...item, slotNumber: 1 })) },
    { bindings: kujiRecovery().bindings.map((item) => ({ ...item, slotNumber: 51 })) },
    { bindings: kujiRecovery().bindings.map((item) => ({ ...item, state: "CONSUMED" })) },
  ];
  for (const overrides of cases) {
    await assert.rejects(preparePaidDrawRecovery(kujiGroup(), actorId, kujiSource(overrides)));
  }
});

test("a kuji snapshot consumed meanwhile reports no remaining rights without reopening selection", async () => {
  await assert.rejects(preparePaidDrawRecovery(kujiGroup(), actorId, kujiSource({
    roomState: "COMPLETED", entitlementIds: [], bindings: [],
  })), /추첨권이 없어요/);
});

test("the kuji recovery snapshot can remove a right consumed after the account page was fetched", async () => {
  const result = await preparePaidDrawRecovery(kujiGroup(), actorId, kujiSource({
    entitlementIds: [ids[2]], bindings: [{ entitlementId: ids[2], slotNumber: 9, state: "RESERVED" }],
  }));
  const route = new URL(result, "https://app.invalid");
  assert.equal(route.searchParams.get("entitlementIds"), ids[2]);
  assert.equal(route.searchParams.get("tickets"), "09");
});

test("a late kuji response after leaving the screen cannot produce a navigation route", async () => {
  const controller = new AbortController();
  const boundary = kujiSource();
  boundary.fetchKujiRecovery = async () => {
    controller.abort();
    return kujiRecovery();
  };
  await assert.rejects(preparePaidDrawRecovery(kujiGroup(), actorId, boundary, controller.signal), /취소/);
});

test("purchase history mounts authenticated recovery with explicit navigation and read-only API boundaries", async () => {
  const [screen, component, api] = await Promise.all([
    readFile(new URL("../apps/mobile/src/features/profile/ProfileSectionScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/profile/PaidDrawRecovery.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/mobile/src/features/profile/paid-draw-recovery-api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(screen, /!snapshot\.isExample && profileState\.accessToken[\s\S]*?<PaidDrawRecovery/);
  assert.match(component, /onPress=\{\(\) => void resume\(group\)\}/);
  assert.match(component, /useFocusEffect/);
  assert.match(component, /controller\.abort\(\)/);
  assert.match(component, /currentTokens\?\.accessToken !== accessToken/);
  assert.match(component, /route\.startsWith\("\/draw\/reveal\/"\)/);
  assert.match(component, /presentDrawOpenModeChoice\(drawEntitlementCountFromPath\(route\)/);
  assert.match(component, /withDrawOpenMode\(route, mode\)/);
  assert.match(api, /status: "AVAILABLE"/);
  assert.match(api, /\/v1\/orders\/\{orderId\}\/draw-recovery/);
  assert.doesNotMatch(api, /\.POST\(|\.DELETE\(|\.PATCH\(|SQLite|consume/);
});
