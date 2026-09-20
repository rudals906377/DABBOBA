import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { PaidGachaDrawCompletion, PaidKujiDrawRecovery, PaidKujiSelectionSnapshot } from "@dabboba/contracts";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  RUNTIME_DATABASE_ROLE,
  withTransaction,
} from "@dabboba/db";
import { buildApp } from "./app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "./integration-test-fixtures.js";
import { beginIdempotency, completeIdempotency, requestHash } from "./lib/idempotency.js";
import { issueSession } from "./plugins/auth.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL;

type RuntimeSession = {
  token: string;
  userId: string;
};

type RuntimeOrderResponse = {
  id: string;
  paymentId: string;
  status: string;
  pointTotal: number;
  total: number;
  drawEntitlementIds: string[];
};

type RuntimeDrawResult = {
  id: string;
  entitlementId: string;
  productId: string;
  prizeProductId: string;
  prizeInventoryUnitId: string;
  probabilityVersion: number;
  rarity: string;
  kujiSlotNumber?: number;
};

type RuntimeInventoryPage = {
  items: Array<{
    id: string;
    ownerId: string;
    productId: string;
    sourceType: "GACHA" | "KUJI";
    status: string;
  }>;
};

test(
  "customer API account, commerce, and draw routes run as the dedicated runtime database role",
  { skip: !migrationDatabaseUrl || !runtimeDatabaseUrl, timeout: 60_000 },
  async (t) => {
    const ownerPool = createMigrationDatabasePool(
      migrationDatabaseUrl!,
      "dabboba-runtime-route-fixtures",
    );
    const runtimePool = createDatabasePool(
      runtimeDatabaseUrl!,
      "dabboba-runtime-route-integration",
    );
    const config: ApiConfig = {
      environment: "test",
      surface: "customer",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: runtimeDatabaseUrl!,
      redisUrl: null,
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "runtime-route-integration-pepper",
      adminProxyIdentitySecret: null,
      supabaseUrl: null,
      supabaseJwtAudience: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool: runtimePool, redis: null });
    t.after(async () => {
      await app.close();
      await runtimePool.end();
      await ownerPool.end();
    });

    const identity = await runtimePool.query<{ current_user: string }>("SELECT current_user");
    assert.equal(identity.rows[0]?.current_user, RUNTIME_DATABASE_ROLE);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userSequence = 0;
    const createRuntimeSession = async (label: string): Promise<RuntimeSession> => {
      const user = await ownerPool.query<{ id: string }>(
        `INSERT INTO users(email,nickname,role,status)
         VALUES($1,$2,'USER','ACTIVE') RETURNING id`,
        [`runtime-route-${label}-${suffix}-${userSequence++}@example.test`, `${label} ${suffix}`],
      );
      await acceptRequiredPoliciesForIntegrationTest(runtimePool, user.rows[0]!.id);
      const session = await issueSession(runtimePool, config, {
        userId: user.rows[0]!.id,
        kind: "USER",
        ip: "203.0.113.96",
        userAgent: "Dabboba Runtime Route Integration/1.0",
      });
      return { userId: user.rows[0]!.id, token: session.token };
    };
    const primaryUser = await createRuntimeSession("primary");
    const otherUser = await createRuntimeSession("other");
    const kujiUser = await createRuntimeSession("kuji");
    const userId = primaryUser.userId;
    const authorization = `Bearer ${primaryUser.token}`;

    const catalog = await app.inject({
      method: "GET",
      url: "/v1/catalog/products?limit=1",
    });
    assert.equal(catalog.statusCode, 200, catalog.body);

    const homeSections = await app.inject({
      method: "GET",
      url: "/v1/catalog/home-sections",
    });
    assert.equal(homeSections.statusCode, 200, homeSections.body);

    const missingKujiDeck = await app.inject({
      method: "GET",
      url: "/v1/catalog/products/runtime-missing-kuji/kuji-slots",
    });
    assert.equal(missingKujiDeck.statusCode, 404, missingKujiDeck.body);

    const initial = await app.inject({
      method: "GET",
      url: "/v1/account/notification-preferences",
      headers: { authorization },
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal((initial.json() as { version: number }).version, 1);

    const idempotencyKey = `runtime-route-${randomUUID()}`;
    const changed = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { authorization, "idempotency-key": idempotencyKey },
      payload: {
        exchangeUpdates: false,
        requestUpdates: true,
        restockUpdates: true,
        marketingSms: false,
        marketingEmail: true,
        marketingPush: true,
        personalizedRecommendations: true,
        expectedVersion: 1,
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((changed.json() as { version: number }).version, 2);

    const adminRoute = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization },
    });
    assert.equal(adminRoute.statusCode, 404, adminRoute.body);

    const durableState = await ownerPool.query<{
      event_count: string;
      outbox_count: string;
      completed_idempotency_count: string;
    }>(
      `SELECT
        (SELECT count(*) FROM notification_preference_events WHERE user_id=$1) AS event_count,
        (SELECT count(*) FROM outbox_events
          WHERE aggregate_type='NOTIFICATION_PREFERENCES'
            AND aggregate_id=$1::text
            AND event_type='notification.preferences.updated') AS outbox_count,
        (SELECT count(*) FROM idempotency_keys
          WHERE actor_id=$1
            AND scope='ACCOUNT_NOTIFICATION_PREFERENCES_UPDATE'
            AND idempotency_key=$2
            AND state='COMPLETED') AS completed_idempotency_count`,
      [userId, idempotencyKey],
    );
    assert.deepEqual(durableState.rows[0], {
      event_count: "2",
      outbox_count: "1",
      completed_idempotency_count: "1",
    });

    const genericTtlKey = `runtime-generic-ttl-${randomUUID()}`;
    const genericTtlScope = "RUNTIME_ROUTE_TEST_TTL";
    await withTransaction(runtimePool, async (client) => {
      const started = await beginIdempotency(client, {
        actorId: userId,
        scope: genericTtlScope,
        key: genericTtlKey,
        hash: requestHash({ attempt: 1 }),
      });
      assert.equal(started.fresh, true);
      if (!started.fresh) assert.fail("generic TTL fixture must begin as a fresh request");
      await completeIdempotency(client, started.id, {
        statusCode: 200,
        body: { attempt: 1 },
        resourceType: "RUNTIME_ROUTE_TEST",
        resourceId: userId,
      });
    });
    const expiredGenericKey = await ownerPool.query(
      `UPDATE idempotency_keys
          SET expires_at=now()-interval '1 second'
        WHERE actor_id=$1
          AND scope=$2
          AND idempotency_key=$3
          AND state='COMPLETED'`,
      [userId, genericTtlScope, genericTtlKey],
    );
    assert.equal(expiredGenericKey.rowCount, 1);
    await withTransaction(runtimePool, async (client) => {
      const restarted = await beginIdempotency(client, {
        actorId: userId,
        scope: genericTtlScope,
        key: genericTtlKey,
        hash: requestHash({ attempt: 2 }),
      });
      assert.equal(restarted.fresh, true);
      if (!restarted.fresh) assert.fail("expired non-order keys must retain the generic TTL policy");
      await completeIdempotency(client, restarted.id, {
        statusCode: 200,
        body: { attempt: 2 },
        resourceType: "RUNTIME_ROUTE_TEST",
        resourceId: userId,
      });
    });

    const ipId = `runtime-commerce-${suffix}`;
    const gachaProductId = `runtime-gacha-${suffix}`;
    const gachaPrizeProductId = `runtime-gacha-prize-${suffix}`;
    const kujiProductId = `runtime-kuji-${suffix}`;
    const kujiPrizeProductId = `runtime-kuji-prize-${suffix}`;
    await ownerPool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `제한 역할 커머스 ${suffix}`, `Runtime commerce ${suffix}`],
    );
    await ownerPool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
       VALUES
         ($1,$2,$3,'gacha',$4,1000,$14,false),
         ($5,$6,$3,'figure',$7,24900,NULL,true),
         ($8,$9,$3,'kuji',$10,1000,$15,false),
         ($11,$12,$3,'figure',$13,0,NULL,true)`,
      [
        gachaProductId,
        `RUNTIME-GACHA-${suffix}`.toUpperCase(),
        ipId,
        `제한 역할 가챠 ${suffix}`,
        gachaPrizeProductId,
        `RUNTIME-GACHA-PRIZE-${suffix}`.toUpperCase(),
        `제한 역할 가챠 경품 ${suffix}`,
        kujiProductId,
        `RUNTIME-KUJI-${suffix}`.toUpperCase(),
        `제한 역할 쿠지 ${suffix}`,
        kujiPrizeProductId,
        `RUNTIME-KUJI-PRIZE-${suffix}`.toUpperCase(),
        `제한 역할 쿠지 경품 ${suffix}`,
        `https://cdn.example.test/products/${gachaProductId}.png`,
        `https://cdn.example.test/products/${kujiProductId}.png`,
      ],
    );
    await ownerPool.query(
      `INSERT INTO product_stock(product_id,on_hand,reserved)
       VALUES($1,1,0),($2,1,0)`,
      [gachaProductId, kujiProductId],
    );

    const publishDrawFixture = async (input: {
      productId: string;
      prizeProductId: string;
      category: "gacha" | "kuji";
      quantity?: number;
    }) => {
      const version = await ownerPool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
        [input.productId],
      );
      const versionId = version.rows[0]!.id;
      const poolEntry = await ownerPool.query<{ id: string }>(
        `INSERT INTO draw_pool_entries(
           probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
           prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
           initial_quantity,remaining_quantity
         ) SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,$3,$3
             FROM catalog_products p WHERE p.id=$2
           RETURNING id`,
        [versionId, input.prizeProductId, input.quantity ?? 1],
      );
      if (input.category === "kuji") {
        await ownerPool.query(
          "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,1)",
          [versionId],
        );
        await ownerPool.query(
          `INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank)
           VALUES($1,$2,'A',0)`,
          [versionId, poolEntry.rows[0]!.id],
        );
        await ownerPool.query(
          `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
           VALUES($1,1,$2)`,
          [versionId, poolEntry.rows[0]!.id],
        );
      }
      await ownerPool.query(
        `UPDATE draw_probability_versions
         SET status='ACTIVE',published_by=$2,published_at=now()
         WHERE id=$1`,
        [versionId, primaryUser.userId],
      );
      return { id: versionId, version: 1 };
    };

    const gachaVersion = await publishDrawFixture({
      productId: gachaProductId,
      prizeProductId: gachaPrizeProductId,
      category: "gacha",
    });
    const kujiVersion = await publishDrawFixture({
      productId: kujiProductId,
      prizeProductId: kujiPrizeProductId,
      category: "kuji",
    });
    await ownerPool.query(
      "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=ANY($1::text[])",
      [[gachaProductId, kujiProductId]],
    );

    const creditPoints = async (targetUserId: string, referenceId: string) => {
      await ownerPool.query(
        "INSERT INTO point_accounts(user_id,balance) VALUES($1,1000)",
        [targetUserId],
      );
      await ownerPool.query(
        `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
         VALUES($1,'EARN',1000,'TEST',$2,'Runtime route integration setup')`,
        [targetUserId, referenceId],
      );
    };
    await creditPoints(primaryUser.userId, `runtime-gacha-${suffix}`);
    await creditPoints(kujiUser.userId, `runtime-kuji-${suffix}`);

    const gachaOrderKey = `runtime-gacha-order-${randomUUID()}`;
    const gachaOrderPayload = {
      items: [{
        productId: gachaProductId,
        quantity: 1,
        expectedDrawVersion: gachaVersion.version,
      }],
      pointAmount: 1000,
    };
    const createGachaOrder = () => app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization,
        "idempotency-key": gachaOrderKey,
      },
      payload: gachaOrderPayload,
    });
    const gachaOrderResponse = await createGachaOrder();
    assert.equal(gachaOrderResponse.statusCode, 201, gachaOrderResponse.body);
    const gachaOrder = gachaOrderResponse.json() as RuntimeOrderResponse;
    assert.equal(gachaOrder.status, "PAID");
    assert.equal(gachaOrder.pointTotal, 1000);
    assert.equal(gachaOrder.total, 0);
    assert.equal(gachaOrder.drawEntitlementIds.length, 1);

    const gachaOrderReplay = await createGachaOrder();
    assert.equal(gachaOrderReplay.statusCode, 201, gachaOrderReplay.body);
    assert.equal(gachaOrderReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(gachaOrderReplay.json(), gachaOrder);

    const expiredCompletedOrderKey = await ownerPool.query(
      `UPDATE idempotency_keys
          SET expires_at=now()-interval '1 second'
        WHERE actor_id=$1
          AND scope='CREATE_ORDER'
          AND idempotency_key=$2
          AND state='COMPLETED'`,
      [primaryUser.userId, gachaOrderKey],
    );
    assert.equal(expiredCompletedOrderKey.rowCount, 1);
    const gachaOrderReplayAfterExpiry = await createGachaOrder();
    assert.equal(gachaOrderReplayAfterExpiry.statusCode, 201, gachaOrderReplayAfterExpiry.body);
    assert.equal(gachaOrderReplayAfterExpiry.headers["x-idempotent-replay"], "true");
    assert.deepEqual(gachaOrderReplayAfterExpiry.json(), gachaOrder);

    const changedGachaOrderAfterExpiry = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization,
        "idempotency-key": gachaOrderKey,
      },
      payload: { ...gachaOrderPayload, pointAmount: 999 },
    });
    assert.equal(changedGachaOrderAfterExpiry.statusCode, 409, changedGachaOrderAfterExpiry.body);
    assert.match(
      changedGachaOrderAfterExpiry.body,
      /같은 Idempotency-Key를 다른 요청에 재사용할 수 없습니다/,
    );

    const otherOrderRead = await app.inject({
      method: "GET",
      url: `/v1/orders/${gachaOrder.id}`,
      headers: { authorization: `Bearer ${otherUser.token}` },
    });
    assert.equal(otherOrderRead.statusCode, 404, otherOrderRead.body);

    const gachaEntitlementId = gachaOrder.drawEntitlementIds[0]!;
    const otherConsume = await app.inject({
      method: "POST",
      url: `/v1/draws/${gachaEntitlementId}/consume`,
      headers: {
        authorization: `Bearer ${otherUser.token}`,
        "idempotency-key": `runtime-foreign-consume-${randomUUID()}`,
      },
    });
    assert.equal(otherConsume.statusCode, 403, otherConsume.body);

    const gachaConsumeKey = `runtime-gacha-consume-${randomUUID()}`;
    const consumeGacha = () => app.inject({
      method: "POST",
      url: `/v1/draws/${gachaEntitlementId}/consume`,
      headers: {
        authorization,
        "idempotency-key": gachaConsumeKey,
      },
    });
    const gachaConsumeResponse = await consumeGacha();
    assert.equal(gachaConsumeResponse.statusCode, 200, gachaConsumeResponse.body);
    const gachaResult = gachaConsumeResponse.json() as RuntimeDrawResult;
    assert.deepEqual(
      {
        entitlementId: gachaResult.entitlementId,
        productId: gachaResult.productId,
        prizeProductId: gachaResult.prizeProductId,
        probabilityVersion: gachaResult.probabilityVersion,
        rarity: gachaResult.rarity,
      },
      {
        entitlementId: gachaEntitlementId,
        productId: gachaProductId,
        prizeProductId: gachaPrizeProductId,
        probabilityVersion: 1,
        rarity: "A",
      },
    );
    const gachaConsumeReplay = await consumeGacha();
    assert.equal(gachaConsumeReplay.statusCode, 200, gachaConsumeReplay.body);
    assert.equal(gachaConsumeReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(gachaConsumeReplay.json(), gachaResult);

    const primaryInventoryResponse = await app.inject({
      method: "GET",
      url: "/v1/account/inventory?limit=100",
      headers: { authorization },
    });
    assert.equal(primaryInventoryResponse.statusCode, 200, primaryInventoryResponse.body);
    const primaryInventory = primaryInventoryResponse.json() as RuntimeInventoryPage;
    const primaryInventoryItem = primaryInventory.items.find(
      (item) => item.id === gachaResult.prizeInventoryUnitId,
    );
    assert.ok(primaryInventoryItem);
    assert.deepEqual(
      {
        id: primaryInventoryItem.id,
        ownerId: primaryInventoryItem.ownerId,
        productId: primaryInventoryItem.productId,
        sourceType: primaryInventoryItem.sourceType,
        status: primaryInventoryItem.status,
      },
      {
        id: gachaResult.prizeInventoryUnitId,
        ownerId: primaryUser.userId,
        productId: gachaPrizeProductId,
        sourceType: "GACHA",
        status: "OWNED",
      },
    );
    const otherInventoryResponse = await app.inject({
      method: "GET",
      url: "/v1/account/inventory?limit=100",
      headers: { authorization: `Bearer ${otherUser.token}` },
    });
    assert.equal(otherInventoryResponse.statusCode, 200, otherInventoryResponse.body);
    assert.equal(
      (otherInventoryResponse.json() as RuntimeInventoryPage).items
        .some((item) => item.id === gachaResult.prizeInventoryUnitId),
      false,
    );

    const gachaPersisted = await ownerPool.query<{
      order_status: string;
      point_total: number;
      total: number;
      payment_provider: string;
      payment_status: string;
      point_balance: number;
      on_hand: number;
      entitlement_status: string;
      result_count: string;
      inventory_owner_id: string;
      inventory_source_type: string;
      inventory_status: string;
      order_idempotency_count: string;
      consume_idempotency_count: string;
    }>(
      `SELECT o.status AS order_status,o.point_total,o.total,
              payment.provider AS payment_provider,payment.status AS payment_status,
              points.balance AS point_balance,stock.on_hand,entitlement.status AS entitlement_status,
              (SELECT count(*) FROM draw_results WHERE entitlement_id=$4) AS result_count,
              inventory.owner_id AS inventory_owner_id,inventory.source_type AS inventory_source_type,
              inventory.status AS inventory_status,
              (SELECT count(*) FROM idempotency_keys
                WHERE actor_id=$2 AND scope='CREATE_ORDER' AND idempotency_key=$5 AND state='COMPLETED')
                AS order_idempotency_count,
              (SELECT count(*) FROM idempotency_keys
                WHERE actor_id=$2 AND scope='CONSUME_DRAW' AND idempotency_key=$6 AND state='COMPLETED')
                AS consume_idempotency_count
         FROM orders AS o
         JOIN payments AS payment ON payment.order_id=o.id
         JOIN point_accounts AS points ON points.user_id=o.user_id
         JOIN product_stock AS stock ON stock.product_id=$3
         JOIN draw_entitlements AS entitlement ON entitlement.id=$4
         JOIN inventory_units AS inventory ON inventory.id=$7
        WHERE o.id=$1`,
      [
        gachaOrder.id,
        primaryUser.userId,
        gachaProductId,
        gachaEntitlementId,
        gachaOrderKey,
        gachaConsumeKey,
        gachaResult.prizeInventoryUnitId,
      ],
    );
    assert.deepEqual(gachaPersisted.rows[0], {
      order_status: "PAID",
      point_total: 1000,
      total: 0,
      payment_provider: "INTERNAL_ZERO",
      payment_status: "PAID",
      point_balance: 0,
      on_hand: 0,
      entitlement_status: "CONSUMED",
      result_count: "1",
      inventory_owner_id: primaryUser.userId,
      inventory_source_type: "GACHA",
      inventory_status: "OWNED",
      order_idempotency_count: "1",
      consume_idempotency_count: "1",
    });

    const addressKey = `runtime-address-${randomUUID()}`;
    const addressResponse = await app.inject({
      method: "PUT",
      url: "/v1/account/default-address",
      headers: { authorization, "idempotency-key": addressKey },
      payload: {
        recipient: "김영민",
        phone: "010-1234-5678",
        postalCode: "06236",
        addressLine1: "서울특별시 강남구 테스트로 1",
        addressLine2: "101호",
        deliveryNote: "문 앞",
      },
    });
    assert.equal(addressResponse.statusCode, 201, addressResponse.body);

    const shippingQuoteResponse = await app.inject({
      method: "POST",
      url: "/v1/account/shipping-quotes",
      headers: { authorization },
      payload: { inventoryUnitIds: [gachaResult.prizeInventoryUnitId] },
    });
    assert.equal(shippingQuoteResponse.statusCode, 200, shippingQuoteResponse.body);
    const shippingQuote = shippingQuoteResponse.json() as { id: string; addressVersion: number };

    const shippingKey = `runtime-shipping-${randomUUID()}`;
    const createShippingRequest = () => app.inject({
      method: "POST",
      url: "/v1/account/shipping-requests",
      headers: { authorization, "idempotency-key": shippingKey },
      payload: { quoteId: shippingQuote.id, addressVersion: shippingQuote.addressVersion },
    });
    const shippingResponse = await createShippingRequest();
    assert.equal(shippingResponse.statusCode, 201, shippingResponse.body);
    const shipping = shippingResponse.json() as { id: string; inventoryUnitIds: string[] };
    assert.deepEqual(shipping.inventoryUnitIds, [gachaResult.prizeInventoryUnitId]);
    const shippingReplay = await createShippingRequest();
    assert.equal(shippingReplay.statusCode, 201, shippingReplay.body);
    assert.equal(shippingReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(shippingReplay.json(), shipping);

    const shippingDetailResponse = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests/${shipping.id}`,
      headers: { authorization },
    });
    assert.equal(shippingDetailResponse.statusCode, 200, shippingDetailResponse.body);
    const shippingDetail = shippingDetailResponse.json() as {
      destination: { recipientMasked: string; phoneMasked: string };
      items: Array<{
        inventoryUnitId: string;
        productId: string;
        productName: string;
        ipId: string;
        ipNameKo: string;
        category: string;
        imageUrl: string | null;
        productVersion: number;
      }>;
      status: string;
    };
    assert.equal(shippingDetail.status, "REQUESTED");
    assert.equal(shippingDetail.destination.recipientMasked, "김*민");
    assert.equal(shippingDetail.destination.phoneMasked, "*******5678");
    assert.deepEqual(shippingDetail.items, [{
      inventoryUnitId: gachaResult.prizeInventoryUnitId,
      productId: gachaPrizeProductId,
      productName: `제한 역할 가챠 경품 ${suffix}`,
      ipId,
      ipNameKo: `제한 역할 커머스 ${suffix}`,
      category: "figure",
      imageUrl: null,
      productVersion: 1,
    }]);
    const foreignShippingDetail = await app.inject({
      method: "GET",
      url: `/v1/account/shipping-requests/${shipping.id}`,
      headers: { authorization: `Bearer ${otherUser.token}` },
    });
    assert.equal(foreignShippingDetail.statusCode, 404, foreignShippingDetail.body);

    const shippingPersisted = await ownerPool.query<{
      address_idempotency_count: string;
      inventory_status: string;
      product_snapshot: Record<string, unknown>;
      quote_consumed: boolean;
      shipping_idempotency_count: string;
    }>(
      `SELECT inventory.status AS inventory_status,item.product_snapshot,
              (quote.consumed_at IS NOT NULL AND quote.shipping_request_id=request.id) AS quote_consumed,
              (SELECT count(*) FROM idempotency_keys
                WHERE actor_id=$2 AND scope='ACCOUNT_DEFAULT_ADDRESS_UPSERT'
                  AND idempotency_key=$4 AND state='COMPLETED') AS address_idempotency_count,
              (SELECT count(*) FROM idempotency_keys
                WHERE actor_id=$2 AND scope='ACCOUNT_SHIPPING_REQUEST_CREATE'
                  AND idempotency_key=$5 AND state='COMPLETED') AS shipping_idempotency_count
         FROM shipping_requests AS request
         JOIN shipping_request_items AS item ON item.shipping_request_id=request.id
         JOIN inventory_units AS inventory ON inventory.id=item.inventory_unit_id
         JOIN shipping_quotes AS quote ON quote.id=$6
        WHERE request.id=$1 AND request.user_id=$2 AND inventory.id=$3`,
      [
        shipping.id,
        primaryUser.userId,
        gachaResult.prizeInventoryUnitId,
        addressKey,
        shippingKey,
        shippingQuote.id,
      ],
    );
    assert.deepEqual(shippingPersisted.rows[0], {
      address_idempotency_count: "1",
      inventory_status: "SHIPPING",
      product_snapshot: {
        productId: gachaPrizeProductId,
        productName: `제한 역할 가챠 경품 ${suffix}`,
        ipId,
        ipNameKo: `제한 역할 커머스 ${suffix}`,
        category: "figure",
        imageUrl: null,
        productVersion: 1,
      },
      quote_consumed: true,
      shipping_idempotency_count: "1",
    });

    // Reinstall/remaining-only recovery must prove every original committed
    // result through the restricted runtime role, without replaying consume.
    const completionProductId = `runtime-completion-${suffix}`;
    await ownerPool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
       VALUES($1,$2,$3,'gacha','완료 증명 가챠',1000,$4,false)`,
      [
        completionProductId,
        `RUNTIME-COMPLETION-${suffix}`.toUpperCase(),
        ipId,
        `https://cdn.example.test/products/${completionProductId}.png`,
      ],
    );
    await ownerPool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,2,0)", [completionProductId]);
    await publishDrawFixture({ productId: completionProductId, prizeProductId: gachaPrizeProductId, category: "gacha", quantity: 2 });
    await ownerPool.query(
      "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
      [completionProductId],
    );
    await ownerPool.query(
      "UPDATE point_accounts SET balance=balance+2000 WHERE user_id=$1",
      [primaryUser.userId],
    );
    await ownerPool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',2000,'TEST',$2,'Runtime completion integration setup')`,
      [primaryUser.userId, `runtime-completion-${suffix}`],
    );
    const completionOrderResponse = await app.inject({
      method: "POST", url: "/v1/orders",
      headers: { authorization, "idempotency-key": `runtime-completion-${randomUUID()}` },
      payload: { items: [{ productId: completionProductId, quantity: 2, expectedDrawVersion: 1 }], pointAmount: 2000 },
    });
    assert.equal(completionOrderResponse.statusCode, 201, completionOrderResponse.body);
    const completionOrder = completionOrderResponse.json() as RuntimeOrderResponse;
    const completionUrl = `/v1/orders/${completionOrder.id}/draw-completion`;
    const readCompletion = () => app.inject({ method: "GET", url: completionUrl, headers: { authorization } });
    assert.equal((await app.inject({ method: "GET", url: completionUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: completionUrl, headers: { authorization: `Bearer ${otherUser.token}` } })).statusCode, 404);
    assert.equal((await readCompletion()).statusCode, 409);
    const completionResults: RuntimeDrawResult[] = [];
    for (const [index, entitlementId] of completionOrder.drawEntitlementIds.entries()) {
      const consume = await app.inject({
        method: "POST", url: `/v1/draws/${entitlementId}/consume`,
        headers: { authorization, "idempotency-key": `runtime-completion-consume-${randomUUID()}` },
      });
      assert.equal(consume.statusCode, 200, consume.body);
      completionResults.push(consume.json() as RuntimeDrawResult);
      if (index === 0) assert.equal((await readCompletion()).statusCode, 409);
    }
    await ownerPool.query(
      "UPDATE catalog_products SET sale_status='PAUSED',is_active=false WHERE id=$1",
      [completionProductId],
    );
    const completionState = () => runtimePool.query(
      `SELECT orders.status,orders.total,payment.status AS payment_status,
              (SELECT count(*) FROM draw_results WHERE product_id=$2) AS result_count,
              (SELECT count(*) FROM orders o JOIN order_lines l ON l.order_id=o.id WHERE l.product_id=$2) AS order_count
         FROM orders JOIN payments payment ON payment.order_id=orders.id WHERE orders.id=$1`,
      [completionOrder.id, completionProductId],
    );
    const beforeCompletionRead = await completionState();
    const completionResponse = await readCompletion();
    assert.equal(completionResponse.statusCode, 200, completionResponse.body);
    assert.equal(completionResponse.headers["cache-control"], "no-store");
    assert.doesNotMatch(completionResponse.body, /prize|pool|rarity|inventory|entropy|seed/i);
    const completion = completionResponse.json() as PaidGachaDrawCompletion;
    assert.equal(completion.orderId, completionOrder.id);
    assert.equal(completion.userId, primaryUser.userId);
    assert.equal(completion.productId, completionProductId);
    assert.equal(completion.probabilityVersion, 1);
    assert.deepEqual(completion.results.map((result) => ({ entitlementId: result.entitlementId, resultId: result.resultId })),
      completionResults.map((result) => ({ entitlementId: result.entitlementId, resultId: result.id })));
    assert.ok(completion.results.every((result) => Number.isFinite(Date.parse(result.committedAt))));
    assert.deepEqual((await completionState()).rows, beforeCompletionRead.rows);
    assert.deepEqual(beforeCompletionRead.rows[0], {
      status: "PAID", total: 0, payment_status: "PAID", result_count: "2", order_count: "1",
    });
    await ownerPool.query("UPDATE orders SET status='REFUND_REVIEW',version=version+1 WHERE id=$1", [completionOrder.id]);
    assert.equal((await readCompletion()).statusCode, 409);

    const joinKujiRoom = await app.inject({
      method: "POST",
      url: `/v1/kuji/rooms/${kujiProductId}/entries`,
      headers: { authorization: `Bearer ${kujiUser.token}` },
    });
    assert.equal(joinKujiRoom.statusCode, 201, joinKujiRoom.body);
    const kujiRoom = joinKujiRoom.json() as {
      viewer: { entryId: string; state: string };
    };
    assert.equal(kujiRoom.viewer.state, "CHECKOUT_PENDING");
    const kujiRoomEntryId = kujiRoom.viewer.entryId;

    const kujiOrderKey = `runtime-kuji-order-${randomUUID()}`;
    const kujiOrderPayload = {
      items: [{
        productId: kujiProductId,
        quantity: 1,
        expectedDrawVersion: kujiVersion.version,
      }],
      pointAmount: 1000,
      kujiRoomEntryId,
    };
    const createKujiOrder = () => app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization: `Bearer ${kujiUser.token}`,
        "idempotency-key": kujiOrderKey,
      },
      payload: kujiOrderPayload,
    });
    const kujiOrderResponse = await createKujiOrder();
    assert.equal(kujiOrderResponse.statusCode, 201, kujiOrderResponse.body);
    const kujiOrder = kujiOrderResponse.json() as RuntimeOrderResponse;
    assert.equal(kujiOrder.status, "PAID");
    assert.equal(kujiOrder.total, 0);
    assert.equal(kujiOrder.drawEntitlementIds.length, 1);
    const kujiOrderReplay = await createKujiOrder();
    assert.equal(kujiOrderReplay.statusCode, 201, kujiOrderReplay.body);
    assert.equal(kujiOrderReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(kujiOrderReplay.json(), kujiOrder);

    const kujiRecoveryUrl = `/v1/orders/${kujiOrder.id}/draw-recovery`;
    const readKujiRecovery = async (): Promise<PaidKujiDrawRecovery> => {
      const response = await app.inject({
        method: "GET",
        url: kujiRecoveryUrl,
        headers: { authorization: `Bearer ${kujiUser.token}` },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.doesNotMatch(response.body, /"(?:prizeName|prizeProductId|poolEntryId|tierCode|seed)"/);
      return response.json() as PaidKujiDrawRecovery;
    };
    const unauthenticatedRecovery = await app.inject({ method: "GET", url: kujiRecoveryUrl });
    assert.equal(unauthenticatedRecovery.statusCode, 401, unauthenticatedRecovery.body);
    const foreignRecovery = await app.inject({
      method: "GET",
      url: kujiRecoveryUrl,
      headers: { authorization: `Bearer ${otherUser.token}` },
    });
    assert.equal(foreignRecovery.statusCode, 404, foreignRecovery.body);
    const roomBeforeRecovery = await runtimePool.query(
      "SELECT * FROM kuji_room_entries WHERE id=$1",
      [kujiRoomEntryId],
    );
    const unboundRecovery = await readKujiRecovery();
    const selectionUrl = `/v1/orders/${kujiOrder.id}/kuji-selection`;
    assert.equal((await app.inject({ method: "GET", url: selectionUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: selectionUrl, headers: { authorization: `Bearer ${otherUser.token}` } })).statusCode, 404);
    const ownedSelectionResponse = await app.inject({
      method: "GET", url: selectionUrl, headers: { authorization: `Bearer ${kujiUser.token}` },
    });
    assert.equal(ownedSelectionResponse.statusCode, 200, ownedSelectionResponse.body);
    assert.equal(ownedSelectionResponse.headers["cache-control"], "no-store");
    const ownedSelection = ownedSelectionResponse.json() as PaidKujiSelectionSnapshot;
    assert.equal(ownedSelection.recovery.orderId, kujiOrder.id);
    assert.equal(ownedSelection.product.unitPrice, 1_000);
    assert.equal(ownedSelection.board?.probabilityVersion, kujiVersion.version);
    assert.deepEqual(ownedSelection.board?.slots, [{ slotNumber: 1, available: true }]);
    assert.equal(ownedSelection.board?.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0), 1);
    assert.equal(ownedSelection.board?.calculatedAt, ownedSelection.recovery.serverNow);
    assert.deepEqual({
      orderId: unboundRecovery.orderId,
      userId: unboundRecovery.userId,
      productId: unboundRecovery.productId,
      roomEntryId: unboundRecovery.roomEntryId,
      roomState: unboundRecovery.roomState,
      probabilityVersion: unboundRecovery.probabilityVersion,
      totalSlots: unboundRecovery.totalSlots,
      entitlementIds: unboundRecovery.entitlementIds,
      bindings: unboundRecovery.bindings,
    }, {
      orderId: kujiOrder.id,
      userId: kujiUser.userId,
      productId: kujiProductId,
      roomEntryId: kujiRoomEntryId,
      roomState: "DRAWING",
      probabilityVersion: kujiVersion.version,
      totalSlots: 1,
      entitlementIds: kujiOrder.drawEntitlementIds,
      bindings: [],
    });
    assert.deepEqual((await runtimePool.query(
      "SELECT * FROM kuji_room_entries WHERE id=$1",
      [kujiRoomEntryId],
    )).rows, roomBeforeRecovery.rows);

    const bindKujiKey = `runtime-kuji-bind-${randomUUID()}`;
    const bindKujiSlot = () => app.inject({
      method: "POST",
      url: `/v1/kuji/rooms/${kujiProductId}/entries/${kujiRoomEntryId}/slots`,
      headers: {
        authorization: `Bearer ${kujiUser.token}`,
        "idempotency-key": bindKujiKey,
      },
      payload: { probabilityVersion: kujiVersion.version, slotNumbers: [1] },
    });
    const kujiBindResponse = await bindKujiSlot();
    assert.equal(kujiBindResponse.statusCode, 201, kujiBindResponse.body);
    const kujiBindReplay = await bindKujiSlot();
    assert.equal(kujiBindReplay.statusCode, 201, kujiBindReplay.body);
    assert.equal(kujiBindReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(kujiBindReplay.json(), kujiBindResponse.json());

    const boundRecovery = await readKujiRecovery();
    assert.deepEqual(boundRecovery.entitlementIds, kujiOrder.drawEntitlementIds);
    assert.deepEqual(boundRecovery.bindings, [{
      entitlementId: kujiOrder.drawEntitlementIds[0]!,
      slotNumber: 1,
      state: "RESERVED",
    }]);
    assert.equal(boundRecovery.drawingExpiresAt, unboundRecovery.drawingExpiresAt);

    const kujiEntitlementId = kujiOrder.drawEntitlementIds[0]!;
    const kujiConsumeKey = `runtime-kuji-consume-${randomUUID()}`;
    const consumeKuji = () => app.inject({
      method: "POST",
      url: `/v1/draws/${kujiEntitlementId}/consume`,
      headers: {
        authorization: `Bearer ${kujiUser.token}`,
        "idempotency-key": kujiConsumeKey,
      },
    });
    const kujiConsumeResponse = await consumeKuji();
    assert.equal(kujiConsumeResponse.statusCode, 200, kujiConsumeResponse.body);
    const kujiResult = kujiConsumeResponse.json() as RuntimeDrawResult;
    assert.deepEqual(
      {
        entitlementId: kujiResult.entitlementId,
        productId: kujiResult.productId,
        prizeProductId: kujiResult.prizeProductId,
        probabilityVersion: kujiResult.probabilityVersion,
        rarity: kujiResult.rarity,
        kujiSlotNumber: kujiResult.kujiSlotNumber,
      },
      {
        entitlementId: kujiEntitlementId,
        productId: kujiProductId,
        prizeProductId: kujiPrizeProductId,
        probabilityVersion: 1,
        rarity: "A",
        kujiSlotNumber: 1,
      },
    );
    const kujiConsumeReplay = await consumeKuji();
    assert.equal(kujiConsumeReplay.statusCode, 200, kujiConsumeReplay.body);
    assert.equal(kujiConsumeReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(kujiConsumeReplay.json(), kujiResult);

    const completedRecovery = await readKujiRecovery();
    assert.equal(completedRecovery.roomState, "COMPLETED");
    assert.equal(completedRecovery.drawingExpiresAt, unboundRecovery.drawingExpiresAt);
    assert.deepEqual(completedRecovery.entitlementIds, []);
    assert.deepEqual(completedRecovery.bindings, []);

    const kujiPersisted = await ownerPool.query<{
      room_state: string;
      binding_state: string;
      selection_algorithm: string;
      inventory_owner_id: string;
      inventory_source_type: string;
      point_balance: number;
      payment_provider: string;
    }>(
      `SELECT room.state AS room_state,binding.state AS binding_state,
              result.selection_algorithm,inventory.owner_id AS inventory_owner_id,
              inventory.source_type AS inventory_source_type,points.balance AS point_balance,
              payment.provider AS payment_provider
         FROM kuji_room_entries AS room
         JOIN orders AS orders ON orders.id=room.order_id
         JOIN payments AS payment ON payment.order_id=orders.id
         JOIN point_accounts AS points ON points.user_id=orders.user_id
         JOIN draw_results AS result ON result.entitlement_id=$2
         JOIN inventory_units AS inventory ON inventory.id=result.prize_inventory_unit_id
         JOIN kuji_slot_bindings AS binding ON binding.id=result.kuji_slot_binding_id
        WHERE room.id=$1`,
      [kujiRoomEntryId, kujiEntitlementId],
    );
    assert.deepEqual(kujiPersisted.rows[0], {
      room_state: "COMPLETED",
      binding_state: "CONSUMED",
      selection_algorithm: "KUJI_SEALED_SLOT_V1",
      inventory_owner_id: kujiUser.userId,
      inventory_source_type: "KUJI",
      point_balance: 0,
      payment_provider: "INTERNAL_ZERO",
    });
  },
);
