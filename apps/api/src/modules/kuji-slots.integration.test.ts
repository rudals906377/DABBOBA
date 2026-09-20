import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { PaidKujiDrawRecovery, PaidKujiSelectionSnapshot } from "@dabboba/contracts";
import { createDatabasePool, RUNTIME_DATABASE_ROLE } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL?.trim() || undefined;

test(
  "sealed kuji publish, bind, consume, aggregate privacy, and concurrent slot ownership stay authoritative",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-sealed-kuji-slot-fixtures");
    const apiPool = createDatabasePool(
      runtimeDatabaseUrl ?? databaseUrl!,
      "dabboba-sealed-kuji-slot-integration",
    );
    const config: ApiConfig = {
      environment: "test",
      surface: "all",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: runtimeDatabaseUrl ?? databaseUrl!,
      redisUrl: null,
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "sealed-kuji-slot-integration-pepper",
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
    const { app } = await buildApp({ config, pool: apiPool, redis: null });
    t.after(async () => {
      await app.close();
      await apiPool.end();
      await pool.end();
    });

    if (runtimeDatabaseUrl) {
      const identity = await apiPool.query<{ current_user: string }>("SELECT current_user");
      assert.equal(identity.rows[0]?.current_user, RUNTIME_DATABASE_ROLE);
    }

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ipId = `sealed-kuji-${suffix}`;
    const productId = `sealed-kuji-product-${suffix}`;
    const prizeAId = `sealed-kuji-a-${suffix}`;
    const prizeBId = `sealed-kuji-b-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `봉인 쿠지 ${suffix}`, `Sealed kuji ${suffix}`],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
       VALUES
         ($1,$2,$3,'kuji',$4,1000,'https://cdn.example.test/products/kuji-fixture.png',false),
         ($5,$6,$3,'figure',$7,0,NULL,true),
         ($8,$9,$3,'figure',$10,0,NULL,true)`,
      [
        productId,
        `SEALED-KUJI-${suffix}`.toUpperCase(),
        ipId,
        `봉인 쿠지 상품 ${suffix}`,
        prizeAId,
        `SEALED-A-${suffix}`.toUpperCase(),
        `봉인 쿠지 A상 ${suffix}`,
        prizeBId,
        `SEALED-B-${suffix}`.toUpperCase(),
        `봉인 쿠지 B상 ${suffix}`,
      ],
    );
    await pool.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,4,0)",
      [productId],
    );

    const createActor = async (role: "USER" | "ADMIN", label: string) => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`sealed-kuji-${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      if (role === "USER") {
        await acceptRequiredPoliciesForIntegrationTest(pool, created.rows[0]!.id);
      }
      const session = await issueSession(apiPool, config, {
        userId: created.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
      });
      return { id: created.rows[0]!.id, token: session.token };
    };
    const admin = await createActor("ADMIN", "publisher");
    const firstUser = await createActor("USER", "first");
    const secondUser = await createActor("USER", "second");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const adminHeaders = (reason: string) => ({
      ...auth(admin.token),
      "x-admin-reason": reason,
      "idempotency-key": `sealed-kuji-admin-${randomUUID()}`,
    });

    const draftResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/products/${productId}/draw-versions`,
      headers: adminHeaders("봉인 쿠지 번호판 생성"),
      payload: {
        totalSlots: 4,
        entries: [
          { prizeProductId: prizeAId, rarity: "A상", quantity: 1, tierCode: "A", tierRank: 0 },
          { prizeProductId: prizeBId, rarity: "B상", quantity: 3, tierCode: "B", tierRank: 1 },
        ],
      },
    });
    assert.equal(draftResponse.statusCode, 201, draftResponse.body);
    const draft = draftResponse.json() as { id: string; version: number; totalSlots: number };
    assert.equal(draft.totalSlots, 4);

    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/products/${productId}/draw-versions/${draft.id}/publish`,
      headers: adminHeaders("봉인 쿠지 번호판 공개"),
      payload: { reason: "봉인 쿠지 번호판 공개" },
    });
    assert.equal(published.statusCode, 200, published.body);
    await pool.query(
      "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
      [productId],
    );

    const persisted = await pool.query<{
      slot_id: string;
      slot_number: number;
      pool_entry_id: string;
      prize_product_id: string;
    }>(
      `SELECT assignment.id AS slot_id,assignment.slot_number,assignment.pool_entry_id,
              entry.prize_product_id
         FROM kuji_slot_assignments AS assignment
         JOIN draw_pool_entries AS entry ON entry.id=assignment.pool_entry_id
        WHERE assignment.probability_version_id=$1
        ORDER BY assignment.slot_number`,
      [draft.id],
    );
    assert.equal(persisted.rows.length, 4);
    assert.deepEqual(persisted.rows.map(({ slot_number }) => Number(slot_number)), [1, 2, 3, 4]);
    assert.equal(persisted.rows.filter(({ prize_product_id }) => prize_product_id === prizeAId).length, 1);
    await assert.rejects(
      pool.query(
        "UPDATE kuji_slot_assignments SET slot_number=slot_number+10 WHERE id=$1",
        [persisted.rows[0]!.slot_id],
      ),
      (error: unknown) => typeof error === "object" && error !== null
        && "code" in error && error.code === "55000",
    );

    type PublicDeck = {
      snapshotVersion: number;
      slots: Array<{ slotNumber: number; available: boolean }>;
      tiers: Array<{ tierCode: string; remainingQuantity: number }>;
    };
    const readPublicDeck = async (): Promise<PublicDeck> => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/catalog/products/${productId}/kuji-slots`,
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json() as PublicDeck;
      assert.deepEqual(Object.keys(body.slots[0]!).sort(), ["available", "slotNumber"]);
      assert.equal(JSON.stringify(body.slots).includes("slotId"), false);
      assert.equal(JSON.stringify(body.slots).includes("prize"), false);
      assert.equal(JSON.stringify(body.slots).includes("tier"), false);
      return body;
    };
    const initialDeck = await readPublicDeck();
    assert.equal(initialDeck.slots.every(({ available }) => available), true);
    assert.deepEqual(
      initialDeck.tiers.map(({ tierCode, remainingQuantity }) => [tierCode, remainingQuantity]),
      [["A", 1], ["B", 3]],
    );

    const joinRoom = async (actor: { token: string }) => {
      const joined = await app.inject({
        method: "POST",
        url: `/v1/kuji/rooms/${productId}/entries`,
        headers: auth(actor.token),
      });
      assert.equal(joined.statusCode, 201, joined.body);
      return (joined.json() as { viewer: { entryId: string } }).viewer.entryId;
    };
    const payRoom = async (actor: { id: string; token: string }, quantity: number, roomEntryId: string) => {
      const pointAmount = quantity * 1000;
      await pool.query(
        `INSERT INTO point_accounts(user_id,balance) VALUES($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET balance=point_accounts.balance+EXCLUDED.balance`,
        [actor.id, pointAmount],
      );
      await pool.query(
        `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
         VALUES($1,'EARN',$2,'TEST',$3,'Sealed kuji integration setup')`,
        [actor.id, pointAmount, `sealed-kuji-${randomUUID()}`],
      );
      const order = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: {
          ...auth(actor.token),
          "idempotency-key": `sealed-kuji-order-${randomUUID()}`,
        },
        payload: {
          items: [{ productId, quantity, expectedDrawVersion: draft.version }],
          pointAmount,
          kujiRoomEntryId: roomEntryId,
        },
      });
      assert.equal(order.statusCode, 201, order.body);
      return {
        roomEntryId,
        ...(order.json() as { id: string; drawEntitlementIds: string[] }),
      };
    };
    const firstRoomEntryId = await joinRoom(firstUser);
    const orderlessLease = await pool.query<{ state: string; order_id: string | null }>(
      "SELECT state,order_id FROM kuji_room_entries WHERE id=$1",
      [firstRoomEntryId],
    );
    assert.deepEqual(orderlessLease.rows, [{ state: "CHECKOUT_PENDING", order_id: null }]);
    const replacementDraftResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/products/${productId}/draw-versions`,
      headers: adminHeaders("미완료 쿠지 교체 초안 생성"),
      payload: {
        totalSlots: 3,
        entries: [
          { prizeProductId: prizeBId, rarity: "B상", quantity: 3, tierCode: "B", tierRank: 0 },
        ],
      },
    });
    assert.equal(replacementDraftResponse.statusCode, 201, replacementDraftResponse.body);
    const replacementDraft = replacementDraftResponse.json() as { id: string; version: number };
    const blockedReplacement = await app.inject({
      method: "POST",
      url: `/v1/admin/products/${productId}/draw-versions/${replacementDraft.id}/publish`,
      headers: adminHeaders("미완료 쿠지 교체 차단 확인"),
      payload: { reason: "미완료 쿠지 교체 차단 확인" },
    });
    assert.equal(blockedReplacement.statusCode, 409, blockedReplacement.body);
    assert.match(blockedReplacement.body, /미완료 고객 처리를 마친 뒤/);
    const stillActive = await pool.query<{ version: number; status: string }>(
      "SELECT version,status FROM draw_probability_versions WHERE product_id=$1 AND status='ACTIVE'",
      [productId],
    );
    assert.deepEqual(stillActive.rows, [{ version: 1, status: "ACTIVE" }]);
    const firstOrder = await payRoom(firstUser, 1, firstRoomEntryId);
    const recoveryUrl = `/v1/orders/${firstOrder.id}/draw-recovery`;
    const readRecovery = async () => {
      const response = await app.inject({ method: "GET", url: recoveryUrl, headers: auth(firstUser.token) });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers["cache-control"], "no-store");
      return response.json() as PaidKujiDrawRecovery;
    };
    assert.equal((await app.inject({ method: "GET", url: recoveryUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: recoveryUrl, headers: auth(secondUser.token) })).statusCode, 404);
    const unboundRecovery = await readRecovery();
    assert.deepEqual(unboundRecovery.entitlementIds, firstOrder.drawEntitlementIds);
    assert.deepEqual(unboundRecovery.bindings, []);
    assert.equal(unboundRecovery.roomEntryId, firstRoomEntryId);
    assert.equal(unboundRecovery.probabilityVersion, draft.version);

    const prizeASlot = persisted.rows.find(({ prize_product_id }) => prize_product_id === prizeAId)!;
    const bound = await app.inject({
      method: "POST",
      url: `/v1/kuji/rooms/${productId}/entries/${firstOrder.roomEntryId}/slots`,
      headers: {
        ...auth(firstUser.token),
        "idempotency-key": `sealed-kuji-bind-${randomUUID()}`,
      },
      payload: { probabilityVersion: draft.version, slotNumbers: [Number(prizeASlot.slot_number)] },
    });
    assert.equal(bound.statusCode, 201, bound.body);
    const binding = (bound.json() as { bindings: Array<Record<string, unknown>> }).bindings[0]!;
    assert.deepEqual(Object.keys(binding).sort(), ["entitlementId", "slotNumber", "state"]);
    const boundRecovery = await readRecovery();
    assert.deepEqual(boundRecovery.bindings, [binding]);
    assert.doesNotMatch(JSON.stringify(boundRecovery), /prize|poolEntry|tier|seed|assignment/i);

    // Fixture a completed occupancy lease while retaining the paid right. The
    // recovery read must leave both this history and a new occupant unchanged.
    await pool.query(
      "UPDATE kuji_room_entries SET state='EXPIRED',resolved_at=now() WHERE id=$1 AND state='DRAWING'",
      [firstRoomEntryId],
    );
    const secondRoomEntryId = await joinRoom(secondUser);
    const roomRows = () => pool.query(
      "SELECT * FROM kuji_room_entries WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[firstRoomEntryId, secondRoomEntryId]],
    );
    const roomsBeforeRecovery = await roomRows();
    const expiredRecovery = await readRecovery();
    assert.equal(expiredRecovery.roomState, "EXPIRED");
    assert.equal(expiredRecovery.drawingExpiresAt, unboundRecovery.drawingExpiresAt);
    assert.equal(expiredRecovery.roomEntryId, firstRoomEntryId);
    assert.deepEqual(expiredRecovery.entitlementIds, firstOrder.drawEntitlementIds);
    assert.deepEqual(expiredRecovery.bindings, boundRecovery.bindings);
    assert.deepEqual((await roomRows()).rows, roomsBeforeRecovery.rows);

    const reservedDeck = await readPublicDeck();
    assert.equal(
      reservedDeck.slots.find(({ slotNumber }) => slotNumber === Number(prizeASlot.slot_number))?.available,
      false,
    );
    assert.deepEqual(
      reservedDeck.tiers.map(({ tierCode, remainingQuantity }) => [tierCode, remainingQuantity]),
      [["A", 1], ["B", 3]],
    );
    assert.ok(reservedDeck.snapshotVersion > initialDeck.snapshotVersion);

    const consumed = await app.inject({
      method: "POST",
      url: `/v1/draws/${firstOrder.drawEntitlementIds[0]}/consume`,
      headers: {
        ...auth(firstUser.token),
        "idempotency-key": `sealed-kuji-consume-${randomUUID()}`,
      },
    });
    assert.equal(consumed.statusCode, 200, consumed.body);
    assert.deepEqual(
      {
        prizeProductId: (consumed.json() as { prizeProductId: string }).prizeProductId,
        kujiSlotNumber: (consumed.json() as { kujiSlotNumber: number }).kujiSlotNumber,
      },
      { prizeProductId: prizeAId, kujiSlotNumber: Number(prizeASlot.slot_number) },
    );

    const consumedDeck = await readPublicDeck();
    assert.deepEqual(
      consumedDeck.tiers.map(({ tierCode, remainingQuantity }) => [tierCode, remainingQuantity]),
      [["A", 0], ["B", 3]],
    );
    const resultLedger = await pool.query<{
      binding_state: string;
      selection_algorithm: string;
      prize_product_id: string;
    }>(
      `SELECT binding.state AS binding_state,result.selection_algorithm,result.prize_product_id
         FROM draw_results AS result
         JOIN kuji_slot_bindings AS binding ON binding.id=result.kuji_slot_binding_id
        WHERE result.entitlement_id=$1`,
      [firstOrder.drawEntitlementIds[0]],
    );
    assert.deepEqual(resultLedger.rows[0], {
      binding_state: "CONSUMED",
      selection_algorithm: "KUJI_SEALED_SLOT_V1",
      prize_product_id: prizeAId,
    });
    const finishedRecovery = await readRecovery();
    assert.deepEqual(finishedRecovery.entitlementIds, []);
    assert.deepEqual(finishedRecovery.bindings, []);
    assert.equal(finishedRecovery.roomState, "EXPIRED");
    assert.deepEqual((await roomRows()).rows, roomsBeforeRecovery.rows);

    const secondOrder = await payRoom(secondUser, 2, secondRoomEntryId);
    const raceSlot = persisted.rows.find(({ slot_id }) => slot_id !== prizeASlot.slot_id)!;
    const firstClient = await apiPool.connect();
    const secondClient = await apiPool.connect();
    try {
      await firstClient.query("BEGIN");
      await secondClient.query("BEGIN");
      const insertSql = `INSERT INTO kuji_slot_bindings(slot_assignment_id,entitlement_id,room_entry_id)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`;
      const firstInsert = await firstClient.query(insertSql, [
        raceSlot.slot_id,
        secondOrder.drawEntitlementIds[0],
        secondOrder.roomEntryId,
      ]);
      const secondInsertPromise = secondClient.query(insertSql, [
        raceSlot.slot_id,
        secondOrder.drawEntitlementIds[1],
        secondOrder.roomEntryId,
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await firstClient.query("COMMIT");
      const secondInsert = await secondInsertPromise;
      await secondClient.query("COMMIT");
      assert.deepEqual([firstInsert.rowCount, secondInsert.rowCount], [1, 0]);
    } catch (error) {
      await Promise.allSettled([
        firstClient.query("ROLLBACK"),
        secondClient.query("ROLLBACK"),
      ]);
      throw error;
    } finally {
      firstClient.release();
      secondClient.release();
    }

    const liveOwner = await pool.query<{ count: string }>(
      `SELECT count(*) FROM kuji_slot_bindings
        WHERE slot_assignment_id=$1 AND state IN ('RESERVED','CONSUMED')`,
      [raceSlot.slot_id],
    );
    assert.equal(liveOwner.rows[0]!.count, "1");

    await pool.query(
      "UPDATE draw_entitlements SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status='AVAILABLE'",
      [secondOrder.drawEntitlementIds],
    );
    const publishedReplacement = await app.inject({
      method: "POST",
      url: `/v1/admin/products/${productId}/draw-versions/${replacementDraft.id}/publish`,
      headers: adminHeaders("미완료 쿠지 정리 후 교체"),
      payload: { reason: "미완료 쿠지 정리 후 교체" },
    });
    assert.equal(publishedReplacement.statusCode, 200, publishedReplacement.body);
    assert.equal((publishedReplacement.json() as { version: number }).version, replacementDraft.version);

    // Keep the completed fixture histories immutable while preparing one more
    // paid, unselected order whose original deck outlives public sale visibility.
    await pool.query(
      "UPDATE kuji_room_entries SET state='EXPIRED',resolved_at=now() WHERE id=$1 AND state='DRAWING'",
      [secondRoomEntryId],
    );
    const recoveryUser = await createActor("USER", "recovery");
    const recoveryRoomId = await joinRoom(recoveryUser);
    await pool.query(
      "INSERT INTO point_accounts(user_id,balance) VALUES($1,1000)",
      [recoveryUser.id],
    );
    await pool.query(
      `INSERT INTO point_ledger_entries(user_id,entry_type,amount,reference_type,reference_id,reason)
       VALUES($1,'EARN',1000,'TEST',$2,'Sealed kuji recovery setup')`,
      [recoveryUser.id, `sealed-kuji-recovery-${randomUUID()}`],
    );
    const recoveryOrderResponse = await app.inject({
      method: "POST", url: "/v1/orders",
      headers: { ...auth(recoveryUser.token), "idempotency-key": `selection-order-${randomUUID()}` },
      payload: {
        items: [{ productId, quantity: 1, expectedDrawVersion: replacementDraft.version }],
        pointAmount: 1000, kujiRoomEntryId: recoveryRoomId,
      },
    });
    assert.equal(recoveryOrderResponse.statusCode, 201, recoveryOrderResponse.body);
    const recoveryOrder = recoveryOrderResponse.json() as { id: string; drawEntitlementIds: string[] };
    const selectionUrl = `/v1/orders/${recoveryOrder.id}/kuji-selection`;
    const readSelection = async () => {
      const response = await app.inject({ method: "GET", url: selectionUrl, headers: auth(recoveryUser.token) });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers["cache-control"], "no-store");
      return response.json() as PaidKujiSelectionSnapshot;
    };
    assert.equal((await app.inject({ method: "GET", url: selectionUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: selectionUrl, headers: auth(firstUser.token) })).statusCode, 404);
    const originalSelection = await readSelection();
    assert.equal(originalSelection.product.name, `봉인 쿠지 상품 ${suffix}`);
    assert.equal(originalSelection.product.unitPrice, 1000);
    assert.equal(originalSelection.board?.probabilityVersion, replacementDraft.version);
    assert.equal(originalSelection.board?.totalSlots, 3);
    assert.deepEqual(originalSelection.board?.slots.map((slot) => slot.available), [true, true, true]);
    assert.equal(originalSelection.board?.calculatedAt, originalSelection.recovery.serverNow);

    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,sale_status,created_at)
       SELECT 'selection-later-'||$1||'-'||n,'SELECTION-LATER-'||$1||'-'||n,$2,'figure','Later fixture '||n,0,'COMING_SOON',
              clock_timestamp()+interval '1 second'
         FROM generate_series(1,101) AS n`,
      [suffix, ipId],
    );
    const newestPage = await app.inject({ method: "GET", url: "/v1/catalog/products?limit=100" });
    assert.equal(newestPage.statusCode, 200, newestPage.body);
    assert.equal((newestPage.json() as { items: Array<{ id: string }> }).items.some((product) => product.id === productId), false);
    assert.deepEqual((await readSelection()).board?.slots, originalSelection.board?.slots);

    await pool.query(
      "UPDATE catalog_products SET sale_status='PAUSED',is_active=false,name='Changed after purchase',price=9900 WHERE id=$1",
      [productId],
    );
    await pool.query("UPDATE catalog_ips SET is_active=false WHERE id=$1", [ipId]);
    await pool.query("UPDATE product_stock SET on_hand=0 WHERE product_id=$1", [productId]);
    // ACTIVE -> RETIRED is an allowed append-only version lifecycle. Do not
    // republish another deck or relax the unfinished-order publication guard.
    await pool.query("UPDATE draw_probability_versions SET status='RETIRED' WHERE id=$1 AND status='ACTIVE'", [replacementDraft.id]);
    const unavailablePublicBoard = await app.inject({ method: "GET", url: `/v1/catalog/products/${productId}/kuji-slots` });
    assert.equal(unavailablePublicBoard.statusCode, 404, unavailablePublicBoard.body);
    const hiddenSelection = await readSelection();
    assert.deepEqual(hiddenSelection.product, originalSelection.product);
    assert.deepEqual(hiddenSelection.board?.slots, originalSelection.board?.slots);
    assert.deepEqual(hiddenSelection.board?.tiers, originalSelection.board?.tiers);
    assert.equal(hiddenSelection.recovery.probabilityVersion, replacementDraft.version);
    assert.equal(hiddenSelection.recovery.drawingExpiresAt, originalSelection.recovery.drawingExpiresAt);
    for (const slot of hiddenSelection.board!.slots) assert.deepEqual(Object.keys(slot).sort(), ["available", "slotNumber"]);
    assert.doesNotMatch(JSON.stringify(hiddenSelection.board!.slots), /tier|pool|prize|assignment|seed/i);

    const bindRecovered = await app.inject({
      method: "POST", url: `/v1/kuji/rooms/${productId}/entries/${recoveryRoomId}/slots`,
      headers: { ...auth(recoveryUser.token), "idempotency-key": `selection-bind-${randomUUID()}` },
      payload: { probabilityVersion: replacementDraft.version, slotNumbers: [1] },
    });
    assert.equal(bindRecovered.statusCode, 201, bindRecovered.body);
    const selectedRecovery = await readSelection();
    assert.equal(selectedRecovery.board, null);
    assert.deepEqual(selectedRecovery.recovery.bindings, [{
      entitlementId: recoveryOrder.drawEntitlementIds[0]!, slotNumber: 1, state: "RESERVED",
    }]);
    const consumedRecovery = await app.inject({
      method: "POST", url: `/v1/draws/${recoveryOrder.drawEntitlementIds[0]!}/consume`,
      headers: { ...auth(recoveryUser.token), "idempotency-key": `selection-consume-${randomUUID()}` },
    });
    assert.equal(consumedRecovery.statusCode, 200, consumedRecovery.body);
    assert.equal((consumedRecovery.json() as { probabilityVersion: number }).probabilityVersion, replacementDraft.version);
    assert.equal((await readSelection()).board, null);
  },
);
