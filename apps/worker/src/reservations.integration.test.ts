import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabasePool } from "@dabboba/db";
import { expireOrderReservations } from "./reservations.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "reservation expiry releases a linked kuji room and promotes the FIFO waiter",
  { skip: !databaseUrl, timeout: 30_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-worker-kuji-integration");
    t.after(async () => pool.end());

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `worker-kuji-${suffix}`;
    const productId = `worker-kuji-product-${suffix}`;
    const prizeProductId = `worker-kuji-prize-${suffix}`;
    const publisher = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-publisher-${suffix}@example.test`, `퍼블리셔${suffix}`],
    );
    const buyer = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-buyer-${suffix}@example.test`, `구매자${suffix}`],
    );
    const waiter = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname) VALUES($1,$2) RETURNING id",
      [`worker-waiter-${suffix}@example.test`, `대기자${suffix}`],
    );
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `워커 쿠지 ${suffix}`, `Worker kuji ${suffix}`],
    );
    await pool.query(
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
    await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,5,1)", [productId]);
    const version = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
      [productId],
    );
    await pool.query(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
         initial_quantity,remaining_quantity
       ) SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,5,5
           FROM catalog_products p WHERE p.id=$2`,
      [version.rows[0]!.id, prizeProductId],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [version.rows[0]!.id, publisher.rows[0]!.id],
    );
    await pool.query("INSERT INTO kuji_rooms(product_id) VALUES($1)", [productId]);
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,subtotal,total) VALUES($1,1000,1000) RETURNING id",
      [buyer.rows[0]!.id],
    );
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(
         order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
         unit_price,quantity,line_total
       ) VALUES($1,$2,$3,'kuji',$4,1000,1,1000) RETURNING id`,
      [order.rows[0]!.id, productId, `워커 쿠지 ${suffix}`, version.rows[0]!.id],
    );
    await pool.query(
      "INSERT INTO payments(order_id,provider,amount) VALUES($1,'TEST_PG',1000)",
      [order.rows[0]!.id],
    );
    const expiredAt = new Date(Date.now() - 1_000);
    await pool.query(
      `INSERT INTO stock_reservations(order_id,order_line_id,product_id,quantity,expires_at)
       VALUES($1,$2,$3,1,$4)`,
      [order.rows[0]!.id, line.rows[0]!.id, productId, expiredAt],
    );
    const active = await pool.query<{ id: string }>(
      `INSERT INTO kuji_room_entries(
         product_id,user_id,order_id,state,checkout_started_at,checkout_expires_at
       ) VALUES($1,$2,$3,'CHECKOUT_PENDING',$4::timestamptz-$5::interval,$4::timestamptz)
       RETURNING id`,
      [productId, buyer.rows[0]!.id, order.rows[0]!.id, expiredAt, "3 minutes"],
    );
    const waiting = await pool.query<{ id: string }>(
      "INSERT INTO kuji_room_entries(product_id,user_id,state) VALUES($1,$2,'WAITING') RETURNING id",
      [productId, waiter.rows[0]!.id],
    );

    const now = new Date();
    const outcome = await expireOrderReservations(pool, order.rows[0]!.id, now);
    assert.deepEqual(outcome, { status: "expired", released: 1 });
    const state = await pool.query<{
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
