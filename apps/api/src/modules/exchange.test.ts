import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import {
  createThrottledExchangeExpirySweep,
  EXCHANGE_READ_EXPIRY_SWEEP_INTERVAL_MS,
  exchangeInventoryBundleInput,
  expireStaleExchangeListings,
  isDrawExchangeSource,
  isExchangeEligibleInventory,
  isExchangeListingTransitionAllowed,
  isExchangeOfferTransitionAllowed,
  isOriginalGachaDrawProvenance,
  orderedInventoryIds,
  registerExchangeRoutes,
} from "./exchange.js";

test("stale open exchanges close atomically and release both sides", async () => {
  const statements: string[] = [];
  const queryable = {
    async query(sql: string) {
      statements.push(sql);
      return { rowCount: 2, rows: [{ id: "one" }, { id: "two" }] };
    },
  } as unknown as Parameters<typeof expireStaleExchangeListings>[0];
  const expired = await expireStaleExchangeListings(queryable);

  assert.equal(expired, 2);
  assert.equal(statements.length, 2);
  const capturedSql = statements[0]!;
  // A second statement, with a fresh snapshot, frees offers left pending on
  // any closed listing, including one committed while the first waited.
  assert.match(statements[1]!, /offer\.status='PENDING'[\s\S]*listing\.status IN \('CANCELLED','COMPLETED','HIDDEN'\)/);
  assert.match(statements[1]!, /inventory\.status='EXCHANGE_OFFERED'/);
  assert.match(capturedSql, /listing\.status='OPEN'[\s\S]*listing\.expires_at<=now\(\)/);
  assert.match(capturedSql, /inventory\.storage_expires_at<=now\(\)/);
  assert.match(capturedSql, /cancel_reason='AUTO_EXPIRED'/);
  assert.match(capturedSql, /status='REJECTED'/);
  assert.match(capturedSql, /status='EXCHANGE_LISTED'/);
  assert.match(capturedSql, /status='EXCHANGE_OFFERED'/);
});

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
  assert.equal(isExchangeEligibleInventory("OWNED", "GACHA", true, true), true);
  assert.equal(isExchangeEligibleInventory("OWNED", "GACHA", true, false), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "KUJI", true, true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "GACHA", false, true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "KUJI", false, true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "PURCHASE", true, true), false);
  assert.equal(isExchangeEligibleInventory("OWNED", "ADMIN_ADJUSTMENT", true, true), false);

  for (const status of [
    "EXCHANGE_LISTED",
    "EXCHANGE_OFFERED",
    "SHIPPING",
    "DELIVERED",
    "TRANSFERRED",
    "REFUNDED",
  ] as const) {
    assert.equal(isExchangeEligibleInventory(status, "GACHA", true, true), false);
    assert.equal(isExchangeEligibleInventory(status, "KUJI", true, true), false);
  }
});

test("exchange mutations recheck listing and storage expiry at locked write boundaries", async () => {
  const source = await readFile(new URL("../../src/modules/exchange.ts", import.meta.url), "utf8");

  assert.match(source, /iu\.storage_expires_at>now\(\) AS storage_active/);
  assert.match(
    source,
    /WHERE iu\.id=ANY\(\$1::uuid\[\]\) AND iu\.owner_id=\$2 AND iu\.status='OWNED'\s+AND iu\.storage_expires_at>now\(\)/,
  );
  assert.match(source, /expires_at,expires_at<=now\(\) AS is_expired[\s\S]{0,160}FOR UPDATE/);
  assert.match(
    source,
    /INSERT INTO exchange_offers[\s\S]{0,400}listing\.expires_at>now\(\)/,
  );
  assert.match(
    source,
    /UPDATE exchange_listings[\s\S]{0,220}WHERE id=\$1 AND status='OPEN' AND expires_at>now\(\) RETURNING id/,
  );
  assert.match(
    source,
    /requireActiveStorageBundle\(locked, listing\.offered_inventory_unit_ids\);[\s\S]{0,900}requireActiveStorageBundle\(locked, offer\.offered_inventory_unit_ids\);/,
  );
  const decisionRoute = source.indexOf('"/v1/exchange/listings/:listingId/offers/:offerId/decision"');
  const decisionSweep = source.indexOf("await expireStaleExchangeListings(context.pool);", decisionRoute);
  const decisionMutation = source.indexOf("runIdempotentMutation(", decisionRoute);
  assert.ok(decisionRoute >= 0 && decisionRoute < decisionSweep && decisionSweep < decisionMutation);
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
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const acquiredAt = new Date("2026-09-13T03:00:00.000Z");
  const storefrontImageUrl = "https://cdn.example.test/gacha-prize-storefront.webp";
  const context = {
    pool: {
      async query(sql: string, values: unknown[]) {
        capturedSql = sql;
        capturedValues = values;
        if (sql.includes("FROM inventory_units iu")) {
          return {
            rowCount: 1,
            rows: [{
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              owner_id: userId,
              product_id: "gacha-prize",
              source_type: "GACHA",
              inventory_status: "OWNED",
              acquired_at: acquiredAt,
              sku: "GACHA-PRIZE-001",
              ip_id: "test-ip",
              character_ids: [],
              category: "figure",
              product_name: "가챠 경품",
              manufacturer: null,
              release_date: null,
              price: "0",
              available_quantity: "0",
              metadata: {},
              image_url: "https://cdn.example.test/gacha-prize.webp",
              storefront_image_url: storefrontImageUrl,
              product_active: true,
              is_prize_only: true,
              product_version: 2,
              product_created_at: acquiredAt,
              product_updated_at: acquiredAt,
              created_at: acquiredAt,
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    },
    auth: authStub,
  } as unknown as ApiContext;

  await registerExchangeRoutes(app, context);
  const handler = routes.get("GET /v1/exchange/inventory");
  assert.ok(handler);
  const body = await handler({ query: {}, actor: { userId } }) as {
    items: Array<{ product: { storefrontImageUrl: string | null } }>;
  };

  assert.match(capturedSql, /iu\.source_type='GACHA'/);
  assert.doesNotMatch(capturedSql, /'KUJI'/);
  assert.match(capturedSql, /draw_result\.user_id=iu\.owner_id/);
  assert.match(capturedSql, /draw_result\.entitlement_id=iu\.source_id/);
  assert.match(capturedSql, /draw_result\.prize_product_id=iu\.product_id/);
  assert.match(capturedSql, /iu\.storage_expires_at>now\(\)/);
  assert.match(capturedSql, /p\.storefront_image_url/);
  assert.equal(body.items[0]?.product.storefrontImageUrl, storefrontImageUrl);
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
  assert.match(capturedSql, /visibility_block\.blocker_id=\$1/);
  assert.match(capturedSql, /search_product\.name ILIKE \$3/);
  assert.match(capturedSql, /search_ip\.name_ko ILIKE \$3/);
  assert.match(capturedSql, /search_ip\.name_en ILIKE \$3/);
  assert.match(capturedSql, /array_to_string\(search_ip\.aliases, ' '\) ILIKE \$3/);
  assert.deepEqual(capturedValues, [null, 31, "%포켓몬스터%"]);
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

test("public exchange reads share one expiry sweep per 30 seconds per process", async () => {
  let sweeps = 0;
  let release: (() => void) | null = null;
  const queryable = {
    async query(sql: string) {
      // Each sweep runs the expiry statement and then the stranded-offer cleanup.
      if (!/cancel_reason='AUTO_EXPIRED'/.test(sql)) return { rowCount: 0, rows: [] };
      sweeps += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return { rowCount: 0, rows: [] };
    },
  };
  let now = 1_000_000;
  const sweep = createThrottledExchangeExpirySweep(queryable as never, EXCHANGE_READ_EXPIRY_SWEEP_INTERVAL_MS, () => now);
  assert.equal(EXCHANGE_READ_EXPIRY_SWEEP_INTERVAL_MS, 30_000);

  const concurrent = [sweep(), sweep(), sweep()];
  await new Promise((resolve) => setImmediate(resolve));
  release!();
  await Promise.all(concurrent);
  assert.equal(sweeps, 1);

  now += 29_999;
  await sweep();
  assert.equal(sweeps, 1);

  now += 1;
  const next = sweep();
  await new Promise((resolve) => setImmediate(resolve));
  release!();
  await next;
  assert.equal(sweeps, 2);
});

test("a failed throttled sweep is retried on the next read", async () => {
  let calls = 0;
  const queryable = {
    async query(sql: string) {
      if (!/cancel_reason='AUTO_EXPIRED'/.test(sql)) return { rowCount: 0, rows: [] };
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { rowCount: 0, rows: [] };
    },
  };
  const sweep = createThrottledExchangeExpirySweep(queryable as never, 30_000, () => 5_000);
  await assert.rejects(sweep(), /transient/);
  await sweep();
  assert.equal(calls, 2);
});

test("browse hides lapsed OPEN listings between sweeps and admin resolution is commerce-gated", async () => {
  const source = await readFile(new URL("../../src/modules/exchange.ts", import.meta.url), "utf8");
  assert.match(source, /"l\.status='OPEN'",\s*"l\.expires_at>now\(\)"/);
  assert.match(
    source,
    /"\/v1\/admin\/exchange\/listings\/:listingId\/resolution",\s*\{ preHandler: \[requireLiveCommerce\(context\), context\.auth\.requirePermission\("exchange\.resolve"\)\] \}/,
  );
});

test("exchange listing creation rejects objectionable text or contact details before any database work", async () => {
  const { app, routes } = routeHarness();
  let databaseCalls = 0;
  const context = {
    pool: {
      async connect() { databaseCalls += 1; throw new Error("database must not be reached"); },
      async query() { databaseCalls += 1; throw new Error("database must not be reached"); },
    },
    config: { environment: "test" },
    auth: authStub,
  } as unknown as ApiContext;
  await registerExchangeRoutes(app, context);
  const handler = routes.get("POST /v1/exchange/listings");
  assert.ok(handler);

  for (const text of [
    { title: "씨발 급처", details: "교환해요" },
    { title: "귀멸의 칼날 가챠 교환", details: "010-1234-5678로 연락 주세요" },
    { title: "오픈채팅으로 교환", details: "교환해요" },
    { title: "교환해요", details: "https://example.com/item 참고" },
  ]) {
    await assert.rejects(
      handler({
        actor: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        headers: { "idempotency-key": "exchange-content-filter-0001" },
        body: { ...text, offeredInventoryUnitIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] },
        id: "exchange-content-filter",
      }),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 400
        && error.code === "CONTENT_NOT_ALLOWED",
    );
  }
  assert.equal(databaseCalls, 0);
});
