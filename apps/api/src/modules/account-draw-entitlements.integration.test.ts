import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "paid draw entitlements survive app rebuild and remain owner-scoped, status-filtered, and cursor-paged",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-account-draw-entitlements-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "account-draw-entitlements-integration-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    let { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`],
      );
      const session = await issueSession(pool, config, {
        userId: user.rows[0]!.id,
        kind: "USER",
        ip: "203.0.113.91",
        userAgent: "Dabboba Draw Entitlement Integration/1.0",
      });
      return { id: user.rows[0]!.id, token: session.token };
    };
    const owner = await createActor("draw-owner");
    const stranger = await createActor("draw-stranger");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });

    const ipId = `account-draw-${suffix}`;
    const productId = `draw-ticket-${suffix}`;
    const prizeProductId = `draw-prize-${suffix}`;
    const imageUrl = `https://cdn.example.test/${productId}.png`;
    const prizeSku = `PRIZE-${suffix}`.toUpperCase();
    const prizeName = `복원 테스트 경품 ${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `추첨권 복원 IP ${suffix}`, `Draw Restore ${suffix}`],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
       VALUES($1,$2,$3,'gacha',$4,1000,$5,false),($6,$7,$3,'figure',$8,0,NULL,true)`,
      [
        productId,
        `DRAW-${suffix}`.toUpperCase(),
        ipId,
        `새로고침 복원 추첨 ${suffix}`,
        imageUrl,
        prizeProductId,
        prizeSku,
        prizeName,
      ],
    );
    await pool.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,10,0),($2,10,0)",
      [productId, prizeProductId],
    );
    const version = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,7) RETURNING id",
      [productId],
    );
    await pool.query(
      `INSERT INTO draw_pool_entries(
        probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
        prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity
      ) VALUES($1,$2,$3,NULL,$4,$5,'figure','A',1,NULL,NULL)`,
      [version.rows[0]!.id, prizeProductId, prizeName, prizeSku, ipId],
    );
    await pool.query(
      `UPDATE draw_probability_versions
       SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1`,
      [version.rows[0]!.id, owner.id],
    );

    const createPaidLine = async (userId: string, quantity: number) => {
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',$2,$2,now()) RETURNING id`,
        [userId, quantity * 1000],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(
          order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
          unit_price,quantity,line_total
        ) VALUES($1,$2,$3,'gacha',$4,1000,$5,$6) RETURNING id`,
        [
          order.rows[0]!.id,
          productId,
          `새로고침 복원 추첨 ${suffix}`,
          version.rows[0]!.id,
          quantity,
          quantity * 1000,
        ],
      );
      await pool.query(
        `INSERT INTO payments(order_id,provider,status,amount,paid_at)
         VALUES($1,'TEST_PG','PAID',$2,now())`,
        [order.rows[0]!.id, quantity * 1000],
      );
      return { orderId: order.rows[0]!.id, orderLineId: line.rows[0]!.id };
    };
    const ownerLine = await createPaidLine(owner.id, 4);
    const strangerLine = await createPaidLine(stranger.id, 2);
    const insertEntitlement = async (
      line: { orderId: string; orderLineId: string },
      userId: string,
      status: "AVAILABLE" | "CONSUMED" | "CANCELLED",
      createdAt: string,
      consumedAt: string | null = null,
    ) => {
      const saved = await pool.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
          order_line_id,user_id,product_id,probability_version_id,status,created_at,consumed_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [line.orderLineId, userId, productId, version.rows[0]!.id, status, createdAt, consumedAt],
      );
      return saved.rows[0]!.id;
    };
    const availableOlder = await insertEntitlement(ownerLine, owner.id, "AVAILABLE", "2026-08-25T04:00:00.000Z");
    const availableNewer = await insertEntitlement(ownerLine, owner.id, "AVAILABLE", "2026-08-25T05:00:00.000Z");
    const consumed = await insertEntitlement(
      ownerLine,
      owner.id,
      "CONSUMED",
      "2026-08-25T03:00:00.000Z",
      "2026-08-25T03:05:00.000Z",
    );
    const cancelled = await insertEntitlement(ownerLine, owner.id, "CANCELLED", "2026-08-25T02:00:00.000Z");
    const strangerAvailable = await insertEntitlement(
      strangerLine,
      stranger.id,
      "AVAILABLE",
      "2026-08-25T06:00:00.000Z",
    );
    await insertEntitlement(
      strangerLine,
      owner.id,
      "AVAILABLE",
      "2026-08-25T07:00:00.000Z",
    );
    await pool.query("UPDATE catalog_products SET is_active=false WHERE id=$1", [productId]);

    await app.close();
    ({ app } = await buildApp({ config, pool, redis: null }));

    const unauthenticated = await app.inject({ method: "GET", url: "/v1/account/draw-entitlements" });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/account/draw-entitlements?limit=1",
      headers: auth(owner.token),
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const firstPageBody = firstPage.json() as {
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    assert.deepEqual(firstPageBody.items, [{
      id: availableNewer,
      orderId: ownerLine.orderId,
      orderLineId: ownerLine.orderLineId,
      product: {
        id: productId,
        name: `새로고침 복원 추첨 ${suffix}`,
        category: "gacha",
        imageUrl,
      },
      probabilityVersion: 7,
      status: "AVAILABLE",
      createdAt: "2026-08-25T05:00:00.000Z",
      consumedAt: null,
    }]);
    assert.ok(firstPageBody.nextCursor);

    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/account/draw-entitlements?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`,
      headers: auth(owner.token),
    });
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    assert.deepEqual(
      (secondPage.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
      [availableOlder],
    );

    const consumedOnly = await app.inject({
      method: "GET",
      url: "/v1/account/draw-entitlements?status=CONSUMED",
      headers: auth(owner.token),
    });
    assert.equal(consumedOnly.statusCode, 200, consumedOnly.body);
    assert.deepEqual(
      (consumedOnly.json() as { items: Array<{ id: string; status: string; consumedAt: string | null }> }).items
        .map(({ id, status, consumedAt }) => ({ id, status, consumedAt })),
      [{ id: consumed, status: "CONSUMED", consumedAt: "2026-08-25T03:05:00.000Z" }],
    );

    const cancelledOnly = await app.inject({
      method: "GET",
      url: "/v1/account/draw-entitlements?status=CANCELLED",
      headers: auth(owner.token),
    });
    assert.equal(cancelledOnly.statusCode, 200, cancelledOnly.body);
    assert.deepEqual(
      (cancelledOnly.json() as { items: Array<{ id: string; consumedAt: string | null }> }).items
        .map(({ id, consumedAt }) => ({ id, consumedAt })),
      [{ id: cancelled, consumedAt: null }],
    );

    const invalidStatus = await app.inject({
      method: "GET",
      url: "/v1/account/draw-entitlements?status=PENDING",
      headers: auth(owner.token),
    });
    assert.equal(invalidStatus.statusCode, 400, invalidStatus.body);

    const strangerList = await app.inject({
      method: "GET",
      url: "/v1/account/draw-entitlements",
      headers: auth(stranger.token),
    });
    assert.equal(strangerList.statusCode, 200, strangerList.body);
    assert.deepEqual(
      (strangerList.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
      [strangerAvailable],
    );
  },
);
