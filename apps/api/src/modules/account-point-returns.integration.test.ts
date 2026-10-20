import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "disabled point returns preserve legacy stored draws, balances and ledgers",
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
      const created = response.json() as { token: string; actor: { userId: string } };
      await acceptRequiredPoliciesForIntegrationTest(pool, created.actor.userId);
      return created;
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
         ($5,$6,$7,'figure','0원 등록 경품',0,true),
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
    const drawDefinition = new Map<"GACHA", { productId: string; versionId: string; entries: Map<string, string> }>();
    for (const [sourceType, productId] of [
      ["GACHA", gachaProductId],
    ] as const) {
      const version = await pool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
        [productId],
      );
      const entries = new Map<string, string>();
      for (const [prizeId, prizeName, prizeSku] of [
        [prizeOddId, "홀수 기준가 경품", `POINT-ODD-${suffix.toUpperCase()}`],
        [prizeEvenId, "짝수 기준가 경품", `POINT-EVEN-${suffix.toUpperCase()}`],
        [prizeZeroId, "0원 등록 경품", `POINT-ZERO-${suffix.toUpperCase()}`],
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
      await pool.query(
        "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
        [version.rows[0]!.id, owner.actor.userId],
      );
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
      sourceType: "GACHA";
      prizeProductId?: string;
      status?: InventoryStatus;
      unitPrice?: number;
    }) => {
      const definition = drawDefinition.get(input.sourceType)!;
      const prizeProductId = input.prizeProductId ?? prizeEvenId;
      const unitPrice = input.unitPrice ?? 1000;
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',$2,$2,now()) RETURNING id`,
        [input.drawUserId, unitPrice],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(
           order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
           unit_price,quantity,line_total
         ) VALUES($1,$2,$3,$4,$5,$6,1,$6) RETURNING id`,
        [
          order.rows[0]!.id,
          definition.productId,
          `환급 테스트 ${input.sourceType === "GACHA" ? "가챠" : "쿠지"}`,
          input.sourceType === "GACHA" ? "gacha" : "kuji",
          definition.versionId,
          unitPrice,
        ],
      );
      const entitlement = await pool.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
           order_line_id,user_id,product_id,probability_version_id
         ) VALUES($1,$2,$3,$4) RETURNING id`,
        [line.rows[0]!.id, input.drawUserId, definition.productId, definition.versionId],
      );
      const inventoryId = await addInventory(
        input.drawUserId,
        prizeProductId,
        input.sourceType,
        "OWNED",
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
      await pool.query(
        "UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1",
        [entitlement.rows[0]!.id],
      );
      if (input.currentOwnerId !== undefined || (input.status !== undefined && input.status !== "OWNED")) {
        await pool.query(
          "UPDATE inventory_units SET owner_id=$2,status=$3 WHERE id=$1",
          [inventoryId, input.currentOwnerId ?? input.drawUserId, input.status ?? "OWNED"],
        );
      }
      return inventoryId;
    };
    const addKujiInventory = async (input: {
      ownerId: string;
      currentOwnerId?: string;
      status?: InventoryStatus;
    }) => addInventory(
      input.currentOwnerId ?? input.ownerId,
      prizeEvenId,
      "KUJI",
      input.status,
      randomUUID(),
    );
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

    const oddInventoryId = await addDrawInventory({drawUserId:owner.actor.userId,sourceType:"GACHA",prizeProductId:prizeOddId});
    const evenInventoryId = await addDrawInventory({drawUserId:owner.actor.userId,sourceType:"GACHA",prizeProductId:prizeEvenId});
    const before = await pool.query("SELECT * FROM point_ledger_entries WHERE user_id=$1",[owner.actor.userId]);
    const inventory = await app.inject({method:"GET",url:"/v1/account/inventory?limit=50",headers:{authorization:`Bearer ${owner.token}`}});
    assert.equal(inventory.statusCode,200,inventory.body);
    for(const item of inventory.json().items)assert.equal(item.pointReturnEligible,false);
    for(const key of [randomUUID(),randomUUID()]) {
      const response=await returnPoints(owner.token,[oddInventoryId,evenInventoryId],key);
      assert.equal(response.statusCode,503,response.body);
      assert.equal(response.json().error.code,"FEATURE_UNAVAILABLE");
    }
    assert.deepEqual((await pool.query("SELECT * FROM point_ledger_entries WHERE user_id=$1",[owner.actor.userId])).rows,before.rows);
    assert.ok((await pool.query("SELECT status FROM inventory_units WHERE id=ANY($1::uuid[])",[[oddInventoryId,evenInventoryId]])).rows.every(row=>row.status==='OWNED'));
  },
);
