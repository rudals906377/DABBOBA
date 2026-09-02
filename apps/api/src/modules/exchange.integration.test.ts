import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
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
      return response.json() as { token: string; actor: { userId: string; nickname: string } };
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

    const createDrawDefinition = async (
      drawProductId: string,
      category: "gacha" | "kuji",
    ) => {
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
      return {
        category,
        drawProductId,
        poolEntryId: poolEntry.rows[0]!.id,
        versionId: version.rows[0]!.id,
      };
    };
    const drawDefinitions = {
      GACHA: await createDrawDefinition(gachaDrawProductId, "gacha"),
      KUJI: await createDrawDefinition(kujiDrawProductId, "kuji"),
    };

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
    ) => {
      const definition = drawDefinitions[sourceType];
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
         VALUES($1,'PAID',1000,1000,now()) RETURNING id`,
        [ownerId],
      );
      const line = await pool.query<{ id: string }>(
        `INSERT INTO order_lines(
          order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
          unit_price,quantity,line_total
        ) VALUES($1,$2,$3,$4,$5,1000,1,1000) RETURNING id`,
        [
          order.rows[0]!.id,
          definition.drawProductId,
          `교환 테스트 ${sourceType === "GACHA" ? "가챠" : "쿠지"}`,
          definition.category,
          definition.versionId,
        ],
      );
      const entitlement = await pool.query<{ id: string }>(
        `INSERT INTO draw_entitlements(
          order_line_id,user_id,product_id,probability_version_id,status,consumed_at
        ) VALUES($1,$2,$3,$4,'CONSUMED',now()) RETURNING id`,
        [line.rows[0]!.id, ownerId, definition.drawProductId, definition.versionId],
      );
      const inventoryId = await addInventory(ownerId, sourceType, status);
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
          ownerId,
          definition.drawProductId,
          definition.poolEntryId,
          productId,
          inventoryId,
          "0".repeat(64),
          "1".repeat(64),
        ],
      );
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

    const listingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const offerOneInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const offerTwoInventory = await addDrawInventory(proposerTwo.actor.userId, "GACHA");

    for (const inventoryId of [
      await addInventory(author.actor.userId, "GACHA"),
      await addInventory(author.actor.userId, "KUJI"),
      await addDrawInventory(author.actor.userId, "KUJI"),
      await addInventory(author.actor.userId, "PURCHASE"),
      await addInventory(author.actor.userId, "ADMIN_ADJUSTMENT"),
      await addDrawInventory(author.actor.userId, "GACHA", "SHIPPING"),
      await addDrawInventory(author.actor.userId, "KUJI", "DELIVERED"),
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
      (eligibleInventory.json() as { items: Array<{ id: string }> }).items.map((item) => item.id),
      [listingInventory],
    );

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

    const listingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "동시 수락 테스트",
      details: "한 제안만 수락되어야 합니다.",
      offeredInventoryUnitId: listingInventory,
    });
    assert.equal(listingResponse.statusCode, 201, listingResponse.body);
    const listingId = (listingResponse.json() as { id: string }).id;

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

    for (const inventoryId of [
      await addInventory(proposerOne.actor.userId, "GACHA"),
      await addInventory(proposerOne.actor.userId, "KUJI"),
      await addDrawInventory(proposerOne.actor.userId, "KUJI"),
      await addInventory(proposerOne.actor.userId, "ADMIN_ADJUSTMENT"),
      await addDrawInventory(proposerOne.actor.userId, "GACHA", "SHIPPING"),
      await addDrawInventory(proposerOne.actor.userId, "KUJI", "DELIVERED"),
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
      { offeredInventoryUnitId: offerOneInventory },
    );
    const offerTwoResponse = await mutate(
      proposerTwo.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitId: offerTwoInventory },
    );
    assert.equal(offerOneResponse.statusCode, 201, offerOneResponse.body);
    assert.equal(offerTwoResponse.statusCode, 201, offerTwoResponse.body);
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
    const acceptedInventory = acceptedIndex === 0 ? offerOneInventory : offerTwoInventory;
    const rejectedInventory = acceptedIndex === 0 ? offerTwoInventory : offerOneInventory;

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
      [[listingInventory, acceptedInventory, rejectedInventory]],
    );
    const byId = new Map(inventoryAfter.rows.map((row) => [row.id, row]));
    assert.deepEqual(byId.get(listingInventory), {
      id: listingInventory,
      owner_id: acceptedProposer.actor.userId,
      status: "OWNED",
    });
    assert.deepEqual(byId.get(acceptedInventory), {
      id: acceptedInventory,
      owner_id: author.actor.userId,
      status: "OWNED",
    });
    assert.equal(byId.get(rejectedInventory)?.status, "OWNED");
    const transferCount = await pool.query<{ count: string }>(
      "SELECT count(*) FROM inventory_ownership_transfers WHERE exchange_listing_id=$1",
      [listingId],
    );
    assert.equal(Number(transferCount.rows[0]!.count), 2);
    const acceptedOffer = await pool.query<{ status: string }>(
      "SELECT status FROM exchange_offers WHERE id=$1",
      [acceptedOfferId],
    );
    assert.equal(acceptedOffer.rows[0]!.status, "ACCEPTED");

    for (const transferred of [
      { inventoryId: listingInventory, owner: acceptedProposer },
      { inventoryId: acceptedInventory, owner: author },
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
        offeredInventoryUnitId: rejectedInventory,
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

    const cancelListingInventory = await addDrawInventory(author.actor.userId, "GACHA");
    const withdrawInventory = await addDrawInventory(proposerOne.actor.userId, "GACHA");
    const cancelOfferInventory = await addDrawInventory(proposerTwo.actor.userId, "GACHA");
    const cancelListingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "취소와 철회 테스트",
      details: "예약 상품이 다시 소유 상태가 되어야 합니다.",
      offeredInventoryUnitId: cancelListingInventory,
    });
    const cancelListingId = (cancelListingResponse.json() as { id: string }).id;
    const withdrawOfferResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${cancelListingId}/offers`,
      { offeredInventoryUnitId: withdrawInventory },
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
      { offeredInventoryUnitId: cancelOfferInventory },
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
      [[cancelListingInventory, withdrawInventory, cancelOfferInventory]],
    );
    assert.deepEqual(released.rows.map((row) => row.status), ["OWNED", "OWNED", "OWNED"]);

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
