import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import {
  acceptRequiredPoliciesForIntegrationTest,
  acceptUgcOperationsPolicyForIntegrationTest,
} from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

const BLOCKED_MESSAGE = "부적절한 표현이나 외부 연락처가 포함되어 등록할 수 없어요.";

test(
  "public exchange and request-room text is filtered before any write while private inquiries stay open",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-content-filter-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "content-filter-integration-session-pepper",
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

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-session",
      payload: { email: `content-filter-${suffix}@example.test` },
    });
    assert.equal(sessionResponse.statusCode, 201, sessionResponse.body);
    const session = sessionResponse.json() as { token: string; actor: { userId: string; nickname: string } };
    const userId = session.actor.userId;
    await acceptRequiredPoliciesForIntegrationTest(pool, userId);
    await acceptUgcOperationsPolicyForIntegrationTest(pool, userId);
    const send = (method: "POST" | "PATCH", url: string, payload: Record<string, unknown>) => app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload,
    });
    const assertBlocked = (response: Awaited<ReturnType<typeof send>>) => {
      assert.equal(response.statusCode, 400, response.body);
      const body = response.json() as { error: { code: string; message: string; details?: unknown } };
      assert.equal(body.error.code, "CONTENT_NOT_ALLOWED");
      assert.equal(body.error.message, BLOCKED_MESSAGE);
      assert.equal(body.error.details, undefined);
    };
    const count = async (sql: string, values: unknown[]) => {
      const result = await pool.query<{ count: string }>(sql, values);
      return Number(result.rows[0]!.count);
    };

    // One directly drawn, still-stored gacha prize so an allowed listing can succeed.
    const ipId = `content-filter-ip-${suffix}`;
    const prizeProductId = `content-filter-prize-${suffix}`;
    const gachaProductId = `content-filter-gacha-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `필터 테스트 ${suffix}`, `Content filter ${suffix}`],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES($1,$2,$5,'figure','필터 테스트 상품',1000,true),
             ($3,$4,$5,'gacha','필터 테스트 가챠',1000,false)`,
      [prizeProductId, `FILTER-PRIZE-${suffix}`, gachaProductId, `FILTER-GACHA-${suffix}`, ipId],
    );
    const version = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
      [gachaProductId],
    );
    const versionId = version.rows[0]!.id;
    const poolEntry = await pool.query<{ id: string }>(
      `INSERT INTO draw_pool_entries(
        probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
        prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight
      ) VALUES($1,$2,'필터 테스트 상품',NULL,$3,$4,'figure','A',1) RETURNING id`,
      [versionId, prizeProductId, `FILTER-PRIZE-${suffix}`, ipId],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [versionId, userId],
    );
    const order = await pool.query<{ id: string }>(
      "INSERT INTO orders(user_id,status,subtotal,total,paid_at) VALUES($1,'PAID',1000,1000,now()) RETURNING id",
      [userId],
    );
    const line = await pool.query<{ id: string }>(
      `INSERT INTO order_lines(
        order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
        unit_price,quantity,line_total
      ) VALUES($1,$2,'필터 테스트 가챠','gacha',$3,1000,1,1000) RETURNING id`,
      [order.rows[0]!.id, gachaProductId, versionId],
    );
    const entitlement = await pool.query<{ id: string }>(
      "INSERT INTO draw_entitlements(order_line_id,user_id,product_id,probability_version_id) VALUES($1,$2,$3,$4) RETURNING id",
      [line.rows[0]!.id, userId, gachaProductId, versionId],
    );
    const inventory = await pool.query<{ id: string }>(
      `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status)
       VALUES($1,$2,'GACHA',$3,'OWNED') RETURNING id`,
      [userId, prizeProductId, entitlement.rows[0]!.id],
    );
    const inventoryId = inventory.rows[0]!.id;
    await pool.query(
      `INSERT INTO draw_results(
        entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
        probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,
        selection_snapshot
      ) VALUES($1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,1,'[]'::jsonb)`,
      [
        entitlement.rows[0]!.id,
        userId,
        gachaProductId,
        poolEntry.rows[0]!.id,
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

    // Exchange listing: objectionable title and a phone number in details are rejected.
    assertBlocked(await send("POST", "/v1/exchange/listings", {
      title: "씨발 급처 교환",
      details: "빠르게 교환해요",
      offeredInventoryUnitIds: [inventoryId],
    }));
    assertBlocked(await send("POST", "/v1/exchange/listings", {
      title: "필터 테스트 상품 교환",
      details: "010-1234-5678 로 문자 주세요",
      offeredInventoryUnitIds: [inventoryId],
    }));
    assert.equal(await count("SELECT count(*) FROM exchange_listings WHERE author_id=$1", [userId]), 0);
    assert.equal(
      await count(
        "SELECT count(*) FROM idempotency_keys WHERE actor_id=$1 AND scope='exchange.listing.create'",
        [userId],
      ),
      0,
    );
    assert.equal(
      (await pool.query<{ status: string }>("SELECT status FROM inventory_units WHERE id=$1", [inventoryId])).rows[0]!.status,
      "OWNED",
    );
    const allowedListing = await send("POST", "/v1/exchange/listings", {
      title: "필터 테스트 상품 1:1 교환",
      details: "12,000원 상당 · 1/8 스케일 · 2024년 발매",
      offeredInventoryUnitIds: [inventoryId],
    });
    assert.equal(allowedListing.statusCode, 201, allowedListing.body);

    // Request room: objectionable item and a phone number in details are rejected.
    const wantedBase = { category: "gacha", ipId, desiredItem: "필터 테스트 가챠 전종", details: "다시 발매해 주세요." };
    assertBlocked(await send("POST", "/v1/wanted-requests", { ...wantedBase, desiredItem: "시 발 굿즈" }));
    assertBlocked(await send("POST", "/v1/wanted-requests", { ...wantedBase, details: "연락은 01012345678 로 주세요" }));
    assertBlocked(await send("POST", "/v1/wanted-requests", {
      ...wantedBase,
      ipId: null,
      ipNameKo: "open.kakao.com/o/abc",
    }));
    assert.equal(await count("SELECT count(*) FROM wanted_requests WHERE user_id=$1", [userId]), 0);
    assert.equal(
      await count("SELECT count(*) FROM idempotency_keys WHERE actor_id=$1 AND scope='WANTED_REQUEST_CREATE'", [userId]),
      0,
    );
    const allowedWanted = await send("POST", "/v1/wanted-requests", wantedBase);
    assert.equal(allowedWanted.statusCode, 201, allowedWanted.body);
    const wantedId = (allowedWanted.json() as { id: string }).id;
    assertBlocked(await send("PATCH", `/v1/wanted-requests/${wantedId}`, {
      expectedVersion: 1,
      details: "카톡 아이디 dabboba 로 연락 주세요",
    }));
    const storedWanted = await pool.query<{ details: string; version: number }>(
      "SELECT details,version FROM wanted_requests WHERE id=$1",
      [wantedId],
    );
    assert.deepEqual(storedWanted.rows[0], { details: "다시 발매해 주세요.", version: 1 });

    // Public nickname: objectionable text is rejected and the stored nickname is unchanged.
    assertBlocked(await send("PATCH", "/v1/account/profile", { nickname: "병 신", expectedVersion: 1 }));
    const storedNickname = await pool.query<{ nickname: string }>("SELECT nickname FROM users WHERE id=$1", [userId]);
    assert.equal(storedNickname.rows[0]!.nickname, session.actor.nickname);

    // A private support inquiry with the same text must always be accepted.
    const inquiryTitle = "씨발 결제가 안 돼요";
    const inquiryContent = "010-1234-5678 로 연락 주세요. https://example.com 화면이 멈춰요.";
    const inquiry = await send("POST", "/v1/inquiries", {
      category: "ERROR",
      title: inquiryTitle,
      content: inquiryContent,
    });
    assert.equal(inquiry.statusCode, 201, inquiry.body);
    const inquiryId = (inquiry.json() as { id: string }).id;
    const storedInquiry = await pool.query<{ title: string; content: string }>(
      `SELECT i.title,m.content FROM inquiries i JOIN inquiry_messages m ON m.inquiry_id=i.id
       WHERE i.id=$1 AND i.user_id=$2`,
      [inquiryId, userId],
    );
    assert.deepEqual(storedInquiry.rows[0], { title: inquiryTitle, content: inquiryContent });
    const followUp = await send("POST", `/v1/inquiries/${inquiryId}/messages`, { content: "카톡 아이디 dabboba 입니다" });
    assert.equal(followUp.statusCode, 201, followUp.body);
  },
);
