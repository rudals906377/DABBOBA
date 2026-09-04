import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import {
  exchangeInventoryBundleInput,
  isDrawExchangeSource,
  isExchangeEligibleInventory,
  isExchangeListingTransitionAllowed,
  isExchangeOfferTransitionAllowed,
  isOriginalGachaDrawProvenance,
  orderedInventoryIds,
  registerExchangeRoutes,
} from "./exchange.js";

type Handler = (request: Record<string, unknown>, reply?: Record<string, unknown>) => Promise<unknown>;

function routeHarness() {
  const routes = new Map<string, Handler>();
  const register = (method: string) => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") throw new Error("invalid route");
    routes.set(`${method} ${path}`, handler as Handler);
  };
  const app = {
    get: register("GET"),
    post: register("POST"),
  } as unknown as FastifyInstance;
  return { app, routes };
}

const authStub = {
  requireUser: async () => undefined,
  requirePermission: () => async () => undefined,
};

test("exchange listing lifecycle permits only forward terminal transitions", () => {
  assert.equal(isExchangeListingTransitionAllowed("OPEN", "MATCHED"), true);
  assert.equal(isExchangeListingTransitionAllowed("OPEN", "CANCELLED"), true);
  assert.equal(isExchangeListingTransitionAllowed("MATCHED", "COMPLETED"), true);
  assert.equal(isExchangeListingTransitionAllowed("MATCHED", "CANCELLED"), true);
  assert.equal(isExchangeListingTransitionAllowed("COMPLETED", "OPEN"), false);
  assert.equal(isExchangeListingTransitionAllowed("CANCELLED", "MATCHED"), false);
});

test("exchange offers cannot be reopened after a decision or withdrawal", () => {
  for (const terminal of ["ACCEPTED", "REJECTED", "WITHDRAWN"] as const) {
    assert.equal(isExchangeOfferTransitionAllowed("PENDING", terminal), true);
    assert.equal(isExchangeOfferTransitionAllowed(terminal, "PENDING"), false);
  }
});

test("inventory locks use one stable unique ordering", () => {
  assert.deepEqual(
    orderedInventoryIds([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]),
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ],
  );
});

test("exchange bundle input accepts one or two canonical ids and one legacy primary id", () => {
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  assert.deepEqual(exchangeInventoryBundleInput({ offeredInventoryUnitIds: [first] }), [first]);
  assert.deepEqual(exchangeInventoryBundleInput({ offeredInventoryUnitIds: [first, second] }), [first, second]);
  assert.deepEqual(exchangeInventoryBundleInput({ offeredInventoryUnitId: first }), [first]);
  assert.deepEqual(
    exchangeInventoryBundleInput({
      offeredInventoryUnitIds: [first, second],
      offeredInventoryUnitId: first,
    }),
    [first, second],
  );
});

test("exchange bundle input rejects empty, oversized, duplicate, and divergent legacy values", () => {
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  for (const input of [
    { offeredInventoryUnitIds: [] },
    { offeredInventoryUnitIds: [first, second, third] },
    { offeredInventoryUnitIds: [first, first] },
    { offeredInventoryUnitIds: [first], offeredInventoryUnitId: second },
  ]) {
    assert.throws(
      () => exchangeInventoryBundleInput(input),
      (error: unknown) => typeof error === "object" && error !== null
        && "statusCode" in error && error.statusCode === 400,
    );
  }
});

test("exchange proposals accept only inventory won from gacha draws", () => {
  assert.equal(isDrawExchangeSource("GACHA"), true);
  assert.equal(isDrawExchangeSource("KUJI"), false);
  assert.equal(isDrawExchangeSource("PURCHASE"), false);
  assert.equal(isDrawExchangeSource("ADMIN_ADJUSTMENT"), false);
});

test("exchange inventory must be a directly drawn gacha product that is still stored as owned", () => {
  assert.equal(isExchangeEligibleInventory("OWNED", "GACHA", true), true);
  assert.equal(isExchangeEligibleInventory("OWNED", "KUJI", true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "GACHA", false), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "KUJI", false), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "PURCHASE", true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "ADMIN_ADJUSTMENT", true), false);

  for (const status of [
    "EXCHANGE_LISTED",
    "EXCHANGE_OFFERED",
    "SHIPPING",
    "DELIVERED",
    "TRANSFERRED",
    "REFUNDED",
  ] as const) {
    assert.equal(isExchangeEligibleInventory(status, "GACHA", true), false);
    assert.equal(isExchangeEligibleInventory(status, "KUJI", true), false);
  }
});

test("exchange draw provenance rejects forged owner, entitlement, and prize links", () => {
  const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const entitlementId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const productId = "prize-product";
  const valid = {
    sourceType: "GACHA" as const,
    inventorySourceId: entitlementId,
    inventoryProductId: productId,
    drawOwnerId: ownerId,
    drawEntitlementId: entitlementId,
    drawPrizeProductId: productId,
    expectedOwnerId: ownerId,
  };

  assert.equal(isOriginalGachaDrawProvenance(valid), true);
  assert.equal(isOriginalGachaDrawProvenance({ ...valid, sourceType: "KUJI" }), false);
  assert.equal(isOriginalGachaDrawProvenance({ ...valid, inventorySourceId: null }), false);
  assert.equal(
    isOriginalGachaDrawProvenance({
      ...valid,
      drawOwnerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    false,
  );
  assert.equal(
    isOriginalGachaDrawProvenance({
      ...valid,
      drawEntitlementId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }),
    false,
  );
  assert.equal(
    isOriginalGachaDrawProvenance({ ...valid, drawPrizeProductId: "different-product" }),
    false,
  );
});

test("exchange inventory query exposes only directly drawn gacha inventory", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  const context = {
    pool: {
      async query(sql: string, values: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        return { rowCount: 0, rows: [] };
      },
    },
    auth: authStub,
  } as unknown as ApiContext;

  await registerExchangeRoutes(app, context);
  const handler = routes.get("GET /v1/exchange/inventory");
  assert.ok(handler);
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await handler({ query: {}, actor: { userId } });

  assert.match(capturedSql, /iu\.source_type='GACHA'/);
  assert.doesNotMatch(capturedSql, /'KUJI'/);
  assert.match(capturedSql, /draw_result\.user_id=iu\.owner_id/);
  assert.match(capturedSql, /draw_result\.entitlement_id=iu\.source_id/);
  assert.match(capturedSql, /draw_result\.prize_product_id=iu\.product_id/);
  assert.deepEqual(capturedValues, [userId, 31]);
});

test("exchange listing search includes product and IP names", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  const context = {
    pool: {
      async query(sql: string, values: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        return { rowCount: 0, rows: [] };
      },
    },
    auth: authStub,
  } as unknown as ApiContext;

  await registerExchangeRoutes(app, context);
  const handler = routes.get("GET /v1/exchange/listings");
  assert.ok(handler);
  await handler({ query: { q: "포켓몬스터" } });

  assert.match(capturedSql, /JOIN catalog_ips i ON i\.id=p\.ip_id/);
  assert.match(capturedSql, /FROM exchange_listing_items search_listing_item/);
  assert.match(capturedSql, /invalid_listing_product\.is_active=false/);
  assert.match(capturedSql, /invalid_listing_ip\.is_active=false/);
  assert.match(capturedSql, /invalid_listing_inventory\.source_type<>'GACHA'/);
  assert.match(
    capturedSql,
    /listing_draw_result\.entitlement_id=invalid_listing_inventory\.source_id/,
  );
  assert.match(
    capturedSql,
    /listing_draw_result\.prize_product_id=invalid_listing_inventory\.product_id/,
  );
  assert.match(capturedSql, /offer_draw_result\.entitlement_id=offer_inventory\.source_id/);
  assert.match(capturedSql, /offer_draw_result\.prize_product_id=offer_inventory\.product_id/);
  assert.match(capturedSql, /search_product\.name ILIKE \$2/);
  assert.match(capturedSql, /search_ip\.name_ko ILIKE \$2/);
  assert.match(capturedSql, /search_ip\.name_en ILIKE \$2/);
  assert.match(capturedSql, /array_to_string\(search_ip\.aliases, ' '\) ILIKE \$2/);
  assert.deepEqual(capturedValues, [31, "%포켓몬스터%"]);
});

test("exchange listing detail hides non-gacha legacy listings", async () => {
  const { app, routes } = routeHarness();
  let capturedSql = "";
  const context = {
    pool: {
      async query(sql: string) {
        capturedSql = sql;
        return { rowCount: 0, rows: [] };
      },
    },
    auth: authStub,
  } as unknown as ApiContext;

  await registerExchangeRoutes(app, context);
  const handler = routes.get("GET /v1/exchange/listings/:listingId");
  assert.ok(handler);
  await assert.rejects(
    handler({ params: { listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }),
    (error: unknown) => typeof error === "object" && error !== null && "statusCode" in error
      && error.statusCode === 404,
  );

  assert.match(capturedSql, /FROM exchange_listing_items invalid_listing_item/);
  assert.match(capturedSql, /invalid_listing_inventory\.source_type<>'GACHA'/);
  assert.match(capturedSql, /listing_draw_result\.user_id=l\.author_id/);
  assert.match(
    capturedSql,
    /listing_draw_result\.entitlement_id=invalid_listing_inventory\.source_id/,
  );
  assert.match(
    capturedSql,
    /listing_draw_result\.prize_product_id=invalid_listing_inventory\.product_id/,
  );
});
