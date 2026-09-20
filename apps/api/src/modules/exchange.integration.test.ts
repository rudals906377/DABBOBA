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
import { tokenDigest } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "exchange lifecycle serializes acceptance, swaps ownership, and releases cancelled reservations",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-exchange-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "exchange-integration-session-pepper-value",
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
      const created = response.json() as { token: string; actor: { userId: string; nickname: string } };
      await acceptRequiredPoliciesForIntegrationTest(pool, created.actor.userId);
      await acceptUgcOperationsPolicyForIntegrationTest(pool, created.actor.userId);
      return created;
    };
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `exchange-test-ip-${suffix}`;
    const productId = `exchange-test-product-${suffix}`;
    const gachaDrawProductId = `exchange-test-gacha-${suffix}`;
    const kujiDrawProductId = `exchange-test-kuji-${suffix}`;
    const author = await session(`exchange-author-${suffix}@example.test`);
    const proposerOne = await session(`exchange-one-${suffix}@example.test`);
    const proposerTwo = await session(`exchange-two-${suffix}@example.test`);

    await pool.query(
      `INSERT INTO catalog_ips(id,slug,name_ko,name_en,aliases)
       VALUES($1,$2,'교환 테스트','Exchange Test',ARRAY['교환별칭'])`,
      [ipId, ipId],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
       VALUES
         ($1,$2,$3,'figure','교환 테스트 상품',0,true),
         ($4,$5,$3,'gacha','교환 테스트 가챠',1000,false),
         ($6,$7,$3,'kuji','교환 테스트 쿠지',1000,false)`,
      [
        productId,
        `EXCHANGE-${suffix.toUpperCase()}`,
        ipId,
        gachaDrawProductId,
        `EXCHANGE-GACHA-${suffix.toUpperCase()}`,
        kujiDrawProductId,
        `EXCHANGE-KUJI-${suffix.toUpperCase()}`,
      ],
    );
    await pool.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,20,0)",
      [productId],
    );

    const createDrawDefinition = async (drawProductId: string) => {
      const version = await pool.query<{ id: string }>(
        "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,1) RETURNING id",
        [drawProductId],
      );
      const poolEntry = await pool.query<{ id: string }>(
        `INSERT INTO draw_pool_entries(
          probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
          prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight
        ) VALUES($1,$2,'교환 테스트 상품',NULL,$3,$4,'figure','A',1) RETURNING id`,
        [version.rows[0]!.id, productId, `EXCHANGE-${suffix.toUpperCase()}`, ipId],
      );
      await pool.query(
        "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
        [version.rows[0]!.id, author.actor.userId],
      );
      return {
        drawProductId,
        poolEntryId: poolEntry.rows[0]!.id,
        versionId: version.rows[0]!.id,
      };
    };
    const gachaDrawDefinition = await createDrawDefinition(gachaDrawProductId);

    const addInventory = async (
      ownerId: string,
      sourceType: "ADMIN_ADJUSTMENT" | "GACHA" | "KUJI" | "PURCHASE",
      status: "OWNED" | "SHIPPING" | "DELIVERED" = "OWNED",
    ) => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO inventory_units(owner_id,product_id,source_type,status)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [ownerId, productId, sourceType, status],
      );
      return result.rows[0]!.id;
    };
    const addDrawInventory = async (
      ownerId: string,
      sourceType: "GACHA" | "KUJI",
      status: "OWNED" | "SHIPPING" | "DELIVERED" = "OWNED",
      overrides: {
        sourceId?: string | null;
        inventoryProductId?: string;
        drawOwnerId?: string;
        drawPrizeProductId?: string;
      } = {},
    ) => {
      if (sourceType === "KUJI") {
        return addInventory(ownerId, "KUJI", status);
      }
      const definition = gachaDrawDefinition;
      const drawOwnerId = overrides.drawOwnerId ?? ownerId;
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',1000,1000,now()) RETURNING id`,
        [drawOwnerId],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(
          order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
          unit_price,quantity,line_total
        ) VALUES($1,$2,$3,$4,$5,1000,1,1000) RETURNING id`,
        [
          order.rows[0]!.id,
          definition.drawProductId,
          "교환 테스트 가챠",
          "gacha",
          definition.versionId,
        ],
      );
      const entitlement = await pool.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
          order_line_id,user_id,product_id,probability_version_id
        ) VALUES($1,$2,$3,$4) RETURNING id`,
        [line.rows[0]!.id, drawOwnerId, definition.drawProductId, definition.versionId],
      );
      const inventory = await pool.query<{ id: string }>(
        `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status)
         VALUES($1,$2,'GACHA',$3,'OWNED') RETURNING id`,
        [
          drawOwnerId,
          productId,
          entitlement.rows[0]!.id,
        ],
      );
      const inventoryId = inventory.rows[0]!.id;
      await pool.query(
        `INSERT INTO draw_results(
          entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
          probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,
          selection_snapshot
        ) VALUES(
          $1,$2,$3,$4,$5,$6,1,'SHA256_REJECTION_V1',$7,$8,0,1,'[]'::jsonb
        )`,
        [
          entitlement.rows[0]!.id,
          drawOwnerId,
          definition.drawProductId,
          definition.poolEntryId,
          productId,
          inventoryId,
          "0".repeat(64),
          "1".repeat(64),
        ],
      );
      await pool.query(
        "UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1",
        [entitlement.rows[0]!.id],
      );
      if (
        drawOwnerId !== ownerId
        || status !== "OWNED"
        || overrides.sourceId !== undefined
        || overrides.inventoryProductId !== undefined
        || overrides.drawPrizeProductId !== undefined
      ) {
        await pool.query(
          `UPDATE inventory_units
           SET owner_id=$2,product_id=$3,source_id=$4,status=$5
           WHERE id=$1`,
          [
            inventoryId,
            ownerId,
            overrides.inventoryProductId
              ?? (overrides.drawPrizeProductId === undefined ? productId : gachaDrawProductId),
            overrides.sourceId === undefined ? entitlement.rows[0]!.id : overrides.sourceId,
            status,
          ],
        );
      }
      return inventoryId;
    };
    const mutate = (
      token: string,
      method: "POST",
      url: string,
      payload: Record<string, unknown> | undefined,
      key = randomUUID(),
      extraHeaders: Record<string, string> = {},
    ) => app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key, ...extraHeaders },
      ...(payload ? { payload } : {}),
    });
    const completeBundleExchange = async (input: {
      label: string;
      listingInventoryIds: string[];
      proposer: { token: string; actor: { userId: string } };
      offerInventoryIds: string[];
    }) => {
      const listingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
        title: `${input.label} 교환 테스트`,
        details: `${input.label} 묶음 전체의 소유권이 원자적으로 이전되어야 합니다.`,
        offeredInventoryUnitIds: input.listingInventoryIds,
      });
      assert.equal(listingResponse.statusCode, 201, listingResponse.body);
      const listingId = (listingResponse.json() as { id: string }).id;
      const offerResponse = await mutate(
        input.proposer.token,
        "POST",
        `/v1/exchange/listings/${listingId}/offers`,
        { offeredInventoryUnitIds: input.offerInventoryIds },
      );
      assert.equal(offerResponse.statusCode, 201, offerResponse.body);
      const offerId = (offerResponse.json() as { id: string }).id;
      const accepted = await mutate(
        author.token,
        "POST",
        `/v1/exchange/listings/${listingId}/offers/${offerId}/decision`,
        { decision: "ACCEPTED" },
      );
      assert.equal(accepted.statusCode, 200, accepted.body);
      const authorConfirmed = await mutate(
        author.token,
        "POST",
        `/v1/exchange/listings/${listingId}/completion-confirmation`,
        undefined,
      );
      assert.equal(authorConfirmed.statusCode, 200, authorConfirmed.body);
      const proposerConfirmed = await mutate(
        input.proposer.token,
        "POST",
        `/v1/exchange/listings/${listingId}/completion-confirmation`,
        undefined,
      );
      assert.equal(proposerConfirmed.statusCode, 200, proposerConfirmed.body);
      assert.equal((proposerConfirmed.json() as { status: string }).status, "COMPLETED");

      const inventory = await pool.query<{ id: string; owner_id: string; status: string }>(
        "SELECT id,owner_id,status FROM inventory_units WHERE id=ANY($1::uuid[])",
        [[...input.listingInventoryIds, ...input.offerInventoryIds]],
      );
      const inventoryById = new Map(inventory.rows.map((row) => [row.id, row]));
      for (const inventoryId of input.listingInventoryIds) {
        assert.equal(inventoryById.get(inventoryId)?.owner_id, input.proposer.actor.userId);
        assert.equal(inventoryById.get(inventoryId)?.status, "OWNED");
      }
      for (const inventoryId of input.offerInventoryIds) {
        assert.equal(inventoryById.get(inventoryId)?.owner_id, author.actor.userId);
        assert.equal(inventoryById.get(inventoryId)?.status, "OWNED");
      }
      const ledger = await pool.query<{ count: string }>(
        "SELECT count(*) FROM inventory_ownership_transfers WHERE exchange_listing_id=$1",
        [listingId],
      );
      assert.equal(
        Number(ledger.rows[0]!.count),
        input.listingInventoryIds.length + input.offerInventoryIds.length,
      );
    };

    const listingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const listingInventoryTwo = await addDrawInventory(author.actor.userId, "GACHA");
    const offerOneInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const offerOneInventoryTwo = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const offerTwoInventory = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const offerTwoInventoryTwo = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const expiredStorageInventory = await addDrawInventory(author.actor.userId, "GACHA");
    await pool.query(
      `UPDATE inventory_units
       SET acquired_at=now()-interval '61 days',storage_expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [expiredStorageInventory],
    );
    const expiredStorageListing = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "보관 만료 상품 테스트",
      details: "보관 기간이 끝난 상품은 교환에 예약되면 안 됩니다.",
      offeredInventoryUnitId: expiredStorageInventory,
    });
    assert.equal(expiredStorageListing.statusCode, 409, expiredStorageListing.body);
    assert.match(expiredStorageListing.body, /보관 기간이 만료/);
    const expiredStorageState = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=$1",
      [expiredStorageInventory],
    );
    assert.equal(expiredStorageState.rows[0]!.status, "OWNED");

    const staleListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const staleOfferInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const staleListingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "교환글 만료 테스트",
      details: "만료 뒤에는 제안을 수락할 수 없어야 합니다.",
      offeredInventoryUnitId: staleListingInventory,
    });
    assert.equal(staleListingResponse.statusCode, 201, staleListingResponse.body);
    const staleListingId = (staleListingResponse.json() as { id: string }).id;
    const staleOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${staleListingId}/offers`,
      { offeredInventoryUnitId: staleOfferInventory },
    );
    assert.equal(staleOfferResponse.statusCode, 201, staleOfferResponse.body);
    const staleOfferId = (staleOfferResponse.json() as { id: string }).id;
    await pool.query(
      `UPDATE exchange_listings
       SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day'
       WHERE id=$1`,
      [staleListingId],
    );
    const staleDecision = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${staleListingId}/offers/${staleOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(staleDecision.statusCode, 409, staleDecision.body);
    const staleListingState = await pool.query<{ status: string; cancel_reason: string | null }>(
      "SELECT status,cancel_reason FROM exchange_listings WHERE id=$1",
      [staleListingId],
    );
    assert.deepEqual(staleListingState.rows[0], {
      status: "CANCELLED",
      cancel_reason: "AUTO_EXPIRED",
    });
    const staleOfferState = await pool.query<{ status: string }>(
      "SELECT status FROM exchange_offers WHERE id=$1",
      [staleOfferId],
    );
    assert.equal(staleOfferState.rows[0]!.status, "REJECTED");
    const staleInventoryStates = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[staleListingInventory, staleOfferInventory]],
    );
    assert.equal(staleInventoryStates.rows.length, 2);
    assert.ok(staleInventoryStates.rows.every((row) => row.status === "OWNED"));
    const mismatchedSourceInventory = await addDrawInventory(
      author.actor.userId,
      "GACHA",
      "OWNED",
      { sourceId: randomUUID() },
    );
    const mismatchedPrizeInventory = await addDrawInventory(
      author.actor.userId,
      "GACHA",
      "OWNED",
      { drawPrizeProductId: gachaDrawProductId },
    );
    const mismatchedDrawOwnerInventory = await addDrawInventory(
      author.actor.userId,
      "GACHA",
      "OWNED",
      { drawOwnerId: proposerOne.actor.userId },
    );

    for (const inventoryId of [
      await addInventory(author.actor.userId, "GACHA"),
      await addInventory(author.actor.userId, "KUJI"),
      await addDrawInventory(author.actor.userId, "KUJI"),
      await addInventory(author.actor.userId, "PURCHASE"),
      await addInventory(author.actor.userId, "ADMIN_ADJUSTMENT"),
      await addDrawInventory(author.actor.userId, "GACHA", "SHIPPING"),
      await addDrawInventory(author.actor.userId, "KUJI", "DELIVERED"),
      mismatchedSourceInventory,
      mismatchedPrizeInventory,
      mismatchedDrawOwnerInventory,
    ]) {
      const ineligibleListing = await mutate(author.token, "POST", "/v1/exchange/listings", {
        title: "교환 불가 상품 테스트",
        details: "직접 뽑아 현재 보관 중인 상품만 등록할 수 있어야 합니다.",
        offeredInventoryUnitId: inventoryId,
      });
      assert.equal(ineligibleListing.statusCode, 409, ineligibleListing.body);
      assert.match(ineligibleListing.body, /직접 뽑아 보관함에 보관 중인/);
    }

    const eligibleInventory = await app.inject({
      method: "GET",
      url: "/v1/exchange/inventory?limit=100",
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(eligibleInventory.statusCode, 200, eligibleInventory.body);
    assert.deepEqual(
      (eligibleInventory.json() as { items: Array<{ id: string }> }).items
        .map((item) => item.id)
        .sort(),
      [listingInventory, listingInventoryTwo, staleListingInventory].sort(),
    );

    const storageBoundaryListingInventory = await addDrawInventory(
      author.actor.userId,
      "GACHA",
    );
    const storageBoundaryOfferInventory = await addDrawInventory(
      proposerOne.actor.userId,
      "GACHA",
    );
    const storageBoundaryListingResponse = await mutate(
      author.token,
      "POST",
      "/v1/exchange/listings",
      {
        title: "교환 수락 보관 기한 테스트",
        details: "수락 순간 양쪽 상품의 보관 기한을 다시 확인해야 합니다.",
        offeredInventoryUnitId: storageBoundaryListingInventory,
      },
    );
    assert.equal(
      storageBoundaryListingResponse.statusCode,
      201,
      storageBoundaryListingResponse.body,
    );
    const storageBoundaryListingId = (
      storageBoundaryListingResponse.json() as { id: string }
    ).id;
    const storageBoundaryOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${storageBoundaryListingId}/offers`,
      { offeredInventoryUnitId: storageBoundaryOfferInventory },
    );
    assert.equal(
      storageBoundaryOfferResponse.statusCode,
      201,
      storageBoundaryOfferResponse.body,
    );
    const storageBoundaryOfferId = (
      storageBoundaryOfferResponse.json() as { id: string }
    ).id;

    await pool.query(
      `UPDATE inventory_units
       SET acquired_at=now()-interval '61 days',storage_expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [storageBoundaryOfferInventory],
    );
    const expiredOfferDecision = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${storageBoundaryListingId}/offers/${storageBoundaryOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(expiredOfferDecision.statusCode, 409, expiredOfferDecision.body);
    assert.match(expiredOfferDecision.body, /보관 기간이 만료/);

    const listingExpiryInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const listingExpiryOfferInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const listingExpiryResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "교환 등록 상품 보관 기한 테스트",
      details: "수락 순간 등록 상품의 보관 기한도 다시 확인해야 합니다.",
      offeredInventoryUnitId: listingExpiryInventory,
    });
    assert.equal(listingExpiryResponse.statusCode, 201, listingExpiryResponse.body);
    const listingExpiryId = (listingExpiryResponse.json() as { id: string }).id;
    const listingExpiryOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingExpiryId}/offers`,
      { offeredInventoryUnitId: listingExpiryOfferInventory },
    );
    assert.equal(listingExpiryOfferResponse.statusCode, 201, listingExpiryOfferResponse.body);
    const listingExpiryOfferId = (listingExpiryOfferResponse.json() as { id: string }).id;
    await pool.query(
      `UPDATE inventory_units
       SET acquired_at=now()-interval '61 days',storage_expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [listingExpiryInventory],
    );
    const expiredListingInventoryDecision = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingExpiryId}/offers/${listingExpiryOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(
      expiredListingInventoryDecision.statusCode,
      409,
      expiredListingInventoryDecision.body,
    );
    assert.match(expiredListingInventoryDecision.body, /이미 결정된 교환 글/);

    const storageBoundaryState = await pool.query<{
      listing_status: string;
      offer_status: string;
      listing_inventory_status: string;
      offer_inventory_status: string;
    }>(
      `SELECT listing.status AS listing_status,
              offer.status AS offer_status,
              listing_inventory.status AS listing_inventory_status,
              offer_inventory.status AS offer_inventory_status
         FROM exchange_listings listing
         JOIN exchange_offers offer ON offer.listing_id=listing.id AND offer.id=$2
         JOIN inventory_units listing_inventory ON listing_inventory.id=$3
         JOIN inventory_units offer_inventory ON offer_inventory.id=$4
        WHERE listing.id=$1`,
      [
        listingExpiryId,
        listingExpiryOfferId,
        listingExpiryInventory,
        listingExpiryOfferInventory,
      ],
    );
    assert.deepEqual(storageBoundaryState.rows[0], {
      listing_status: "CANCELLED",
      offer_status: "REJECTED",
      listing_inventory_status: "OWNED",
      offer_inventory_status: "OWNED",
    });

    const forgedListing = await pool.query<{ id: string }>(
      `INSERT INTO exchange_listings(author_id,offered_inventory_unit_id,title,details)
       VALUES($1,$2,'위조 연결 교환글','draw entitlement 연결이 다른 기존 데이터') RETURNING id`,
      [author.actor.userId, mismatchedSourceInventory],
    );
    const forgedListingId = forgedListing.rows[0]!.id;
    await pool.query(
      "UPDATE inventory_units SET status='EXCHANGE_LISTED' WHERE id=$1",
      [mismatchedSourceInventory],
    );
    const publicListingsAfterForgedInsert = await app.inject({
      method: "GET",
      url: "/v1/exchange/listings?limit=100",
    });
    assert.equal(publicListingsAfterForgedInsert.statusCode, 200, publicListingsAfterForgedInsert.body);
    assert.equal(
      (publicListingsAfterForgedInsert.json() as { items: Array<{ id: string }> }).items
        .some((item) => item.id === forgedListingId),
      false,
    );
    const forgedDetail = await app.inject({
      method: "GET",
      url: `/v1/exchange/listings/${forgedListingId}`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(forgedDetail.statusCode, 404, forgedDetail.body);
    const forgedCancellation = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${forgedListingId}/cancel`,
      undefined,
    );
    assert.equal(forgedCancellation.statusCode, 200, forgedCancellation.body);

    const legacyKujiListingInventory = await addDrawInventory(author.actor.userId, "KUJI");
    const legacyKujiListing = await pool.query<{ id: string }>(
      `INSERT INTO exchange_listings(author_id,offered_inventory_unit_id,title,details)
       VALUES($1,$2,'기존 쿠지 교환글','규칙 변경 전 데이터') RETURNING id`,
      [author.actor.userId, legacyKujiListingInventory],
    );
    const legacyKujiListingId = legacyKujiListing.rows[0]!.id;
    await pool.query(
      "UPDATE inventory_units SET status='EXCHANGE_LISTED' WHERE id=$1",
      [legacyKujiListingInventory],
    );
    const publicListingsAfterLegacyInsert = await app.inject({
      method: "GET",
      url: "/v1/exchange/listings?limit=100",
    });
    assert.equal(publicListingsAfterLegacyInsert.statusCode, 200, publicListingsAfterLegacyInsert.body);
    assert.equal(
      (publicListingsAfterLegacyInsert.json() as { items: Array<{ id: string }> }).items
        .some((item) => item.id === legacyKujiListingId),
      false,
    );
    const legacyDetail = await app.inject({
      method: "GET",
      url: `/v1/exchange/listings/${legacyKujiListingId}`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(legacyDetail.statusCode, 404, legacyDetail.body);
    const legacyOfferAttempt = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${legacyKujiListingId}/offers`,
      { offeredInventoryUnitId: await addDrawInventory(proposerOne.actor.userId, "GACHA") },
    );
    assert.equal(legacyOfferAttempt.statusCode, 409, legacyOfferAttempt.body);
    assert.match(legacyOfferAttempt.body, /가챠로 직접 뽑아/);
    const legacyCancellation = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${legacyKujiListingId}/cancel`,
      undefined,
    );
    assert.equal(legacyCancellation.statusCode, 200, legacyCancellation.body);
    assert.equal((legacyCancellation.json() as { status: string }).status, "CANCELLED");
    const legacyInventoryAfterCancellation = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=$1",
      [legacyKujiListingInventory],
    );
    assert.equal(legacyInventoryAfterCancellation.rows[0]!.status, "OWNED");

    const rollbackListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const rollbackInvalidListingInventory = await addDrawInventory(author.actor.userId, "KUJI");
    const rejectedListingBundle = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "묶음 전체 검증 테스트",
      details: "한 상품이라도 부적격이면 아무 상품도 예약되지 않아야 합니다.",
      offeredInventoryUnitIds: [rollbackListingInventory, rollbackInvalidListingInventory],
    });
    assert.equal(rejectedListingBundle.statusCode, 409, rejectedListingBundle.body);
    const rollbackListingState = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[rollbackListingInventory, rollbackInvalidListingInventory]],
    );
    assert.ok(rollbackListingState.rows.every((row) => row.status === "OWNED"));

    const listingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "동시 수락 테스트",
      details: "한 제안만 수락되어야 합니다.",
      offeredInventoryUnitIds: [listingInventory, listingInventoryTwo],
    });
    assert.equal(listingResponse.statusCode, 201, listingResponse.body);
    const createdListing = listingResponse.json() as {
      id: string;
      offeredInventory: { id: string };
      offeredInventories: Array<{ id: string }>;
    };
    const listingId = createdListing.id;
    assert.equal(createdListing.offeredInventory.id, listingInventory);
    assert.deepEqual(
      createdListing.offeredInventories.map((inventory) => inventory.id),
      [listingInventory, listingInventoryTwo],
    );

    for (const query of ["Exchange Test", "교환별칭"]) {
      const searchResponse = await app.inject({
        method: "GET",
        url: `/v1/exchange/listings?q=${encodeURIComponent(query)}`,
      });
      assert.equal(searchResponse.statusCode, 200, searchResponse.body);
      assert.equal(
        (searchResponse.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === listingId),
        true,
        `${query} should find the listing by IP metadata`,
      );
    }

    const forgedOfferInventory = await addDrawInventory(
      proposerTwo.actor.userId,
      "GACHA",
      "OWNED",
      { inventoryProductId: gachaDrawProductId },
    );
    const forgedOffer = await pool.query<{ id: string }>(
      `INSERT INTO exchange_offers(listing_id,proposer_id,offered_inventory_unit_id,message)
       VALUES($1,$2,$3,'위조 상품 연결 제안') RETURNING id`,
      [listingId, proposerTwo.actor.userId, forgedOfferInventory],
    );
    const forgedOfferId = forgedOffer.rows[0]!.id;
    await pool.query(
      "UPDATE inventory_units SET status='EXCHANGE_OFFERED' WHERE id=$1",
      [forgedOfferInventory],
    );
    const detailAfterForgedOffer = await app.inject({
      method: "GET",
      url: `/v1/exchange/listings/${listingId}`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(detailAfterForgedOffer.statusCode, 200, detailAfterForgedOffer.body);
    const filteredDetail = detailAfterForgedOffer.json() as {
      offerCount: number;
      offers: Array<{ id: string }>;
    };
    assert.equal(filteredDetail.offerCount, 0);
    assert.equal(filteredDetail.offers.some((offer) => offer.id === forgedOfferId), false);
    const forgedAcceptance = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers/${forgedOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(forgedAcceptance.statusCode, 409, forgedAcceptance.body);
    assert.match(forgedAcceptance.body, /가챠로 직접 뽑아/);
    const forgedRejection = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers/${forgedOfferId}/decision`,
      { decision: "REJECTED" },
    );
    assert.equal(forgedRejection.statusCode, 200, forgedRejection.body);

    const legacyKujiOfferInventory = await addDrawInventory(proposerTwo.actor.userId, "KUJI");
    const legacyKujiOffer = await pool.query<{ id: string }>(
      `INSERT INTO exchange_offers(listing_id,proposer_id,offered_inventory_unit_id,message)
       VALUES($1,$2,$3,'기존 쿠지 제안') RETURNING id`,
      [listingId, proposerTwo.actor.userId, legacyKujiOfferInventory],
    );
    const legacyKujiOfferId = legacyKujiOffer.rows[0]!.id;
    await pool.query(
      "UPDATE inventory_units SET status='EXCHANGE_OFFERED' WHERE id=$1",
      [legacyKujiOfferInventory],
    );
    const legacyKujiAcceptance = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers/${legacyKujiOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(legacyKujiAcceptance.statusCode, 409, legacyKujiAcceptance.body);
    assert.match(legacyKujiAcceptance.body, /가챠로 직접 뽑아/);
    const legacyKujiRejection = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers/${legacyKujiOfferId}/decision`,
      { decision: "REJECTED" },
    );
    assert.equal(legacyKujiRejection.statusCode, 200, legacyKujiRejection.body);
    const legacyKujiOfferInventoryAfterRejection = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=$1",
      [legacyKujiOfferInventory],
    );
    assert.equal(legacyKujiOfferInventoryAfterRejection.rows[0]!.status, "OWNED");

    const purchasedInventory = await addInventory(proposerOne.actor.userId, "PURCHASE");
    const purchasedOffer = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitId: purchasedInventory },
    );
    assert.equal(purchasedOffer.statusCode, 409, purchasedOffer.body);
    assert.match(purchasedOffer.body, /직접 뽑아 보관함에 보관 중인/);

    const rollbackOfferInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const rejectedOfferBundle = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitIds: [rollbackOfferInventory, purchasedInventory] },
    );
    assert.equal(rejectedOfferBundle.statusCode, 409, rejectedOfferBundle.body);
    const rollbackOfferState = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=$1",
      [rollbackOfferInventory],
    );
    assert.equal(rollbackOfferState.rows[0]!.status, "OWNED");

    for (const inventoryId of [
      await addInventory(proposerOne.actor.userId, "GACHA"),
      await addInventory(proposerOne.actor.userId, "KUJI"),
      await addDrawInventory(proposerOne.actor.userId, "KUJI"),
      await addInventory(proposerOne.actor.userId, "ADMIN_ADJUSTMENT"),
      await addDrawInventory(proposerOne.actor.userId, "GACHA", "SHIPPING"),
      await addDrawInventory(proposerOne.actor.userId, "KUJI", "DELIVERED"),
      await addDrawInventory(
        proposerOne.actor.userId,
        "GACHA",
        "OWNED",
        { sourceId: randomUUID() },
      ),
      await addDrawInventory(
        proposerOne.actor.userId,
        "GACHA",
        "OWNED",
        { drawPrizeProductId: gachaDrawProductId },
      ),
      await addDrawInventory(
        proposerOne.actor.userId,
        "GACHA",
        "OWNED",
        { drawOwnerId: author.actor.userId },
      ),
    ]) {
      const ineligibleOffer = await mutate(
        proposerOne.token,
        "POST",
        `/v1/exchange/listings/${listingId}/offers`,
        { offeredInventoryUnitId: inventoryId },
      );
      assert.equal(ineligibleOffer.statusCode, 409, ineligibleOffer.body);
      assert.match(ineligibleOffer.body, /직접 뽑아 보관함에 보관 중인/);
    }

    const offerOneResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitIds: [offerOneInventory, offerOneInventoryTwo] },
    );
    const offerTwoResponse = await mutate(
      proposerTwo.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitIds: [offerTwoInventory, offerTwoInventoryTwo] },
    );
    assert.equal(offerOneResponse.statusCode, 201, offerOneResponse.body);
    assert.equal(offerTwoResponse.statusCode, 201, offerTwoResponse.body);
    assert.deepEqual(
      (offerOneResponse.json() as { offeredInventories: Array<{ id: string }> })
        .offeredInventories.map((inventory) => inventory.id),
      [offerOneInventory, offerOneInventoryTwo],
    );
    const duplicateActiveOfferInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const duplicateActiveOffer = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitIds: [duplicateActiveOfferInventory] },
    );
    assert.equal(duplicateActiveOffer.statusCode, 409, duplicateActiveOffer.body);
    const duplicateActiveOfferState = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=$1",
      [duplicateActiveOfferInventory],
    );
    assert.equal(duplicateActiveOfferState.rows[0]!.status, "OWNED");
    const offerOneId = (offerOneResponse.json() as { id: string }).id;
    const offerTwoId = (offerTwoResponse.json() as { id: string }).id;

    const authorView = await app.inject({
      method: "GET",
      url: `/v1/exchange/listings/${listingId}`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(authorView.statusCode, 200, authorView.body);
    const visibleOffers = (authorView.json() as {
      offers: Array<{ id: string; proposerNickname: string }>;
    }).offers;
    assert.equal(visibleOffers.some((offer) => offer.id === legacyKujiOfferId), false);
    assert.deepEqual(
      visibleOffers.map((offer) => offer.proposerNickname).sort(),
      [proposerOne.actor.nickname, proposerTwo.actor.nickname].sort(),
    );

    const decisions = await Promise.all([
      mutate(
        author.token,
        "POST",
        `/v1/exchange/listings/${listingId}/offers/${offerOneId}/decision`,
        { decision: "ACCEPTED" },
      ),
      mutate(
        author.token,
        "POST",
        `/v1/exchange/listings/${listingId}/offers/${offerTwoId}/decision`,
        { decision: "ACCEPTED" },
      ),
    ]);
    assert.deepEqual(decisions.map((response) => response.statusCode).sort(), [200, 409]);
    const acceptedIndex = decisions.findIndex((response) => response.statusCode === 200);
    const acceptedOfferId = acceptedIndex === 0 ? offerOneId : offerTwoId;
    const acceptedProposer = acceptedIndex === 0 ? proposerOne : proposerTwo;
    const rejectedProposer = acceptedIndex === 0 ? proposerTwo : proposerOne;
    const acceptedInventories = acceptedIndex === 0
      ? [offerOneInventory, offerOneInventoryTwo]
      : [offerTwoInventory, offerTwoInventoryTwo];
    const rejectedInventories = acceptedIndex === 0
      ? [offerTwoInventory, offerTwoInventoryTwo]
      : [offerOneInventory, offerOneInventoryTwo];

    const authorConfirmation = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${listingId}/completion-confirmation`,
      undefined,
    );
    assert.equal(authorConfirmation.statusCode, 200, authorConfirmation.body);
    assert.equal((authorConfirmation.json() as { status: string }).status, "MATCHED");
    const completionKey = randomUUID();
    const proposerConfirmation = await mutate(
      acceptedProposer.token,
      "POST",
      `/v1/exchange/listings/${listingId}/completion-confirmation`,
      undefined,
      completionKey,
    );
    assert.equal(proposerConfirmation.statusCode, 200, proposerConfirmation.body);
    assert.equal((proposerConfirmation.json() as { status: string }).status, "COMPLETED");
    const replay = await mutate(
      acceptedProposer.token,
      "POST",
      `/v1/exchange/listings/${listingId}/completion-confirmation`,
      undefined,
      completionKey,
    );
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), proposerConfirmation.json());

    const inventoryAfter = await pool.query<{ id: string; owner_id: string; status: string }>(
      "SELECT id,owner_id,status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[listingInventory, listingInventoryTwo, ...acceptedInventories, ...rejectedInventories]],
    );
    const byId = new Map(inventoryAfter.rows.map((row) => [row.id, row]));
    for (const inventoryId of [listingInventory, listingInventoryTwo]) {
      assert.deepEqual(byId.get(inventoryId), {
        id: inventoryId,
        owner_id: acceptedProposer.actor.userId,
        status: "OWNED",
      });
    }
    for (const inventoryId of acceptedInventories) {
      assert.deepEqual(byId.get(inventoryId), {
        id: inventoryId,
        owner_id: author.actor.userId,
        status: "OWNED",
      });
    }
    for (const inventoryId of rejectedInventories) {
      assert.equal(byId.get(inventoryId)?.status, "OWNED");
      assert.equal(byId.get(inventoryId)?.owner_id, rejectedProposer.actor.userId);
    }
    const transferCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM inventory_ownership_transfers WHERE exchange_listing_id=$1",
      [listingId],
    );
    assert.equal(Number(transferCount.rows[0]!.count), 4);
    const acceptedOffer = await pool.query<{ status: string }>(
      "SELECT status FROM exchange_offers WHERE id=$1",
      [acceptedOfferId],
    );
    assert.equal(acceptedOffer.rows[0]!.status, "ACCEPTED");

    for (const transferred of [
      { inventoryId: listingInventory, owner: acceptedProposer },
      { inventoryId: listingInventoryTwo, owner: acceptedProposer },
      ...acceptedInventories.map((inventoryId) => ({ inventoryId, owner: author })),
    ]) {
      const transferredInventory = await app.inject({
        method: "GET",
        url: "/v1/exchange/inventory?limit=100",
        headers: { authorization: `Bearer ${transferred.owner.token}` },
      });
      assert.equal(transferredInventory.statusCode, 200, transferredInventory.body);
      assert.equal(
        (transferredInventory.json() as { items: Array<{ id: string }> }).items
          .some((item) => item.id === transferred.inventoryId),
        false,
      );

      const transferredListing = await mutate(
        transferred.owner.token,
        "POST",
        "/v1/exchange/listings",
        {
          title: "양도 상품 재교환 차단 테스트",
          details: "현재 소유자 본인이 직접 뽑은 상품이 아니면 등록할 수 없어야 합니다.",
          offeredInventoryUnitId: transferred.inventoryId,
        },
      );
      assert.equal(transferredListing.statusCode, 409, transferredListing.body);
      assert.match(transferredListing.body, /직접 뽑아 보관함에 보관 중인/);
    }

    const transferGuardHost = await mutate(
      rejectedProposer.token,
      "POST",
      "/v1/exchange/listings",
      {
        title: "양도 상품 제안 차단 테스트",
        details: "양도받은 상품으로 제안할 수 없어야 합니다.",
        offeredInventoryUnitId: rejectedInventories[0],
      },
    );
    assert.equal(transferGuardHost.statusCode, 201, transferGuardHost.body);
    const transferredOffer = await mutate(
      acceptedProposer.token,
      "POST",
      `/v1/exchange/listings/${(transferGuardHost.json() as { id: string }).id}/offers`,
      { offeredInventoryUnitId: listingInventory },
    );
    assert.equal(transferredOffer.statusCode, 409, transferredOffer.body);
    assert.match(transferredOffer.body, /직접 뽑아 보관함에 보관 중인/);

    await completeBundleExchange({
      label: "1:2",
      listingInventoryIds: [await addDrawInventory(author.actor.userId, "GACHA")],
      proposer: proposerOne,
      offerInventoryIds: [
        await addDrawInventory(proposerOne.actor.userId, "GACHA"),
        await addDrawInventory(proposerOne.actor.userId, "GACHA"),
      ],
    });
    await completeBundleExchange({
      label: "2:1",
      listingInventoryIds: [
        await addDrawInventory(author.actor.userId, "GACHA"),
        await addDrawInventory(author.actor.userId, "GACHA"),
      ],
      proposer: proposerTwo,
      offerInventoryIds: [await addDrawInventory(proposerTwo.actor.userId, "GACHA")],
    });

    const cancelListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const cancelListingInventoryTwo = await addDrawInventory(author.actor.userId, "GACHA");
    const withdrawInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const withdrawInventoryTwo = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const cancelOfferInventory = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const cancelOfferInventoryTwo = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const cancelListingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "취소와 철회 테스트",
      details: "예약 상품이 다시 소유 상태가 되어야 합니다.",
      offeredInventoryUnitIds: [cancelListingInventory, cancelListingInventoryTwo],
    });
    const cancelListingId = (cancelListingResponse.json() as { id: string }).id;
    const withdrawOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${cancelListingId}/offers`,
      { offeredInventoryUnitIds: [withdrawInventory, withdrawInventoryTwo] },
    );
    const withdrawOfferId = (withdrawOfferResponse.json() as { id: string }).id;
    const withdrawn = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${cancelListingId}/offers/${withdrawOfferId}/withdraw`,
      undefined,
    );
    assert.equal(withdrawn.statusCode, 200, withdrawn.body);
    assert.equal((withdrawn.json() as { status: string }).status, "WITHDRAWN");
    const cancelOfferResponse = await mutate(
      proposerTwo.token,
      "POST",
      `/v1/exchange/listings/${cancelListingId}/offers`,
      { offeredInventoryUnitIds: [cancelOfferInventory, cancelOfferInventoryTwo] },
    );
    assert.equal(cancelOfferResponse.statusCode, 201, cancelOfferResponse.body);
    const cancelled = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${cancelListingId}/cancel`,
      undefined,
    );
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal((cancelled.json() as { status: string }).status, "CANCELLED");
    const released = await pool.query<{ status: string }>(
      "SELECT status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[
        cancelListingInventory,
        cancelListingInventoryTwo,
        withdrawInventory,
        withdrawInventoryTwo,
        cancelOfferInventory,
        cancelOfferInventoryTwo,
      ]],
    );
    assert.equal(released.rows.length, 6);
    assert.ok(released.rows.every((row) => row.status === "OWNED"));

    const adminToken = `admin-${randomUUID()}-session-token`;
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status)
       VALUES($1,'교환 운영자','ADMIN','ACTIVE') RETURNING id`,
      [`exchange-admin-${suffix}@example.test`],
    );
    await pool.query(
      `INSERT INTO sessions(user_id,session_kind,token_digest,expires_at)
       VALUES($1,'ADMIN',$2,now()+interval '1 day')`,
      [admin.rows[0]!.id, tokenDigest(adminToken, config.sessionTokenPepper)],
    );
    const adminListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const adminOfferInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const adminListingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "운영 취소 테스트",
      details: "매칭 후 운영 취소가 예약만 해제해야 합니다.",
      offeredInventoryUnitId: adminListingInventory,
    });
    const adminListingId = (adminListingResponse.json() as { id: string }).id;
    const adminOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${adminListingId}/offers`,
      { offeredInventoryUnitId: adminOfferInventory },
    );
    const adminOfferId = (adminOfferResponse.json() as { id: string }).id;
    const accepted = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${adminListingId}/offers/${adminOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const adminQueue = await app.inject({
      method: "GET",
      url: `/v1/admin/exchange/listings?status=MATCHED&q=${adminListingId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminQueue.statusCode, 200, adminQueue.body);
    const queuedListing = (adminQueue.json() as {
      items: Array<{ id: string; offeredInventory: { id: string } }>;
    }).items.find((item) => item.id === adminListingId);
    assert.equal(queuedListing?.offeredInventory.id, adminListingInventory);
    const reason = "양측 요청에 따른 운영 취소";
    const adminCancelled = await mutate(
      adminToken,
      "POST",
      `/v1/admin/exchange/listings/${adminListingId}/resolution`,
      { action: "CANCEL", reason },
      randomUUID(),
      { "x-admin-reason": reason },
    );
    assert.equal(adminCancelled.statusCode, 200, adminCancelled.body);
    assert.equal((adminCancelled.json() as { status: string }).status, "CANCELLED");
    const unchangedOwners = await pool.query<{ id: string; owner_id: string; status: string }>(
      "SELECT id,owner_id,status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[adminListingInventory, adminOfferInventory]],
    );
    assert.deepEqual(
      new Map(unchangedOwners.rows.map((row) => [row.id, { ownerId: row.owner_id, status: row.status }])),
      new Map([
        [adminListingInventory, { ownerId: author.actor.userId, status: "OWNED" }],
        [adminOfferInventory, { ownerId: proposerOne.actor.userId, status: "OWNED" }],
      ]),
    );

    const overrideListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const overrideOfferInventory = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const overrideListingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "운영 완료 테스트",
      details: "운영 완료도 동일한 소유권 원장을 남겨야 합니다.",
      offeredInventoryUnitId: overrideListingInventory,
    });
    const overrideListingId = (overrideListingResponse.json() as { id: string }).id;
    const overrideOfferResponse = await mutate(
      proposerTwo.token,
      "POST",
      `/v1/exchange/listings/${overrideListingId}/offers`,
      { offeredInventoryUnitId: overrideOfferInventory },
    );
    const overrideOfferId = (overrideOfferResponse.json() as { id: string }).id;
    const overrideAccepted = await mutate(
      author.token,
      "POST",
      `/v1/exchange/listings/${overrideListingId}/offers/${overrideOfferId}/decision`,
      { decision: "ACCEPTED" },
    );
    assert.equal(overrideAccepted.statusCode, 200, overrideAccepted.body);
    const completionReason = "현장 인계 확인에 따른 운영 완료";
    const adminCompleted = await mutate(
      adminToken,
      "POST",
      `/v1/admin/exchange/listings/${overrideListingId}/resolution`,
      { action: "COMPLETE", reason: completionReason },
      randomUUID(),
      { "x-admin-reason": completionReason },
    );
    assert.equal(adminCompleted.statusCode, 200, adminCompleted.body);
    assert.deepEqual(
      {
        status: (adminCompleted.json() as { status: string }).status,
        completionMode: (adminCompleted.json() as { completionMode: string }).completionMode,
      },
      { status: "COMPLETED", completionMode: "ADMIN_OVERRIDE" },
    );
    const overrideOwners = await pool.query<{ id: string; owner_id: string; status: string }>(
      "SELECT id,owner_id,status FROM inventory_units WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[overrideListingInventory, overrideOfferInventory]],
    );
    const overrideById = new Map(overrideOwners.rows.map((row) => [row.id, row]));
    assert.equal(overrideById.get(overrideListingInventory)?.owner_id, proposerTwo.actor.userId);
    assert.equal(overrideById.get(overrideOfferInventory)?.owner_id, author.actor.userId);
    assert.equal(overrideById.get(overrideListingInventory)?.status, "OWNED");
    assert.equal(overrideById.get(overrideOfferInventory)?.status, "OWNED");
    const overrideLedger = await pool.query<{ transferred_by_admin_id: string | null }>(
      `SELECT transferred_by_admin_id FROM inventory_ownership_transfers
       WHERE exchange_listing_id=$1 ORDER BY inventory_unit_id`,
      [overrideListingId],
    );
    assert.equal(overrideLedger.rows.length, 2);
    assert.ok(overrideLedger.rows.every((row) => row.transferred_by_admin_id === admin.rows[0]!.id));
  },
);
