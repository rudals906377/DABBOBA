import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireMobile = createRequire(`${root}/apps/mobile/package.json`);
const ts = requireMobile("typescript");
const guestModule = await import(`${root}/apps/mobile/src/features/profile/guest-profile-snapshot.ts`);
const responseModule = await import(`${root}/apps/mobile/src/features/profile/profile-response.ts`);
const source = readFileSync(`${root}/apps/mobile/src/features/profile/profile-api.ts`, "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const privatePaths = [
  "auth/me",
  "account/profile",
  "account/basic-info",
  "account/default-address",
  "account/wishlist",
  "account/inventory",
  "account/orders",
  "account/points",
  "account/shipping-requests",
  "inquiries",
  "account/notification-preferences",
];

function setup(failPath, failStatus = 503, inventoryPages = new Map()) {
  const calls = [];
  const requests = [];
  const owned = [{ id: "server-owned", status: "OWNED" }];
  const wishlist = [
    { id: "visible", product: { category: "gacha" } },
    { id: "hidden", product: { category: "tcg" } },
  ];
  const profile = { nickname: "server nickname", version: 4 };
  const client = {
    GET: async (requestPath, options) => {
      calls.push(requestPath);
      requests.push({ requestPath, options });
      if (requestPath === failPath) {
        return { response: { status: failStatus }, error: {} };
      }
      if (requestPath === "/v1/account/inventory") {
        const cursor = options?.params?.query?.cursor ?? null;
        const page = inventoryPages.get(cursor);
        if (page?.errorStatus) {
          return { response: { status: page.errorStatus }, error: {} };
        }
        if (page) return { data: page, response: { status: 200 } };
      }
      const data = requestPath === "/v1/auth/me"
        ? { actor: { userId: "server-user" } }
        : requestPath === "/v1/account/profile"
          ? profile
          : requestPath === "/v1/account/points"
            ? { balance: 32400, items: [{ id: "ledger" }] }
            : requestPath === "/v1/account/inventory"
              ? { items: owned }
              : requestPath === "/v1/account/wishlist"
                ? { items: wishlist }
                : { items: [] };
      return { data, response: { status: 200 } };
    },
  };
  const exports = {};
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "expo-crypto") return { randomUUID: () => "test-only" };
      if (name === "@dabboba/api-client") {
        return { errorMessage: (_error, fallback) => fallback };
      }
      if (name.endsWith("product-categories")) {
        return {
          isCustomerVisibleProductCategory: (category) => category !== "tcg",
          isCustomerBrowsableCatalogCategory: (category) => (
            category === "gacha" || category === "kuji"
          ),
        };
      }
      if (name.endsWith("mobile-api-client")) {
        return { createMobileDabbobaClient: () => client };
      }
      if (name.endsWith("guest-profile-snapshot")) return guestModule;
      if (name.endsWith("profile-response")) return responseModule;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { fetch: exports.fetchProfileSnapshot, calls, requests, owned, profile };
}

test("guest snapshot API never invents account records or invokes private endpoints", async () => {
  const harness = setup();
  const result = await harness.fetch("http://test.invalid");
  assert.equal(result.profile.nickname, "");
  assert.equal(result.defaultAddress, null);
  for (const key of ["inventory", "wishlist", "inquiries", "notices", "orders"]) {
    assert.equal(result[key].length, 0);
  }
  assert.equal(
    harness.calls.some((requestPath) => privatePaths.includes(requestPath.replace("/v1/", ""))),
    false,
  );
});

test("authenticated snapshot retains server records and customer category policy", async () => {
  const harness = setup();
  const result = await harness.fetch("http://test.invalid", "test-only-token");
  assert.equal(result.profile, harness.profile);
  assert.equal(result.inventory.map((item) => item.id).join(","), harness.owned.map((item) => item.id).join(","));
  assert.equal(result.pointBalance, 32400);
  assert.equal(result.wishlist.length, 1);
  assert.equal(result.wishlist[0].id, "visible");
  assert.equal(result.isExample, false);
});

test("authenticated snapshot follows every inventory cursor with the maximum page size", async () => {
  const pages = new Map([
    [null, { items: [{ id: "page-1" }], nextCursor: "page-2" }],
    ["page-2", { items: [{ id: "page-2" }], nextCursor: "page-3" }],
    ["page-3", { items: [{ id: "page-3" }], nextCursor: null }],
  ]);
  const harness = setup(undefined, 503, pages);
  const result = await harness.fetch("http://test.invalid", "test-only-token");

  assert.equal(result.inventory.map((item) => item.id).join(","), "page-1,page-2,page-3");
  const inventoryRequests = harness.requests.filter(({ requestPath }) => requestPath === "/v1/account/inventory");
  assert.equal(
    inventoryRequests.map(({ options }) => options.params.query.cursor ?? "first").join(","),
    "first,page-2,page-3",
  );
  assert.equal(inventoryRequests.every(({ options }) => options.params.query.limit === 100), true);
});

test("inventory pagination reports a later page failure while preserving the verified pages", async () => {
  const pages = new Map([
    [null, { items: [{ id: "page-1" }], nextCursor: "page-2" }],
    ["page-2", { errorStatus: 503 }],
  ]);
  const harness = setup(undefined, 503, pages);
  const result = await harness.fetch("http://test.invalid", "test-only-token");
  assert.equal(result.inventory.map((item) => item.id).join(","), "page-1");
  assert.match(result.sectionErrors.inventory, /보관함을 모두 불러오지 못했어요/);
});

test("inventory pagination rejects a repeated cursor instead of returning partial data", async () => {
  const pages = new Map([
    [null, { items: [{ id: "page-1" }], nextCursor: "repeat" }],
    ["repeat", { items: [{ id: "page-2" }], nextCursor: "repeat" }],
  ]);
  const harness = setup(undefined, 503, pages);
  await assert.rejects(
    harness.fetch("http://test.invalid", "test-only-token"),
    (error) => error.status === 502 && /반복/.test(error.message),
  );
});

test("only a missing-address 404 becomes a normal null address", async () => {
  const harness = setup("/v1/account/default-address", 404);
  const result = await harness.fetch("http://test.invalid", "test-only-token");
  assert.equal(result.defaultAddress, null);
  assert.equal(result.pointBalance, 32400);
});

for (const privatePath of ["auth/me", "account/profile", "account/basic-info"]) {
  test(`required private /v1/${privatePath} failure rejects the profile snapshot`, async () => {
    for (const status of [401, 503]) {
      const harness = setup(`/v1/${privatePath}`, status);
      await assert.rejects(
        harness.fetch("http://test.invalid", "test-only-token"),
        (error) => error.status === status,
      );
    }
  });
}

test("a failed /v1/account/orders 500 becomes a null section while other sections load", async () => {
  const harness = setup("/v1/account/orders", 500);
  const result = await harness.fetch("http://test.invalid", "test-only-token");
  assert.equal(result.orders, null);
  assert.equal(typeof result.sectionErrors.orders, "string");
  assert.ok(result.sectionErrors.orders.length > 0);
  assert.equal(result.pointBalance, 32400);
  assert.equal(result.pointHistory.length, 1);
  assert.equal(result.inventory.map((item) => item.id).join(","), "server-owned");
  assert.equal(result.wishlist.length, 1);
  assert.deepEqual(result.shippingRequests, []);
  for (const section of ["points", "inventory", "wishlist", "shipping", "inquiries", "preferences"]) {
    assert.equal(result.sectionErrors[section], undefined);
  }
});

test("a failed points request never reads as a zero balance", async () => {
  const harness = setup("/v1/account/points", 500);
  const result = await harness.fetch("http://test.invalid", "test-only-token");
  assert.equal(result.pointBalance, null);
  assert.equal(result.pointHistory, null);
  assert.equal(typeof result.sectionErrors.points, "string");
  assert.deepEqual(result.orders, []);
});

const optionalPrivateSections = new Map([
  ["account/default-address", "address"],
  ["account/wishlist", "wishlist"],
  ["account/inventory", "inventory"],
  ["account/orders", "orders"],
  ["account/points", "points"],
  ["account/shipping-requests", "shipping"],
  ["inquiries", "inquiries"],
  ["account/notification-preferences", "preferences"],
]);

for (const [privatePath, section] of optionalPrivateSections) {
  test(`optional private /v1/${privatePath} failure is surfaced on its section`, async () => {
    for (const status of [401, 503]) {
      const harness = setup(`/v1/${privatePath}`, status);
      const result = await harness.fetch("http://test.invalid", "test-only-token");
      assert.equal(typeof result.sectionErrors[section], "string");
      assert.ok(result.sectionErrors[section].length > 0);
    }
  });
}

for (const publicPath of ["catalog/products", "catalog/ips"]) {
  test(`required public /v1/${publicPath} failure rejects the profile snapshot`, async () => {
    const harness = setup(`/v1/${publicPath}`);
    await assert.rejects(
      harness.fetch("http://test.invalid"),
      (error) => error.status === 503,
    );
  });
}

for (const [publicPath, section] of [["wanted-requests", "wanted"], ["notices", "notices"]]) {
  test(`optional public /v1/${publicPath} failure is surfaced on its section`, async () => {
    const harness = setup(`/v1/${publicPath}`);
    const result = await harness.fetch("http://test.invalid");
    assert.equal(typeof result.sectionErrors[section], "string");
    assert.ok(result.sectionErrors[section].length > 0);
  });
}
