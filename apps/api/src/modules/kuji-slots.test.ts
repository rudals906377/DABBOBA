import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient, DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { ApiContext } from "../types.js";
import {
  parseKujiSlotSelection,
  persistKujiSlotBindings,
  registerKujiSlotRoutes,
} from "./kuji-slots.js";
import {
  assignSealedKujiSlots,
  projectPublicKujiSlotAvailability,
} from "../lib/kuji-slot-assignment.js";

type RouteHandler = (
  request: Record<string, unknown>,
  reply: Record<string, unknown>,
) => Promise<unknown>;

function routeCapture() {
  const routes = new Map<string, RouteHandler>();
  const register = (method: "GET" | "POST") => (...args: unknown[]) => {
    const path = args[0];
    const handler = args.at(-1);
    if (typeof path !== "string" || typeof handler !== "function") {
      throw new Error("Invalid test route registration.");
    }
    routes.set(`${method} ${path}`, handler as RouteHandler);
  };
  return {
    app: { get: register("GET"), post: register("POST") } as unknown as FastifyInstance,
    routes,
  };
}

function testContext(pool: unknown): ApiContext {
  return {
    pool,
    auth: {
      requireUser: async () => undefined,
    },
  } as unknown as ApiContext;
}

function replyCapture() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const reply = {
    code(value: number) { statusCode = value; return this; },
    header(name: string, value: string) { headers.set(name, value); return this; },
    send(value?: unknown) { body = value; return value; },
  };
  return { reply, result: () => ({ statusCode, body, headers }) };
}

test("sealed kuji publish uses one exact Fisher-Yates assignment without exposing its mapping", () => {
  const randomValues = [0, 1, 0];
  const assignments = assignSealedKujiSlots(4, [
    { poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 },
    { poolEntryId: "pool-b", tierCode: "B", tierRank: 1, quantity: 3 },
  ], (maxExclusive) => {
    const value = randomValues.shift();
    assert.notEqual(value, undefined);
    assert.ok(value! >= 0 && value! < maxExclusive);
    return value!;
  });

  assert.deepEqual(assignments.map(({ slotNumber }) => slotNumber), [1, 2, 3, 4]);
  assert.equal(assignments.filter(({ tierCode }) => tierCode === "A").length, 1);
  assert.equal(assignments.filter(({ tierCode }) => tierCode === "B").length, 3);
  assert.deepEqual(projectPublicKujiSlotAvailability(assignments, new Set([2])), [
    { slotNumber: 1, available: true },
    { slotNumber: 2, available: false },
    { slotNumber: 3, available: true },
    { slotNumber: 4, available: true },
  ]);
  assert.deepEqual(Object.keys(projectPublicKujiSlotAvailability(assignments)[0]!).sort(), [
    "available",
    "slotNumber",
  ]);
});

test("sealed kuji tier input rejects invalid totals, duplicate ranks, and unsafe tier codes", () => {
  assert.throws(
    () => assignSealedKujiSlots(2, [
      { poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 },
    ]),
    /sum exactly/i,
  );
  assert.throws(
    () => assignSealedKujiSlots(2, [
      { poolEntryId: "pool-a", tierCode: "A", tierRank: 0, quantity: 1 },
      { poolEntryId: "pool-b", tierCode: "B", tierRank: 0, quantity: 1 },
    ]),
    /Duplicate sealed kuji tierRank/,
  );
  assert.throws(
    () => assignSealedKujiSlots(1, [
      { poolEntryId: "pool-a", tierCode: "A prize", tierRank: 0, quantity: 1 },
    ]),
    /letters, digits, underscores, or hyphens/,
  );
});

test("slot selection is unique, bounded, and normalized to ascending order", () => {
  assert.deepEqual(parseKujiSlotSelection({ probabilityVersion: 7, slotNumbers: [9, 2, 5] }), {
    probabilityVersion: 7,
    slotNumbers: [2, 5, 9],
  });
  assert.throws(
    () => parseKujiSlotSelection({ probabilityVersion: 7, slotNumbers: [2, 2] }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => parseKujiSlotSelection({ probabilityVersion: 7, slotNumbers: [0] }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test("public deck uses one MVCC statement and exposes no assignment id or hidden mapping", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      return {
        rowCount: 1,
        rows: [{
          probability_version_id: "11111111-1111-4111-8111-111111111111",
          version: 7,
          total_slots: 3,
          published_at: new Date("2026-09-05T00:00:00.000Z"),
          snapshot_version: 12,
          reserved_slot_count: 1,
          slots: [
            { slotNumber: 1, available: true },
            { slotNumber: 2, available: false },
            { slotNumber: 3, available: true },
          ],
          tiers: [
            { tierCode: "A", tierRank: 0, label: "A상", initialQuantity: 1, remainingQuantity: 1 },
            { tierCode: "B", tierRank: 1, label: "B상", initialQuantity: 2, remainingQuantity: 2 },
          ],
        }],
      };
    },
  };
  const { app, routes } = routeCapture();
  await registerKujiSlotRoutes(app, testContext(pool));
  const handler = routes.get("GET /v1/catalog/products/:productId/kuji-slots");
  assert.ok(handler);
  const capture = replyCapture();
  await handler({ params: { productId: "sealed-kuji" } }, capture.reply);
  const response = capture.result();

  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /AS slots,[\s\S]*AS tiers/);
  assert.match(queries[0]!, /binding\.state IN \('RESERVED','CONSUMED'\)/);
  assert.match(queries[0]!, /binding\.state='CONSUMED'/);
  assert.doesNotMatch(queries[0]!, /'id',assignment\.id/);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = response.body as {
    snapshotVersion: number;
    slots: Array<Record<string, unknown>>;
    tiers: Array<{ remainingQuantity: number }>;
  };
  assert.equal(body.snapshotVersion, 12);
  assert.deepEqual(Object.keys(body.slots[0]!).sort(), ["available", "slotNumber"]);
  assert.doesNotMatch(JSON.stringify(body.slots), /id|tier|prize|pool|seed/i);
  assert.equal(body.slots.filter(({ available }) => available).length, 2);
  assert.equal(body.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0), 3);
});

test("public deck fails closed if available slots and aggregate tier counts diverge", async () => {
  const { app, routes } = routeCapture();
  await registerKujiSlotRoutes(app, testContext({
    async query() {
      return {
        rowCount: 1,
        rows: [{
          probability_version_id: "11111111-1111-4111-8111-111111111111",
          version: 7,
          total_slots: 1,
          published_at: new Date("2026-09-05T00:00:00.000Z"),
          snapshot_version: 1,
          reserved_slot_count: 0,
          slots: [{ slotNumber: 1, available: true }],
          tiers: [{ tierCode: "A", tierRank: 0, label: "A상", initialQuantity: 1, remainingQuantity: 0 }],
        }],
      };
    },
  }));
  const handler = routes.get("GET /v1/catalog/products/:productId/kuji-slots");
  assert.ok(handler);
  await assert.rejects(
    handler({ params: { productId: "sealed-kuji" } }, replyCapture().reply),
    /snapshot count mismatch/,
  );
});

test("a concurrent unique-slot loss becomes a domain conflict and rolls back earlier bindings", async () => {
  const events: string[] = [];
  let insertAttempt = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        events.push(sql);
        return { rowCount: null, rows: [] };
      }
      assert.match(sql, /ON CONFLICT DO NOTHING[\s\S]*RETURNING/);
      insertAttempt += 1;
      events.push(`insert:${String(params[0])}:${String(params[1])}`);
      if (insertAttempt === 2) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          binding_id: "binding-1",
          entitlement_id: params[1],
          binding_state: "RESERVED",
          slot_id: params[0],
          slot_number: params[3],
        }],
      };
    },
    release() { events.push("release"); },
  };
  const pool = { async connect() { return client; } } as unknown as DatabasePool;

  await assert.rejects(
    withTransaction(pool, (transaction) => persistKujiSlotBindings(transaction, {
      roomEntryId: "room-1",
      entitlementIds: ["entitlement-older", "entitlement-newer"],
      assignments: [
        { id: "slot-2", slot_number: 2 },
        { id: "slot-9", slot_number: 9 },
      ],
    })),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && error.code === "CONFLICT",
  );
  assert.deepEqual(events, [
    "BEGIN",
    "insert:slot-2:entitlement-older",
    "insert:slot-9:entitlement-newer",
    "ROLLBACK",
    "release",
  ]);
});

test("binding persistence pairs ordered entitlements with ascending slots deterministically", async () => {
  const pairs: Array<[string, string, number]> = [];
  const client = {
    async query(_sql: string, params: unknown[]) {
      pairs.push([String(params[1]), String(params[0]), Number(params[3])]);
      return {
        rowCount: 1,
        rows: [{
          binding_id: `binding-${String(params[3])}`,
          entitlement_id: params[1],
          binding_state: "RESERVED",
          slot_id: params[0],
          slot_number: params[3],
        }],
      };
    },
  } as unknown as DatabaseClient;

  const saved = await persistKujiSlotBindings(client, {
    roomEntryId: "room-1",
    entitlementIds: ["entitlement-older", "entitlement-newer"],
    assignments: [
      { id: "slot-2", slot_number: 2 },
      { id: "slot-9", slot_number: 9 },
    ],
  });
  assert.deepEqual(pairs, [
    ["entitlement-older", "slot-2", 2],
    ["entitlement-newer", "slot-9", 9],
  ]);
  assert.deepEqual(saved.map(({ entitlement_id, slot_number }) => [entitlement_id, slot_number]), [
    ["entitlement-older", 2],
    ["entitlement-newer", 9],
  ]);
});
