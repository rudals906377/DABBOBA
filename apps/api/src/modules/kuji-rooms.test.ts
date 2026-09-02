import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KUJI_CHECKOUT_LEASE_SECONDS,
  kujiCheckoutExpiry,
  maskKujiDisplayName,
} from "./kuji-rooms.js";

test("kuji checkout grants one exact 180 second server lease", () => {
  const grantedAt = new Date("2026-09-01T03:00:00.000Z");
  assert.equal(KUJI_CHECKOUT_LEASE_SECONDS, 180);
  assert.equal(kujiCheckoutExpiry(grantedAt).toISOString(), "2026-09-01T03:03:00.000Z");
});

test("kuji room participant names are masked without randomness", () => {
  assert.equal(maskKujiDisplayName("럭키덕후"), "럭**후");
  assert.equal(maskKujiDisplayName("민수"), "민*");
  assert.equal(maskKujiDisplayName("A"), "A*");
});

test("kuji room migration enforces active occupancy, active user uniqueness, FIFO, and terminal history", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0022_kuji_room_entries.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /CHECKOUT_PENDING','DRAWING/);
  assert.match(sql, /UNIQUE INDEX kuji_room_entries_product_occupancy_idx/);
  assert.match(sql, /UNIQUE INDEX kuji_room_entries_user_active_idx/);
  assert.match(sql, /queue_sequence bigint GENERATED ALWAYS AS IDENTITY/);
  assert.match(sql, /checkout_expires_at = checkout_started_at \+ interval '3 minutes'/);
  assert.match(sql, /Terminal kuji room entries are immutable/);
});

test("customer leave never releases a room after drawing has started", async () => {
  const source = await readFile(new URL("../../src/modules/kuji-rooms.ts", import.meta.url), "utf8");
  assert.match(source, /roomEntry\.state === "DRAWING"/);
  assert.match(source, /state IN \('WAITING','CHECKOUT_PENDING'\)/);
  assert.doesNotMatch(source, /SET state='CANCELLED'[\s\S]{0,160}state IN \('WAITING','CHECKOUT_PENDING','DRAWING'\)/);
});

test("new room occupancy requires stock and an active drawable pool", async () => {
  const source = await readFile(new URL("../../src/modules/kuji-rooms.ts", import.meta.url), "utf8");
  assert.match(source, /s\.on_hand-s\.reserved>0/);
  assert.match(source, /v\.status='ACTIVE'/);
  assert.match(source, /e\.remaining_quantity IS NULL OR e\.remaining_quantity>0/);
  assert.match(source, /if \(!joinable\) \{/);
  assert.match(source, /"unavailable" in result/);
});

test("linked room leave releases the pending order benefits and stock atomically", async () => {
  const source = await readFile(new URL("../../src/modules/kuji-rooms.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT id,status FROM payments WHERE order_id=\$1 FOR UPDATE/);
  assert.match(source, /SELECT id,user_id,status,point_total FROM orders WHERE id=\$1 FOR UPDATE/);
  assert.match(source, /releasePendingOrder\(client, order\.rows\[0\]!/);
  assert.match(source, /UPDATE payments SET status='CANCELLED'/);
  assert.match(source, /UPDATE orders SET status='CANCELLED'/);
});

test("checkout lease expiry releases linked assets before FIFO promotion while drawing expiry preserves tickets", async () => {
  const source = await readFile(new URL("../../src/modules/kuji-rooms.ts", import.meta.url), "utf8");
  const expiryStart = source.indexOf("export async function expireAndPromoteKujiRoomLocked");
  const paymentLock = source.indexOf("SELECT id,status FROM payments WHERE order_id=$1 FOR UPDATE", expiryStart);
  const orderLock = source.indexOf("SELECT id,user_id,status,point_total,cancelled_at FROM orders", paymentLock);
  const release = source.indexOf("releasePendingOrder(client, orderRow", orderLock);
  const terminalRoom = source.indexOf("SET state='EXPIRED',resolved_at=$2", release);
  const promote = source.indexOf("promoteNextKujiRoomEntryLocked", terminalRoom);
  assert.ok(
    expiryStart >= 0
      && expiryStart < paymentLock
      && paymentLock < orderLock
      && orderLock < release
      && release < terminalRoom
      && terminalRoom < promote,
  );
  assert.match(source, /eventType: "kuji\.drawing_lease_expired"/);
  assert.match(source, /entitlementsRemainConsumable: true/);
});
