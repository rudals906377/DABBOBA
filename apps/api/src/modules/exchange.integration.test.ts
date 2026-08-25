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
      return response.json() as { token: string; actor: { userId: string } };
    };
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `exchange-test-ip-${suffix}`;
    const productId = `exchange-test-product-${suffix}`;
    const author = await session(`exchange-author-${suffix}@example.test`);
    const proposerOne = await session(`exchange-one-${suffix}@example.test`);
    const proposerTwo = await session(`exchange-two-${suffix}@example.test`);

    await pool.query(
      `INSERT INTO catalog_ips(id,slug,name_ko,name_en)
       VALUES($1,$2,'교환 테스트','Exchange Test')`,
      [ipId, ipId],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price)
       VALUES($1,$2,$3,'figure','교환 테스트 상품',10000)`,
      [productId, `EXCHANGE-${suffix.toUpperCase()}`, ipId],
    );
    await pool.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,20,0)",
      [productId],
    );

    const addInventory = async (ownerId: string) => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO inventory_units(owner_id,product_id,source_type)
         VALUES($1,$2,'ADMIN_ADJUSTMENT') RETURNING id`,
        [ownerId, productId],
      );
      return result.rows[0]!.id;
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

    const listingInventory = await addInventory(author.actor.userId);
    const offerOneInventory = await addInventory(proposerOne.actor.userId);
    const offerTwoInventory = await addInventory(proposerTwo.actor.userId);
    const listingResponse = await mutate(author.token, "POST", "/v1/exchange/listings", {
      title: "동시 수락 테스트",
      details: "한 제안만 수락되어야 합니다.",
      offeredInventoryUnitId: listingInventory,
    });
    assert.equal(listingResponse.statusCode, 201, listingResponse.body);
    const listingId = (listingResponse.json() as { id: string }).id;

    const offerOneResponse = await mutate(
      proposerOne.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitId: offerOneInventory, message: "첫 번째 제안" },
    );
    const offerTwoResponse = await mutate(
      proposerTwo.token,
      "POST",
      `/v1/exchange/listings/${listingId}/offers`,
      { offeredInventoryUnitId: offerTwoInventory, message: "두 번째 제안" },
    );
    assert.equal(offerOneResponse.statusCode, 201, offerOneResponse.body);
    assert.equal(offerTwoResponse.statusCode, 201, offerTwoResponse.body);
    const offerOneId = (offerOneResponse.json() as { id: string }).id;
    const offerTwoId = (offerTwoResponse.json() as { id: string }).id;

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

    const cancelListingInventory = await addInventory(author.actor.userId);
    const withdrawInventory = await addInventory(proposerOne.actor.userId);
    const cancelOfferInventory = await addInventory(proposerTwo.actor.userId);
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
      { offeredInventoryUnitId: withdrawInventory, message: "철회할 제안" },
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
      { offeredInventoryUnitId: cancelOfferInventory, message: "글 취소로 반려될 제안" },
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
    const adminListingInventory = await addInventory(author.actor.userId);
    const adminOfferInventory = await addInventory(proposerOne.actor.userId);
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
      { offeredInventoryUnitId: adminOfferInventory, message: "운영 취소 대상" },
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

    const overrideListingInventory = await addInventory(author.actor.userId);
    const overrideOfferInventory = await addInventory(proposerTwo.actor.userId);
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
      { offeredInventoryUnitId: overrideOfferInventory, message: "운영 완료 대상" },
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
