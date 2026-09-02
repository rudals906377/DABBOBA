import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../types.js";
import {
  isDrawExchangeSource,
  isExchangeEligibleInventory,
  isExchangeListingTransitionAllowed,
  isExchangeOfferTransitionAllowed,
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
  assert.match(capturedSql, /p\.is_active=true/);
  assert.match(capturedSql, /i\.is_active=true/);
  assert.match(capturedSql, /iu\.source_type='GACHA'/);
  assert.match(capturedSql, /p\.name ILIKE \$2/);
  assert.match(capturedSql, /i\.name_ko ILIKE \$2/);
  assert.match(capturedSql, /i\.name_en ILIKE \$2/);
  assert.match(capturedSql, /array_to_string\(i\.aliases, ' '\) ILIKE \$2/);
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

  assert.match(capturedSql, /iu\.source_type='GACHA'/);
  assert.match(capturedSql, /draw_result\.user_id=l\.author_id/);
});
