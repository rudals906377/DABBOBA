import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

type Session = { token: string; actor: { userId: string } };
type RoomSnapshot = {
  serverNow: string;
  version: number;
  productId: string;
  viewer: {
    entryId: string;
    state: string;
    position: number | null;
    peopleAhead: number;
    checkoutExpiresAt: string | null;
    drawingExpiresAt: string | null;
  };
  active: { displayName: string; phase: string; checkoutExpiresAt: string | null } | null;
  waitingCount: number;
  waitingPeople: Array<{ entryId: string; displayName: string; position: number; isViewer: boolean }>;
  recentActivity: unknown[];
};

test("kuji room join, expiry, FIFO promotion, and leave stay server-authoritative", { skip: !databaseUrl }, async (t) => {
  const pool = createDatabasePool(databaseUrl!, "dabboba-kuji-room-integration");
  const config: ApiConfig = {
    environment: "test",
    host: "127.0.0.1",
    port: 8788,
    databaseUrl: databaseUrl!,
    redisUrl: "redis://127.0.0.1:6379",
    webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "kuji-room-integration-session-pepper",
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
  const ipId = `kuji-room-${suffix}`;
  const productId = `kuji-room-product-${suffix}`;
  await pool.query(
    "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
    [ipId, ipId, `쿠지 대기실 ${suffix}`, `Kuji room ${suffix}`],
  );
  await pool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
     VALUES($1,$2,$3,'kuji',$4,9900,$5,false)`,
    [
      productId,
      `KUJI-ROOM-${suffix.toUpperCase()}`,
      ipId,
      `쿠지 상품 ${suffix}`,
      `https://cdn.example.test/products/${productId}.png`,
    ],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,50,0)", [productId]);

  const createSession = async (label: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-session",
      payload: { email: `kuji-room-${label}-${suffix}@example.test` },
    });
    assert.equal(response.statusCode, 201, response.body);
    const created = response.json() as Session;
    await acceptRequiredPoliciesForIntegrationTest(pool, created.actor.userId);
    return created;
  };
  const publisher = await createSession("publisher");
  const prizeProductId = `kuji-room-prize-${suffix}`;
  await pool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
     VALUES($1,$2,$3,'figure',$4,0,true)`,
    [prizeProductId, `KUJI-ROOM-PRIZE-${suffix.toUpperCase()}`, ipId, `쿠지 경품 ${suffix}`],
  );
  const publishDraw = async (targetProductId: string, version: number) => {
    const created = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version) VALUES($1,$2) RETURNING id",
      [targetProductId, version],
    );
    const poolEntry = await pool.query<{ id: string }>(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
         initial_quantity,remaining_quantity
       ) SELECT $1,p.id,p.name,p.image_url,p.sku,p.ip_id,p.category,'A',1,50,50
           FROM catalog_products p WHERE p.id=$2
         RETURNING id`,
      [created.rows[0]!.id, prizeProductId],
    );
    await pool.query(
      "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,50)",
      [created.rows[0]!.id],
    );
    await pool.query(
      "INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank) VALUES($1,$2,'A',0)",
      [created.rows[0]!.id, poolEntry.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
       SELECT $1,slot_number,$2 FROM generate_series(1,50) AS slot_number`,
      [created.rows[0]!.id, poolEntry.rows[0]!.id],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [created.rows[0]!.id, publisher.actor.userId],
    );
  };
  await publishDraw(productId, 1);
  await pool.query(
    "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
    [productId],
  );

  const noDrawProductId = `kuji-no-draw-${suffix}`;
  await pool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
     VALUES($1,$2,$3,'kuji',$4,9900,false)`,
    [noDrawProductId, `KUJI-NO-DRAW-${suffix.toUpperCase()}`, ipId, `미공개 쿠지 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,5,0)", [noDrawProductId]);
  const noDrawUser = await createSession("no-draw");
  const noDrawJoin = await app.inject({
    method: "POST",
    url: `/v1/kuji/rooms/${noDrawProductId}/entries`,
    headers: { authorization: `Bearer ${noDrawUser.token}` },
  });
  assert.equal(noDrawJoin.statusCode, 404, noDrawJoin.body);

  const soldOutProductId = `kuji-sold-out-${suffix}`;
  await pool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,is_prize_only)
     VALUES($1,$2,$3,'kuji',$4,9900,false)`,
    [soldOutProductId, `KUJI-SOLD-OUT-${suffix.toUpperCase()}`, ipId, `품절 쿠지 ${suffix}`],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,1,0)", [soldOutProductId]);
  await publishDraw(soldOutProductId, 1);
  await pool.query(
    `UPDATE catalog_products
        SET image_url=$2,sale_status='ON_SALE'
      WHERE id=$1`,
    [soldOutProductId, `https://cdn.example.test/products/${soldOutProductId}.png`],
  );
  await pool.query("UPDATE product_stock SET on_hand=0 WHERE product_id=$1", [soldOutProductId]);
  const soldOutUser = await createSession("sold-out");
  const soldOutJoin = await app.inject({
    method: "POST",
    url: `/v1/kuji/rooms/${soldOutProductId}/entries`,
    headers: { authorization: `Bearer ${soldOutUser.token}` },
  });
  assert.equal(soldOutJoin.statusCode, 409, soldOutJoin.body);

  const first = await createSession("first");
  const second = await createSession("second");
  const third = await createSession("third");
  const auth = (session: Session) => ({ authorization: `Bearer ${session.token}` });
  const joinProduct = (session: Session, targetProductId = productId) => app.inject({
    method: "POST",
    url: `/v1/kuji/rooms/${targetProductId}/entries`,
    headers: auth(session),
  });
  const join = (session: Session) => joinProduct(session);

  const firstJoin = await join(first);
  assert.equal(firstJoin.statusCode, 201, firstJoin.body);
  assert.equal(firstJoin.headers["cache-control"], "no-store");
  const firstRoom = firstJoin.json() as RoomSnapshot;
  assert.equal(firstRoom.viewer.state, "CHECKOUT_PENDING");
  assert.equal(
    Date.parse(firstRoom.viewer.checkoutExpiresAt!) - Date.parse(firstRoom.serverNow),
    180_000,
  );

  const replay = await join(first);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.headers["x-idempotent-replay"], "true");
  assert.equal((replay.json() as RoomSnapshot).viewer.entryId, firstRoom.viewer.entryId);

  const secondRoom = (await join(second)).json() as RoomSnapshot;
  const thirdRoom = (await join(third)).json() as RoomSnapshot;
  assert.deepEqual(
    [secondRoom.viewer.state, secondRoom.viewer.position, thirdRoom.viewer.state, thirdRoom.viewer.position],
    ["WAITING", 1, "WAITING", 2],
  );
  assert.equal(thirdRoom.waitingPeople.every((person) => person.displayName.includes("*")), true);

  await pool.query(
    `UPDATE kuji_room_entries
     SET state='EXPIRED',resolved_at=now()
     WHERE id=$1`,
    [firstRoom.viewer.entryId],
  );
  const thirdAfterExpiryResponse = await app.inject({
    method: "GET",
    url: `/v1/kuji/rooms/${productId}/entries/${thirdRoom.viewer.entryId}`,
    headers: auth(third),
  });
  assert.equal(thirdAfterExpiryResponse.statusCode, 200, thirdAfterExpiryResponse.body);
  const thirdAfterExpiry = thirdAfterExpiryResponse.json() as RoomSnapshot;
  assert.equal(thirdAfterExpiry.active?.phase, "CHECKOUT_PENDING");
  assert.equal(thirdAfterExpiry.viewer.position, 1);
  assert.equal(thirdAfterExpiry.viewer.peopleAhead, 0);

  const secondLeave = await app.inject({
    method: "DELETE",
    url: `/v1/kuji/rooms/${productId}/entries/${secondRoom.viewer.entryId}`,
    headers: auth(second),
  });
  assert.equal(secondLeave.statusCode, 200, secondLeave.body);
  const roomAfterSecondLeaves = secondLeave.json() as RoomSnapshot;
  assert.equal(roomAfterSecondLeaves.viewer.state, "CANCELLED");
  assert.equal(
    Date.parse(roomAfterSecondLeaves.active!.checkoutExpiresAt!) - Date.parse(roomAfterSecondLeaves.serverNow),
    180_000,
  );

  const thirdPromoted = (await app.inject({
    method: "GET",
    url: `/v1/kuji/rooms/${productId}/entries/${thirdRoom.viewer.entryId}`,
    headers: auth(third),
  })).json() as RoomSnapshot;
  assert.equal(thirdPromoted.viewer.state, "CHECKOUT_PENDING");
  assert.equal(thirdPromoted.viewer.position, null);
  const remainingLeaseMs = Date.parse(thirdPromoted.viewer.checkoutExpiresAt!) - Date.parse(thirdPromoted.serverNow);
  assert.ok(remainingLeaseMs > 179_000 && remainingLeaseMs <= 180_000);
  const occupancy = await pool.query<{ count: string }>(
    `SELECT count(*) FROM kuji_room_entries
     WHERE product_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')`,
    [productId],
  );
  assert.equal(Number(occupancy.rows[0]!.count), 1);

  const contentionProductId = `kuji-contention-${suffix}`;
  await pool.query(
    `INSERT INTO catalog_products(id,sku,ip_id,category,name,price,image_url,is_prize_only)
     VALUES($1,$2,$3,'kuji',$4,9900,$5,false)`,
    [
      contentionProductId,
      `KUJI-CONTENTION-${suffix.toUpperCase()}`,
      ipId,
      `쿠지 동시 입장 ${suffix}`,
      `https://cdn.example.test/products/${contentionProductId}.png`,
    ],
  );
  await pool.query("INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,50,0)", [contentionProductId]);
  await publishDraw(contentionProductId, 1);
  await pool.query(
    "UPDATE catalog_products SET sale_status='ON_SALE' WHERE id=$1",
    [contentionProductId],
  );
  const otherProductConflict = await joinProduct(third, contentionProductId);
  assert.equal(otherProductConflict.statusCode, 409, otherProductConflict.body);

  const contenders = await Promise.all([
    createSession("contender-a"),
    createSession("contender-b"),
    createSession("contender-c"),
  ]);
  const joinedContenders = await Promise.all(
    contenders.map((session) => joinProduct(session, contentionProductId)),
  );
  assert.equal(joinedContenders.every((response) => response.statusCode === 201), true);
  const contenderEntries = joinedContenders.map((response) => (response.json() as RoomSnapshot).viewer.entryId);
  const settledContenders = await Promise.all(contenders.map((session, index) => app.inject({
    method: "GET",
    url: `/v1/kuji/rooms/${contentionProductId}/entries/${contenderEntries[index]}`,
    headers: auth(session),
  })));
  const contenderSnapshots = settledContenders.map((response) => response.json() as RoomSnapshot);
  assert.deepEqual(
    contenderSnapshots.map((snapshot) => snapshot.viewer.state).sort(),
    ["CHECKOUT_PENDING", "WAITING", "WAITING"],
  );
  assert.deepEqual(
    contenderSnapshots
      .map((snapshot) => snapshot.viewer.position)
      .filter((position): position is number => position !== null)
      .sort(),
    [1, 2],
  );
  const contentionOccupancy = await pool.query<{ count: string }>(
    `SELECT count(*) FROM kuji_room_entries
     WHERE product_id=$1 AND state IN ('CHECKOUT_PENDING','DRAWING')`,
    [contentionProductId],
  );
  assert.equal(Number(contentionOccupancy.rows[0]!.count), 1);

  const activeContenderIndex = contenderSnapshots.findIndex(
    (snapshot) => snapshot.viewer.state === "CHECKOUT_PENDING",
  );
  assert.ok(activeContenderIndex >= 0);
  const activeContenderEntryId = contenderEntries[activeContenderIndex]!;
  const drawingOrder = await pool.query<{ id: string }>(
    `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
     VALUES($1,'PAID',0,0,now()) RETURNING id`,
    [contenders[activeContenderIndex]!.actor.userId],
  );
  await pool.query(
    "INSERT INTO payments(order_id,provider,status,amount,paid_at) VALUES($1,'INTERNAL_ZERO','PAID',0,now())",
    [drawingOrder.rows[0]!.id],
  );
  await pool.query(
    "UPDATE kuji_room_entries SET order_id=$2 WHERE id=$1",
    [activeContenderEntryId, drawingOrder.rows[0]!.id],
  );
  await pool.query(
    `UPDATE kuji_room_entries
     SET state='DRAWING',drawing_started_at=now(),drawing_expires_at=now()+interval '5 minutes'
     WHERE id=$1`,
    [activeContenderEntryId],
  );
  const drawingSnapshotResponse = await app.inject({
    method: "GET",
    url: `/v1/kuji/rooms/${contentionProductId}/entries/${activeContenderEntryId}`,
    headers: auth(contenders[activeContenderIndex]!),
  });
  assert.equal(drawingSnapshotResponse.statusCode, 200, drawingSnapshotResponse.body);
  const drawingSnapshot = drawingSnapshotResponse.json() as RoomSnapshot;
  assert.equal(drawingSnapshot.viewer.state, "DRAWING");
  assert.equal(drawingSnapshot.viewer.checkoutExpiresAt, null);
  const drawingLeaseMs = Date.parse(drawingSnapshot.viewer.drawingExpiresAt!)
    - Date.parse(drawingSnapshot.serverNow);
  assert.ok(drawingLeaseMs > 299_000 && drawingLeaseMs <= 300_000);
  const drawingLeave = await app.inject({
    method: "DELETE",
    url: `/v1/kuji/rooms/${contentionProductId}/entries/${activeContenderEntryId}`,
    headers: auth(contenders[activeContenderIndex]!),
  });
  assert.equal(drawingLeave.statusCode, 409, drawingLeave.body);
  const drawingEntry = await pool.query<{ state: string }>(
    "SELECT state FROM kuji_room_entries WHERE id=$1",
    [activeContenderEntryId],
  );
  assert.equal(drawingEntry.rows[0]!.state, "DRAWING");
});
