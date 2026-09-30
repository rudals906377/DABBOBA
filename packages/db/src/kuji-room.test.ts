import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "./index.js";
import {
  completeLockedKujiOrderRoomIfDrawn,
  lockKujiProductRoomAdvisory,
  releaseRefundedKujiOrderRoom,
} from "./kuji-room.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "sealed-kuji";
const SERVER_NOW = new Date("2026-09-05T00:00:00.000Z");

test("the publish and room flows share one product-scoped advisory key", async () => {
  const observed: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      observed.push({ sql, values });
      return { rowCount: 1, rows: [{}] };
    },
  } as unknown as DatabaseClient;

  await lockKujiProductRoomAdvisory(client, PRODUCT_ID);

  assert.match(observed[0]!.sql, /pg_advisory_xact_lock\(hashtextextended/);
  assert.deepEqual(observed[0]!.values, [`kuji-room:${PRODUCT_ID}`]);
});

test("a verified full refund releases a paid kuji room and advances the queue", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes("UPDATE kuji_room_entries") && sql.includes("state IN ('CHECKOUT_PENDING','DRAWING')")) {
        return { rowCount: 1, rows: [{ product_id: PRODUCT_ID }] };
      }
      if (sql.includes("SELECT 1 FROM kuji_room_entries") && sql.includes("state IN ('CHECKOUT_PENDING','DRAWING')")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("FROM catalog_products p") && sql.includes("FOR UPDATE OF s")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("UPDATE kuji_rooms SET version=version+1")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as DatabaseClient;

  const released = await releaseRefundedKujiOrderRoom(client, { orderId: ORDER_ID, serverNow: SERVER_NOW });
  assert.equal(released, true);
  assert.match(queries[0]!.sql, /state='CANCELLED'/);
  assert.equal(queries.filter(({ sql }) => sql.includes("UPDATE kuji_rooms SET version=version+1")).length, 1);
});

function roomClient(input: {
  remainingEntitlements: number;
  completedProductId: string | null;
}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT count(*) AS count") && sql.includes("FROM draw_entitlements")) {
        return { rowCount: 1, rows: [{ count: String(input.remainingEntitlements) }] };
      }
      if (sql.includes("UPDATE kuji_room_entries") && sql.includes("SET state='COMPLETED'")) {
        return input.completedProductId
          ? { rowCount: 1, rows: [{ product_id: input.completedProductId }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes("SELECT 1 FROM kuji_room_entries") && sql.includes("state IN ('CHECKOUT_PENDING','DRAWING')")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("FROM catalog_products p") && sql.includes("FOR UPDATE OF s")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("UPDATE kuji_rooms SET version=version+1")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as DatabaseClient;
  return { client, queries };
}

test("an intermediate paid kuji consume advances the public room snapshot exactly once", async () => {
  const { client, queries } = roomClient({ remainingEntitlements: 1, completedProductId: null });

  const completed = await completeLockedKujiOrderRoomIfDrawn(client, {
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    serverNow: SERVER_NOW,
  });

  assert.equal(completed, false);
  const versionBumps = queries.filter(({ sql }) => sql.includes("UPDATE kuji_rooms SET version=version+1"));
  assert.equal(versionBumps.length, 1);
  assert.deepEqual(versionBumps[0]?.values, [PRODUCT_ID]);
});

test("a consume after the drawing lease expired still advances the public snapshot", async () => {
  const { client, queries } = roomClient({ remainingEntitlements: 0, completedProductId: null });

  const completed = await completeLockedKujiOrderRoomIfDrawn(client, {
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    serverNow: SERVER_NOW,
  });

  assert.equal(completed, false);
  assert.equal(
    queries.filter(({ sql }) => sql.includes("UPDATE kuji_rooms SET version=version+1")).length,
    1,
  );
});

test("the final active-room consume completes the room without double-incrementing its snapshot", async () => {
  const { client, queries } = roomClient({
    remainingEntitlements: 0,
    completedProductId: PRODUCT_ID,
  });

  const completed = await completeLockedKujiOrderRoomIfDrawn(client, {
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    serverNow: SERVER_NOW,
  });

  assert.equal(completed, true);
  assert.equal(
    queries.filter(({ sql }) => sql.includes("UPDATE kuji_rooms SET version=version+1")).length,
    1,
  );
});
