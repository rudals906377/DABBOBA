import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  WORKER_DATABASE_ROLE,
} from "@dabboba/db";
import type { Logger } from "./logger.js";
import { expireOrderReservations, expireReservationBatch } from "./reservations.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const workerDatabaseUrl = process.env.DABBOBA_WORKER_TEST_DATABASE_URL;

test(
  "reservation expiry releases a linked kuji room and promotes the FIFO waiter",
  { skip: !migrationDatabaseUrl || !workerDatabaseUrl, timeout: 30_000 },
  async (t) => {
    const fixturePool = createMigrationDatabasePool(
      migrationDatabaseUrl!,
      "dabboba-worker-kuji-fixture-integration",
    );
    const workerPool = createDatabasePool(
      workerDatabaseUrl!,
      "dabboba-worker-kuji-integration",
      { expectedRole: WORKER_DATABASE_ROLE },
    );
    t.after(async () => Promise.all([fixturePool.end(), workerPool.end()]));

    const identity = await workerPool.query<{ current_user: string }>("SELECT current_user");
    assert.equal(identity.rows[0]?.current_user, WORKER_DATABASE_ROLE);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `worker-kuji-${suffix}`;
    const productId = `worker-kuji-product-${suffix}`;
    const prizeProductId = `worker-kuji-prize-${suffix}`;
    const publisher = await fixturePool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-publisher-${suffix}@example.test`, `퍼블리셔${suffix}`],
    );
    const buyer = await fixturePool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-buyer-${suffix}@example.test`, `구매자${suffix}`],
    );
    const waiter = await fixturePool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-waiter-${suffix}@example.test`, `대기자${suffix}`],
    );
    await fixturePool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `워커 쿠지 ${suffix}`, `Worker kuji ${suffix}`],
    );
    await fixturePool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES($1,$2,$3,'kuji',$4,1000,false),($5,$6,$3,'figure',$7,0,true)`,
      [
        productId,
        `WORKER-KUJI-${suffix.toUpperCase()}`,
        ipId,
        `워커 쿠지 ${suffix}`,
        prizeProductId,
        `WORKER-PRIZE-${suffix.toUpperCase()}`,
        `워커 경품 ${suffix}`,
      ],
    );
    await fixturePool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,5,1)", [productId]);
    const version = await fixturePool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
      [productId],
    );
    const poolEntry = await fixturePool.query<{ id: string }>(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
         initial_quantity,remaining_quantity
       ) SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,5,5
           FROM catalog_products p WHERE p.id=$2
       RETURNING id`,
      [version.rows[0]!.id, prizeProductId],
    );
    await fixturePool.query(
      "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,5)",
      [version.rows[0]!.id],
    );
    await fixturePool.query(
      "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
      [version.rows[0]!.id, poolEntry.rows[0]!.id],
    );
    await fixturePool.query(
      `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
       SELECT $1,slot_number,$2 FROM generate_series(1,5) AS slot_number`,
      [version.rows[0]!.id, poolEntry.rows[0]!.id],
    );
    await fixturePool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [version.rows[0]!.id, publisher.rows[0]!.id],
    );
    await fixturePool.query("INSERT INTO kuji_rooms(product_id) VALUES($1)", [productId]);
    const order = await fixturePool.query<{ id: string }>(
      "INSERT INTO orders(user_id,subtotal,total) VALUES($1,1000,1000) RETURNING id",
      [buyer.rows[0]!.id],
    );
    const line = await fixturePool.query<{ id: string }>(
      `INSERT INTO order_lines(
         order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
         unit_price,quantity,line_total
       ) VALUES($1,$2,$3,'kuji',$4,1000,1,1000) RETURNING id`,
      [order.rows[0]!.id, productId, `워커 쿠지 ${suffix}`, version.rows[0]!.id],
    );
    await fixturePool.query(
      "INSERT INTO payments(order_id,provider,amount) VALUES($1,'TEST_PG',1000)",
      [order.rows[0]!.id],
    );
    const expiredAt = new Date(Date.now() - 1_000);
    await fixturePool.query(
      `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
       VALUES($1,$2,$3,1,$4)`,
      [order.rows[0]!.id, line.rows[0]!.id, productId, expiredAt],
    );
    const active = await fixturePool.query<{ id: string }>(
      `INSERT INTO kuji_room_entries(
         product_id,user_id,order_id,state,checkout_started_at,checkout_expires_at
       ) VALUES($1,$2,$3,'CHECKOUT_PENDING',$4::timestamptz-$5::interval,$4::timestamptz)
       RETURNING id`,
      [productId, buyer.rows[0]!.id, order.rows[0]!.id, expiredAt, "3 minutes"],
    );
    const waiting = await fixturePool.query<{ id: string }>(
      "INSERT INTO kuji_room_entries(product_id,user_id,state) VALUES($1,$2,'WAITING') RETURNING id",
      [productId, waiter.rows[0]!.id],
    );

    const now = new Date();
    const outcome = await expireOrderReservations(workerPool, order.rows[0]!.id, now);
    assert.deepEqual(outcome, { status: "expired", released: 1 });
    const state = await fixturePool.query<{
      order_status: string;
      payment_status: string;
      reservation_status: string;
      reserved: number;
      room_state: string;
      waiter_state: string;
      waiter_started_at: Date;
      waiter_expires_at: Date;
    }>(
      `SELECT o.status AS order_status,p.status AS payment_status,r.status AS reservation_status,
              s.reserved,e.state AS room_state,w.state AS waiter_state,
              w.checkout_started_at AS waiter_started_at,w.checkout_expires_at AS waiter_expires_at
         FROM orders o
         JOIN payments p ON p.order_id=o.id
         JOIN stock_reservations r ON r.order_id=o.id
         JOIN product_stock s ON s.product_id=r.product_id
         JOIN kuji_room_entries e ON e.id=$2
         JOIN kuji_room_entries w ON w.id=$3
        WHERE o.id=$1`,
      [order.rows[0]!.id, active.rows[0]!.id, waiting.rows[0]!.id],
    );
    assert.deepEqual({
      orderStatus: state.rows[0]!.order_status,
      paymentStatus: state.rows[0]!.payment_status,
      reservationStatus: state.rows[0]!.reservation_status,
      reserved: state.rows[0]!.reserved,
      roomState: state.rows[0]!.room_state,
      waiterState: state.rows[0]!.waiter_state,
    }, {
      orderStatus: "CANCELLED",
      paymentStatus: "CANCELLED",
      reservationStatus: "EXPIRED",
      reserved: 0,
      roomState: "EXPIRED",
      waiterState: "CHECKOUT_PENDING",
    });
    assert.equal(
      state.rows[0]!.waiter_expires_at.getTime() - state.rows[0]!.waiter_started_at.getTime(),
      180_000,
    );
  },
);

test("reservation sweep prioritizes releasable stock and records reconciliation once", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-reservation-fairness-fixture-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-reservation-fairness-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = randomUUID();
  const orderIds = [randomUUID(), randomUUID()].sort();
  const reconciliationOrderId = orderIds[0]!;
  const releasableOrderId = orderIds[1]!;
  const paymentIds = [randomUUID(), randomUUID()];
  const productId = `worker-fair-product-${suffix}`;
  const ipId = `worker-fair-ip-${suffix}`;
  const lineIds = [randomUUID(), randomUUID()];
  t.after(async () => {
    await fixturePool.query(
      "DELETE FROM outbox_events WHERE correlation_id=ANY($1::text[])",
      [orderIds.map((id) => `worker-reservation-reconciliation-${id}`)],
    ).catch(() => undefined);
    await fixturePool.query("DELETE FROM stock_reservations WHERE order_id=ANY($1::uuid[])", [orderIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM payments WHERE id=ANY($1::uuid[])", [paymentIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM order_lines WHERE id=ANY($1::uuid[])", [lineIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orderIds]).catch(() => undefined);
    await fixturePool.query("DELETE FROM product_stock WHERE product_id=$1", [productId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM catalog_products WHERE id=$1", [productId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM catalog_ips WHERE id=$1", [ipId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerPool.end()]);
  });

  const identity = await workerPool.query<{ current_user: string }>("SELECT current_user");
  assert.equal(identity.rows[0]?.current_user, WORKER_DATABASE_ROLE);
  await fixturePool.query(
    "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
    [userId, `worker-reservation-fair-${suffix}@example.test`, `예약공정${suffix}`],
  );
  await fixturePool.query(
    "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
    [ipId, ipId, `예약 공정 ${suffix}`, `Reservation fairness ${suffix}`],
  );
  await fixturePool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price)
     VALUES($1,$2,$3,'figure',$4,1000)`,
    [productId, `WORKER-FAIR-${suffix.toUpperCase()}`, ipId, `예약 공정 상품 ${suffix}`],
  );
  await fixturePool.query(
    "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,5,2)",
    [productId],
  );

  for (let index = 0; index < orderIds.length; index += 1) {
    const orderId = orderIds[index]!;
    await fixturePool.query(
      "INSERT INTO orders(id,user_id,subtotal,total) VALUES($1,$2,1000,1000)",
      [orderId, userId],
    );
    await fixturePool.query(
      `INSERT INTO order_lines(
         id,order_id,product_id,product_name_snapshot,category_snapshot,unit_price,quantity,line_total
       ) VALUES($1,$2,$3,$4,'figure',1000,1,1000)`,
      [lineIds[index], orderId, productId, `예약 공정 상품 ${suffix}`],
    );
    await fixturePool.query(
      `INSERT INTO payments(id,order_id,provider,status,amount)
       VALUES($1,$2,'TEST_PG',$3,1000)`,
      [paymentIds[index], orderId, orderId === reconciliationOrderId ? "AUTHORIZED" : "PENDING"],
    );
    await fixturePool.query(
      `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
       VALUES($1,$2,$3,1,$4)`,
      [orderId, lineIds[index], productId, new Date("2000-01-01T00:00:00.000Z")],
    );
  }

  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const now = new Date("2001-01-01T00:00:00.000Z");
  const first = await expireReservationBatch(workerPool, 1, logger, now);
  assert.deepEqual(first, { examined: 1, expired: 1, released: 1, reconciliation: 0 });
  const afterRelease = await fixturePool.query<{ order_id: string; status: string }>(
    "SELECT order_id,status FROM stock_reservations WHERE order_id=ANY($1::uuid[]) ORDER BY order_id",
    [orderIds],
  );
  assert.deepEqual(afterRelease.rows, [
    { order_id: reconciliationOrderId, status: "ACTIVE" },
    { order_id: releasableOrderId, status: "EXPIRED" },
  ]);

  const second = await expireReservationBatch(workerPool, 1, logger, now);
  assert.deepEqual(second, { examined: 1, expired: 0, released: 0, reconciliation: 1 });
  const third = await expireReservationBatch(workerPool, 1, logger, now);
  assert.deepEqual(third, { examined: 0, expired: 0, released: 0, reconciliation: 0 });
  const alerts = await fixturePool.query<{ count: string }>(
    `SELECT count(*) AS count FROM outbox_events
      WHERE aggregate_type='PAYMENT'
        AND aggregate_id=$1
        AND event_type='payment.reservation_expired_requires_reconciliation'`,
    [paymentIds[0]],
  );
  assert.equal(alerts.rows[0]?.count, "1");
});

test("reservation sweep raises a reconciliation alert instead of cancelling a provider-settled pending order", {
  skip: !migrationDatabaseUrl || !workerDatabaseUrl,
  timeout: 30_000,
}, async (t) => {
  const fixturePool = createMigrationDatabasePool(
    migrationDatabaseUrl!,
    "dabboba-worker-reservation-settled-fixture-integration",
  );
  const workerPool = createDatabasePool(
    workerDatabaseUrl!,
    "dabboba-worker-reservation-settled-integration",
    { expectedRole: WORKER_DATABASE_ROLE },
  );
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const lineId = randomUUID();
  const productId = `worker-settled-product-${suffix}`;
  const ipId = `worker-settled-ip-${suffix}`;
  t.after(async () => {
    await fixturePool.query(
      "DELETE FROM outbox_events WHERE correlation_id=$1",
      [`worker-reservation-reconciliation-${orderId}`],
    ).catch(() => undefined);
    await fixturePool.query("DELETE FROM worker_payment_reconciliations WHERE payment_id=$1", [paymentId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM stock_reservations WHERE order_id=$1", [orderId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM payments WHERE id=$1", [paymentId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM order_lines WHERE id=$1", [lineId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM orders WHERE id=$1", [orderId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM product_stock WHERE product_id=$1", [productId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM catalog_products WHERE id=$1", [productId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM catalog_ips WHERE id=$1", [ipId]).catch(() => undefined);
    await fixturePool.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    await Promise.all([fixturePool.end(), workerPool.end()]);
  });

  await fixturePool.query(
    "INSERT INTO users(id,email,nickname) VALUES($1,$2,$3)",
    [userId, `worker-reservation-settled-${suffix}@example.test`, `정산관찰${suffix}`],
  );
  await fixturePool.query(
    "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
    [ipId, ipId, `정산 관찰 ${suffix}`, `Settled observation ${suffix}`],
  );
  await fixturePool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price)
     VALUES($1,$2,$3,'figure',$4,1000)`,
    [productId, `WORKER-SETTLED-${suffix.toUpperCase()}`, ipId, `정산 관찰 상품 ${suffix}`],
  );
  await fixturePool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,5,1)", [productId]);
  await fixturePool.query(
    "INSERT INTO orders(id,user_id,subtotal,total) VALUES($1,$2,1000,1000)",
    [orderId, userId],
  );
  await fixturePool.query(
    `INSERT INTO order_lines(
       id,order_id,product_id,product_name_snapshot,category_snapshot,unit_price,quantity,line_total
     ) VALUES($1,$2,$3,$4,'figure',1000,1,1000)`,
    [lineId, orderId, productId, `정산 관찰 상품 ${suffix}`],
  );
  const payment = await fixturePool.query<{ version: number }>(
    `INSERT INTO payments(id,order_id,provider,status,amount)
     VALUES($1,$2,'TEST_PG','PENDING',1000) RETURNING version`,
    [paymentId, orderId],
  );
  await fixturePool.query(
    `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
     VALUES($1,$2,$3,1,$4)`,
    [orderId, lineId, productId, new Date("2000-01-01T00:00:00.000Z")],
  );
  // The provider was observed PAID for this exact payment version, but the
  // canonical transition has not landed. Cancelling now would strand money.
  await fixturePool.query(
    `INSERT INTO worker_payment_reconciliations(
       payment_id,payment_version,attempts,last_outcome,last_observed_state,
       last_error,last_attempted_at,next_attempt_at
     ) VALUES($1,$2,1,'MANUAL_REVIEW','PAID',NULL,now(),now()+interval '1 hour')`,
    [paymentId, payment.rows[0]!.version],
  );

  const logger = { debug() {}, info() {}, warn() {}, error() {} } as Logger;
  const now = new Date("2001-01-01T00:00:00.000Z");
  const outcome = await expireOrderReservations(workerPool, orderId, now);
  assert.deepEqual(outcome, {
    status: "requires_reconciliation",
    released: 0,
    reason: "PROVIDER_OBSERVED_SETTLED",
  });

  const first = await expireReservationBatch(workerPool, 50, logger, now);
  assert.equal(first.reconciliation >= 1, true);
  const state = await fixturePool.query<{ order_status: string; payment_status: string; reservation_status: string; reserved: number }>(
    `SELECT o.status AS order_status,p.status AS payment_status,
            sr.status AS reservation_status,s.reserved
       FROM orders o
       JOIN payments p ON p.order_id=o.id
       JOIN stock_reservations sr ON sr.order_id=o.id
       JOIN product_stock s ON s.product_id=sr.product_id
      WHERE o.id=$1`,
    [orderId],
  );
  assert.deepEqual(state.rows, [{
    order_status: "PENDING_PAYMENT",
    payment_status: "PENDING",
    reservation_status: "ACTIVE",
    reserved: 1,
  }]);
  const alerts = await fixturePool.query<{ reason: string }>(
    `SELECT payload->>'reason' AS reason FROM outbox_events
      WHERE aggregate_type='PAYMENT' AND aggregate_id=$1
        AND event_type='payment.reservation_expired_requires_reconciliation'`,
    [paymentId],
  );
  assert.deepEqual(alerts.rows, [{ reason: "PROVIDER_OBSERVED_SETTLED" }]);

  // With the durable alert recorded, later sweeps neither cancel the order nor
  // raise a second alert for the same payment version.
  await expireReservationBatch(workerPool, 500, logger, now);
  const afterSecond = await fixturePool.query<{ status: string; alerts: string }>(
    `SELECT sr.status,
            (SELECT count(*)::text FROM outbox_events
              WHERE aggregate_type='PAYMENT' AND aggregate_id=$2
                AND event_type='payment.reservation_expired_requires_reconciliation') AS alerts
       FROM stock_reservations sr WHERE sr.order_id=$1`,
    [orderId, paymentId],
  );
  assert.deepEqual(afterSecond.rows, [{ status: "ACTIVE", alerts: "1" }]);

  // A later version (the reconciliation evidence is now stale) releases normally.
  await fixturePool.query("UPDATE payments SET version=version+1 WHERE id=$1", [paymentId]);
  const released = await expireOrderReservations(workerPool, orderId, now);
  assert.deepEqual(released, { status: "expired", released: 1 });
});
