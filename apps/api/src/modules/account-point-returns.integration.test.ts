import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "inventory point returns credit original stored GACHA draws exactly once and reject every other source or state",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-point-return-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "point-return-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const session = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as { token: string; actor: { userId: string } };
    };
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const owner = await session(`point-return-owner-${suffix}@example.test`);
    const recipient = await session(`point-return-recipient-${suffix}@example.test`);
    const overflowOwner = await session(`point-return-overflow-${suffix}@example.test`);
    const ipId = `point-return-ip-${suffix}`;
    const prizeOddId = `point-return-prize-odd-${suffix}`;
    const prizeEvenId = `point-return-prize-even-${suffix}`;
    const prizeZeroId = `point-return-prize-zero-${suffix}`;
    const gachaProductId = `point-return-gacha-${suffix}`;
    const kujiProductId = `point-return-kuji-${suffix}`;

    await pool.query(
      `INSERT INTO catalog_ips(id,slug,name_ko,name_en)
       VALUES($1,$2,'포인트 환급 테스트','Point Return Test')`,
      [ipId, ipId],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES
         ($1,$2,$7,'figure','홀수 기준가 경품',9999,true),
         ($3,$4,$7,'figure','짝수 기준가 경품',2000,true),
         ($5,$6,$7,'figure','0P 환급 경품',1,true),
         ($8,$9,$7,'gacha','환급 테스트 가챠',1000,false),
         ($10,$11,$7,'kuji','환급 테스트 쿠지',1000,false)`,
      [
        prizeOddId,
        `POINT-ODD-${suffix.toUpperCase()}`,
        prizeEvenId,
        `POINT-EVEN-${suffix.toUpperCase()}`,
        prizeZeroId,
        `POINT-ZERO-${suffix.toUpperCase()}`,
        ipId,
        gachaProductId,
        `POINT-GACHA-${suffix.toUpperCase()}`,
        kujiProductId,
        `POINT-KUJI-${suffix.toUpperCase()}`,
      ],
    );

    type SourceType = "GACHA" | "KUJI";
    type InventoryStatus =
      | "OWNED"
      | "EXCHANGE_LISTED"
      | "EXCHANGE_OFFERED"
      | "SHIPPING"
      | "DELIVERED"
      | "TRANSFERRED"
      | "REFUNDED";
    const drawDefinition = new Map<SourceType, { productId: string; versionId: string; entries: Map<string, string> }>();
    for (const [sourceType, productId] of [
      ["GACHA", gachaProductId],
      ["KUJI", kujiProductId],
    ] as const) {
      const version = await pool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
        [productId],
      );
      const entries = new Map<string, string>();
      for (const [prizeId, prizeName, prizeSku] of [
        [prizeOddId, "홀수 기준가 경품", `POINT-ODD-${suffix.toUpperCase()}`],
        [prizeEvenId, "짝수 기준가 경품", `POINT-EVEN-${suffix.toUpperCase()}`],
        [prizeZeroId, "0P 환급 경품", `POINT-ZERO-${suffix.toUpperCase()}`],
      ] as const) {
        const entry = await pool.query<{ id: string }>(
          `INSERT INTO draw_pool_entries(
             probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
             prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight
           ) VALUES($1,$2,$3,NULL,$4,$5,'figure','A',1) RETURNING id`,
          [version.rows[0]!.id, prizeId, prizeName, prizeSku, ipId],
        );
        entries.set(prizeId, entry.rows[0]!.id);
      }
      drawDefinition.set(sourceType, { productId, versionId: version.rows[0]!.id, entries });
    }

    const addInventory = async (
      actorId: string,
      productId: string,
      sourceType: "ADMIN_ADJUSTMENT" | SourceType | "PURCHASE",
      status: InventoryStatus = "OWNED",
      sourceId: string | null = null,
    ) => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [actorId, productId, sourceType, sourceId, status],
      );
      return result.rows[0]!.id;
    };
    const addDrawInventory = async (input: {
      drawUserId: string;
      currentOwnerId?: string;
      sourceType: SourceType;
      prizeProductId?: string;
      status?: InventoryStatus;
    }) => {
      const definition = drawDefinition.get(input.sourceType)!;
      const prizeProductId = input.prizeProductId ?? prizeEvenId;
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',1000,1000,now()) RETURNING id`,
        [input.drawUserId],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(
           order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
           unit_price,quantity,line_total
         ) VALUES($1,$2,$3,$4,$5,1000,1,1000) RETURNING id`,
        [
          order.rows[0]!.id,
          definition.productId,
          `환급 테스트 ${input.sourceType === "GACHA" ? "가챠" : "쿠지"}`,
          input.sourceType === "GACHA" ? "gacha" : "kuji",
          definition.versionId,
        ],
      );
      const entitlement = await pool.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
           order_line_id,user_id,product_id,probability_version_id,status,consumed_at
         ) VALUES($1,$2,$3,$4,'CONSUMED',now()) RETURNING id`,
        [line.rows[0]!.id, input.drawUserId, definition.productId, definition.versionId],
      );
      const inventoryId = await addInventory(
        input.currentOwnerId ?? input.drawUserId,
        prizeProductId,
        input.sourceType,
        input.status,
        entitlement.rows[0]!.id,
      );
      await pool.query(
        `INSERT INTO draw_results(
           entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
           probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,
           selection_snapshot
         ) VALUES($1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,1,'[]'::jsonb)`,
        [
          entitlement.rows[0]!.id,
          input.drawUserId,
          definition.productId,
          definition.entries.get(prizeProductId),
          prizeProductId,
          inventoryId,
          "0".repeat(64),
          "1".repeat(64),
        ],
      );
      return inventoryId;
    };
    const returnPoints = (
      token: string,
      inventoryUnitIds: string[],
      key = `point-return-${randomUUID()}`,
    ) => app.inject({
      method: "POST",
      url: "/v1/account/point-returns",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
      payload: { inventoryUnitIds },
    });

    const oddInventoryId = await addDrawInventory({
      drawUserId: owner.actor.userId,
      sourceType: "GACHA",
      prizeProductId: prizeOddId,
    });
    const evenInventoryId = await addDrawInventory({
      drawUserId: owner.actor.userId,
      sourceType: "GACHA",
      prizeProductId: prizeEvenId,
    });
    const inventoryUnitIds = [oddInventoryId, evenInventoryId].sort((left, right) => left.localeCompare(right, "en-US"));
    const idempotencyKey = `point-return-success-${randomUUID()}`;
    const response = await returnPoints(owner.token, [oddInventoryId, evenInventoryId], idempotencyKey);
    assert.equal(response.statusCode, 201, response.body);
    const result = response.json() as {
      id: string;
      inventoryUnitIds: string[];
      totalPointAmount: number;
      balance: number;
      returnedAt: string;
    };
    assert.deepEqual(result.inventoryUnitIds, inventoryUnitIds);
    assert.equal(result.totalPointAmount, 5_999);
    assert.equal(result.balance, 5_999);
    assert.equal(Number.isNaN(Date.parse(result.returnedAt)), false);

    const inventory = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [inventoryUnitIds],
    );
    assert.deepEqual(inventory.rows, inventoryUnitIds.map((id) => ({ id, status: "POINT_RETURNED" })));
    const header = await pool.query<{ user_id: string; total_point_amount: number }>(
      "SELECT user_id,total_point_amount FROM inventory_point_returns WHERE id=$1",
      [result.id],
    );
    assert.deepEqual(header.rows, [{ user_id: owner.actor.userId, total_point_amount: 5_999 }]);
    const items = await pool.query<{
      inventory_unit_id: string;
      reference_amount: number;
      point_amount: number;
    }>(
      `SELECT inventory_unit_id,reference_amount,point_amount
       FROM inventory_point_return_items WHERE point_return_id=$1 ORDER BY inventory_unit_id`,
      [result.id],
    );
    assert.deepEqual(
      items.rows.map((item) => [item.inventory_unit_id, item.reference_amount, item.point_amount]),
      inventoryUnitIds.map((id) => id === oddInventoryId ? [id, 9_999, 4_999] : [id, 2_000, 1_000]),
    );
    const ledger = await pool.query<{ entry_type: string; amount: number; reference_type: string; reference_id: string }>(
      `SELECT entry_type,amount,reference_type,reference_id FROM point_ledger_entries
       WHERE user_id=$1 AND reference_type='INVENTORY_POINT_RETURN'`,
      [owner.actor.userId],
    );
    assert.deepEqual(ledger.rows, [{
      entry_type: "EARN",
      amount: 5_999,
      reference_type: "INVENTORY_POINT_RETURN",
      reference_id: result.id,
    }]);
    const account = await pool.query<{ balance: number }>(
      "SELECT balance FROM point_accounts WHERE user_id=$1",
      [owner.actor.userId],
    );
    assert.deepEqual(account.rows, [{ balance: 5_999 }]);
    const outbox = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM outbox_events
       WHERE aggregate_type='INVENTORY_POINT_RETURN' AND aggregate_id=$1 AND event_type='inventory.point_returned'`,
      [result.id],
    );
    assert.equal(outbox.rows[0]!.count, 1);
    const completedKey = await pool.query<{ state: string; resource_type: string; resource_id: string }>(
      `SELECT state,resource_type,resource_id FROM idempotency_keys
       WHERE actor_id=$1 AND scope='ACCOUNT_POINT_RETURN_CREATE' AND idempotency_key=$2`,
      [owner.actor.userId, idempotencyKey],
    );
    assert.deepEqual(completedKey.rows, [{
      state: "COMPLETED",
      resource_type: "INVENTORY_POINT_RETURN",
      resource_id: result.id,
    }]);

    const replay = await returnPoints(owner.token, [oddInventoryId, evenInventoryId], idempotencyKey);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(replay.json(), result);
    const sideEffectsAfterReplay = await pool.query<{
      return_count: number;
      item_count: number;
      ledger_count: number;
      outbox_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM inventory_point_returns WHERE id=$1) AS return_count,
         (SELECT count(*)::integer FROM inventory_point_return_items WHERE point_return_id=$1) AS item_count,
         (SELECT count(*)::integer FROM point_ledger_entries
           WHERE user_id=$2 AND reference_type='INVENTORY_POINT_RETURN' AND reference_id=$1::text) AS ledger_count,
         (SELECT count(*)::integer FROM outbox_events
           WHERE aggregate_type='INVENTORY_POINT_RETURN' AND aggregate_id=$1::text) AS outbox_count`,
      [result.id, owner.actor.userId],
    );
    assert.deepEqual(sideEffectsAfterReplay.rows, [{
      return_count: 1,
      item_count: 2,
      ledger_count: 1,
      outbox_count: 1,
    }]);
    const secondRequest = await returnPoints(owner.token, inventoryUnitIds);
    assert.equal(secondRequest.statusCode, 409, secondRequest.body);

    const directKujiInventoryId = await addDrawInventory({
      drawUserId: owner.actor.userId,
      sourceType: "KUJI",
    });
    const ineligibleInventoryIds = [
      await addInventory(owner.actor.userId, prizeEvenId, "GACHA"),
      await addInventory(owner.actor.userId, prizeEvenId, "KUJI"),
      await addInventory(owner.actor.userId, prizeEvenId, "PURCHASE"),
      await addInventory(owner.actor.userId, prizeEvenId, "ADMIN_ADJUSTMENT"),
      directKujiInventoryId,
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "GACHA", status: "EXCHANGE_LISTED" }),
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "GACHA", status: "EXCHANGE_OFFERED" }),
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "KUJI", status: "SHIPPING" }),
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "KUJI", status: "DELIVERED" }),
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "GACHA", status: "TRANSFERRED" }),
      await addDrawInventory({ drawUserId: owner.actor.userId, sourceType: "GACHA", status: "REFUNDED" }),
      await addDrawInventory({
        drawUserId: owner.actor.userId,
        currentOwnerId: recipient.actor.userId,
        sourceType: "KUJI",
      }),
    ];
    for (const inventoryId of ineligibleInventoryIds.slice(0, -1)) {
      const rejected = await returnPoints(owner.token, [inventoryId]);
      assert.equal(rejected.statusCode, 409, rejected.body);
    }
    const kujiAfterRejection = await pool.query<{ status: string; return_count: number }>(
      `SELECT inventory.status,
         (SELECT count(*)::integer FROM inventory_point_return_items item
          WHERE item.inventory_unit_id=inventory.id) AS return_count
       FROM inventory_units inventory WHERE inventory.id=$1`,
      [directKujiInventoryId],
    );
    assert.deepEqual(kujiAfterRejection.rows, [{ status: "OWNED", return_count: 0 }]);
    const transferredOwnerRejected = await returnPoints(recipient.token, [ineligibleInventoryIds.at(-1)!]);
    assert.equal(transferredOwnerRejected.statusCode, 409, transferredOwnerRejected.body);

    const validRollbackInventoryId = await addDrawInventory({
      drawUserId: owner.actor.userId,
      sourceType: "GACHA",
      prizeProductId: prizeEvenId,
    });
    const zeroInventoryId = await addDrawInventory({
      drawUserId: owner.actor.userId,
      sourceType: "GACHA",
      prizeProductId: prizeZeroId,
    });
    const zeroPointBatch = await returnPoints(owner.token, [validRollbackInventoryId, zeroInventoryId]);
    assert.equal(zeroPointBatch.statusCode, 409, zeroPointBatch.body);
    assert.match(zeroPointBatch.body, /0P/);
    const rolledBackInventory = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[validRollbackInventoryId, zeroInventoryId]],
    );
    assert.deepEqual(rolledBackInventory.rows.map((row) => row.status), ["OWNED", "OWNED"]);

    const overflowInventoryId = await addDrawInventory({
      drawUserId: overflowOwner.actor.userId,
      sourceType: "GACHA",
      prizeProductId: prizeEvenId,
    });
    await pool.query(
      "INSERT INTO point_accounts(user_id,balance) VALUES($1,2147483147)",
      [overflowOwner.actor.userId],
    );
    const balanceOverflow = await returnPoints(overflowOwner.token, [overflowInventoryId]);
    assert.equal(balanceOverflow.statusCode, 409, balanceOverflow.body);
    assert.match(balanceOverflow.body, /보유 한도/);
    const overflowState = await pool.query<{ status: string; balance: number; return_count: number }>(
      `SELECT inventory.status,account.balance,
         (SELECT count(*)::integer FROM inventory_point_return_items WHERE inventory_unit_id=inventory.id) AS return_count
       FROM inventory_units inventory
       JOIN point_accounts account ON account.user_id=inventory.owner_id
       WHERE inventory.id=$1`,
      [overflowInventoryId],
    );
    assert.deepEqual(overflowState.rows, [{ status: "OWNED", balance: 2_147_483_147, return_count: 0 }]);
  },
);
