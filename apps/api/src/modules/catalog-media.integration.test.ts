import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildAppCore } from "../app-core.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import type { ApiMediaRuntime } from "../lib/media-runtime.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "catalog media stays admin-owned, versioned, privately delivered, and snapshot-retained",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-catalog-media-integration");
    let uploadCalls = 0;
    let signedReadCalls = 0;
    const mediaRuntime: ApiMediaRuntime = {
      completionAvailable: true,
      configuredMediaStorage() {
        return {
          provider: "gcs",
          bucket: "catalog-media-test",
          location: { provider: "gcs", bucket: "catalog-media-test" },
          file(name: string) {
            return {
              name,
              async info() {
                return { version: "1", size: 1, contentType: "image/webp", metadata: {} };
              },
              read() {
                return Readable.from([Buffer.from([0])]);
              },
              async delete() {},
            };
          },
          async upload(input) {
            uploadCalls += 1;
            return {
              uploadUrl: "https://storage.example.test/catalog-upload",
              method: "POST" as const,
              fields: { key: input.key },
              fileFieldName: "file" as const,
              expiresAt: input.expiresAt.toISOString(),
              maxBytes: input.byteSize,
            };
          },
          async saveFinal(key: string, data: Buffer) {
            return { version: "1", size: data.length, contentType: "image/webp", metadata: {}, key };
          },
          async signedRead(key: string, version: string | null) {
            signedReadCalls += 1;
            assert.equal(version, "1");
            return `https://storage.example.test/private/${encodeURIComponent(key)}?signature=server-only`;
          },
        };
      },
      async sanitizeImage() {
        throw new Error("READY media must not be sanitized again in this test");
      },
    };
    const baseConfig: ApiConfig = {
      environment: "test",
      surface: "all",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: null,
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "catalog-media-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: "catalog-media-test",
      gcsProjectId: "catalog-media-test",
      catalogMediaBaseUrl: "https://public.example.test/functions/v1/dabboba-api",
      logLevel: "silent",
    };
    const { app } = await buildAppCore({ config: baseConfig, mediaRuntime, pool, redis: null });
    const { app: noBaseApp } = await buildAppCore({
      config: { ...baseConfig, catalogMediaBaseUrl: null },
      mediaRuntime,
      pool,
      redis: null,
    });
    const { app: edgeApp } = await buildAppCore({
      config: baseConfig,
      mediaRuntime: { ...mediaRuntime, completionAvailable: false },
      pool,
      redis: null,
    });
    const { app: customerSurfaceApp } = await buildAppCore({
      config: { ...baseConfig, surface: "customer" },
      mediaRuntime,
      pool,
      redis: null,
    });
    const { app: adminSurfaceApp } = await buildAppCore({
      config: { ...baseConfig, surface: "admin" },
      mediaRuntime,
      pool,
      redis: null,
    });
    t.after(async () => {
      await Promise.all([
        app.close(),
        noBaseApp.close(),
        edgeApp.close(),
        customerSurfaceApp.close(),
        adminSurfaceApp.close(),
      ]);
      await pool.end();
    });
    assert.equal(customerSurfaceApp.hasRoute({ method: "GET", url: "/v1/catalog/media/:mediaId/image" }), true);
    assert.equal(customerSurfaceApp.hasRoute({ method: "POST", url: "/v1/admin/catalog-media/uploads" }), false);
    assert.equal(customerSurfaceApp.hasRoute({ method: "PATCH", url: "/v1/admin/products/:productId/image" }), false);
    assert.equal(customerSurfaceApp.hasRoute({ method: "DELETE", url: "/v1/admin/products/:productId/image" }), false);
    assert.equal(adminSurfaceApp.hasRoute({ method: "GET", url: "/v1/catalog/media/:mediaId/image" }), false);
    assert.equal(adminSurfaceApp.hasRoute({ method: "POST", url: "/v1/admin/catalog-media/uploads" }), true);
    assert.equal(adminSurfaceApp.hasRoute({ method: "PATCH", url: "/v1/admin/products/:productId/image" }), true);
    assert.equal(adminSurfaceApp.hasRoute({ method: "DELETE", url: "/v1/admin/products/:productId/image" }), true);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (role: "USER" | "ADMIN", label: string) => {
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`catalog-media-${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      if (role === "USER") {
        await acceptRequiredPoliciesForIntegrationTest(pool, created.rows[0]!.id);
      }
      const session = await issueSession(pool, baseConfig, {
        userId: created.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
        ip: "203.0.113.91",
        userAgent: "Dabboba Catalog Media Integration/1.0",
      });
      return { id: created.rows[0]!.id, token: session.token };
    };
    const user = await createActor("USER", "customer");
    const admin = await createActor("ADMIN", "operator");
    const otherAdmin = await createActor("ADMIN", "other-operator");
    const mutationHeaders = (token: string, reason: string, key = `catalog-media-${randomUUID()}`) => ({
      authorization: `Bearer ${token}`,
      "x-admin-reason": reason,
      "idempotency-key": key,
    });
    const userHeaders = (token: string, key = `user-media-${randomUUID()}`) => ({
      authorization: `Bearer ${token}`,
      "idempotency-key": key,
    });
    const uploadPayload = {
      filename: "catalog.png",
      mimeType: "image/png",
      byteSize: 128,
      checksumSha256: "a".repeat(64),
      acceptedUploadMethods: ["POST", "PUT"],
    };

    const userDenied = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: mutationHeaders(user.token, "상품 이미지 업로드"),
      payload: uploadPayload,
    });
    assert.equal(userDenied.statusCode, 403, userDenied.body);
    assert.equal(uploadCalls, 0);

    const edgeUnavailable = await edgeApp.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: mutationHeaders(admin.token, "상품 이미지 업로드"),
      payload: uploadPayload,
    });
    assert.equal(edgeUnavailable.statusCode, 503, edgeUnavailable.body);
    assert.equal((edgeUnavailable.json() as { error: { code: string } }).error.code, "MEDIA_PROCESSING_UNAVAILABLE");
    assert.equal(uploadCalls, 0);

    const baseUnavailable = await noBaseApp.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: mutationHeaders(admin.token, "상품 이미지 업로드"),
      payload: uploadPayload,
    });
    assert.equal(baseUnavailable.statusCode, 503, baseUnavailable.body);
    assert.equal((baseUnavailable.json() as { error: { code: string } }).error.code, "CATALOG_MEDIA_DELIVERY_UNAVAILABLE");
    assert.equal(uploadCalls, 0);

    const userCatalogRejected = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: userHeaders(user.token),
      payload: { ...uploadPayload, purpose: "CATALOG" },
    });
    assert.equal(userCatalogRejected.statusCode, 400, userCatalogRejected.body);
    assert.equal(uploadCalls, 0);

    const missingReason = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: {
        authorization: `Bearer ${admin.token}`,
        "idempotency-key": `catalog-upload-${randomUUID()}`,
      },
      payload: uploadPayload,
    });
    assert.equal(missingReason.statusCode, 400, missingReason.body);
    assert.equal(uploadCalls, 0);

    const uploadKey = `catalog-upload-${randomUUID()}`;
    const upload = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: mutationHeaders(admin.token, "상품 이미지 업로드", uploadKey),
      payload: uploadPayload,
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const uploadBody = upload.json() as { mediaId: string; method: string; maxBytes: number };
    assert.equal(uploadBody.method, "POST");
    assert.equal(uploadBody.maxBytes, uploadPayload.byteSize);
    const uploadReplay = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog-media/uploads",
      headers: mutationHeaders(admin.token, "상품 이미지 업로드", uploadKey),
      payload: uploadPayload,
    });
    assert.equal(uploadReplay.statusCode, 201, uploadReplay.body);
    assert.equal(uploadReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(uploadReplay.json(), uploadBody);
    const reserved = await pool.query<{ owner_id: string; purpose: string; status: string }>(
      "SELECT owner_id,purpose,status FROM media_assets WHERE id=$1",
      [uploadBody.mediaId],
    );
    assert.deepEqual(reserved.rows[0], { owner_id: admin.id, purpose: "CATALOG", status: "PENDING_UPLOAD" });

    const insertMedia = async (
      ownerId: string,
      purpose: "CATALOG" | "POST",
      status: "PENDING_UPLOAD" | "READY",
      dimensions = { width: 1, height: 1 },
    ) => {
      const mediaId = randomUUID();
      await pool.query(
        `INSERT INTO media_assets
          (id,owner_id,purpose,object_key,object_generation,original_filename,declared_mime_type,
           detected_mime_type,byte_size,checksum_sha256,status,width,height,metadata)
         VALUES($1,$2,$3,$4,1,'catalog.webp','image/webp',$5,1,$6,$7,$8,$9,$10::jsonb)`,
        [
          mediaId,
          ownerId,
          purpose,
          `media/${mediaId}/${"b".repeat(64)}.webp`,
          status === "READY" ? "image/webp" : null,
          "b".repeat(64),
          status,
          status === "READY" ? dimensions.width : null,
          status === "READY" ? dimensions.height : null,
          JSON.stringify({ storage: { provider: "gcs", bucket: "catalog-media-test", version: "1" } }),
        ],
      );
      return mediaId;
    };
    const readyMediaId = await insertMedia(admin.id, "CATALOG", "READY");
    const otherOwnerMediaId = await insertMedia(otherAdmin.id, "CATALOG", "READY");
    const userCatalogMediaId = await insertMedia(user.id, "CATALOG", "READY");
    const wrongPurposeMediaId = await insertMedia(admin.id, "POST", "READY");
    const pendingMediaId = await insertMedia(admin.id, "CATALOG", "PENDING_UPLOAD");
    const unassignedMediaId = await insertMedia(admin.id, "CATALOG", "READY");
    const gachaStorefrontMediaId = await insertMedia(admin.id, "CATALOG", "READY", { width: 1_080, height: 1_080 });
    const gachaPrimaryMediaId = await insertMedia(admin.id, "CATALOG", "READY");
    const undersizedGachaMediaId = await insertMedia(admin.id, "CATALOG", "READY", { width: 1_079, height: 1_079 });
    const kujiStorefrontMediaId = await insertMedia(admin.id, "CATALOG", "READY", { width: 1_200, height: 675 });

    const userCompleteRejected = await app.inject({
      method: "POST",
      url: `/v1/media/${userCatalogMediaId}/complete`,
      headers: userHeaders(user.token),
    });
    assert.equal(userCompleteRejected.statusCode, 403, userCompleteRejected.body);
    const otherOwnerCompleteRejected = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-media/${readyMediaId}/complete`,
      headers: mutationHeaders(otherAdmin.token, "상품 이미지 완료"),
    });
    assert.equal(otherOwnerCompleteRejected.statusCode, 403, otherOwnerCompleteRejected.body);

    const completeKey = `catalog-complete-${randomUUID()}`;
    const completed = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-media/${readyMediaId}/complete`,
      headers: mutationHeaders(admin.token, "상품 이미지 완료", completeKey),
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.deepEqual(completed.json(), { mediaId: readyMediaId, status: "READY", mimeType: "image/webp" });
    const completeReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-media/${readyMediaId}/complete`,
      headers: mutationHeaders(admin.token, "상품 이미지 완료", completeKey),
    });
    assert.equal(completeReplay.statusCode, 200, completeReplay.body);
    assert.equal(completeReplay.headers["x-idempotent-replay"], "true");

    const ipId = `catalog-media-${suffix}`;
    const productId = `catalog-prize-${suffix}`;
    const drawProductId = `catalog-draw-${suffix}`;
    const kujiProductId = `catalog-kuji-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `미디어 IP ${suffix}`, `Media IP ${suffix}`],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,manufacturer,price,metadata,is_active,is_prize_only)
       VALUES($1,$2,$3,'figure',$4,'DABBOBA',10000,'{"source":"catalog-media-test"}',true,true),
             ($5,$6,$3,'gacha',$7,'DABBOBA',3000,'{}',true,false)`,
      [
        productId,
        `CATALOG-PRIZE-${suffix}`.toUpperCase(),
        ipId,
        `상품 ${suffix}`,
        drawProductId,
        `CATALOG-DRAW-${suffix}`.toUpperCase(),
        `추첨 ${suffix}`,
      ],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,manufacturer,price,metadata,is_active,is_prize_only)
       VALUES($1,$2,$3,'kuji',$4,'DABBOBA',5000,'{}',true,false)`,
      [kujiProductId, `CATALOG-KUJI-${suffix}`.toUpperCase(), ipId, `쿠지 ${suffix}`],
    );
    await pool.query(
      "INSERT INTO product_stock(product_id,on_hand,reserved) VALUES($1,7,2),($2,11,3),($3,80,0)",
      [productId, drawProductId, kujiProductId],
    );

    const attach = (
      mediaId: string,
      expectedVersion: number,
      key = `catalog-attach-${randomUUID()}`,
      targetProductId = productId,
      role?: "primary" | "storefront",
    ) => app.inject({
      method: "PATCH",
      url: `/v1/admin/products/${targetProductId}/image`,
      headers: mutationHeaders(admin.token, "상품 대표 이미지 연결", key),
      payload: { mediaId, expectedVersion, ...(role ? { role } : {}) },
    });
    assert.equal((await attach(wrongPurposeMediaId, 1)).statusCode, 404);
    assert.equal((await attach(pendingMediaId, 1)).statusCode, 404);
    assert.equal((await attach(otherOwnerMediaId, 1)).statusCode, 404);

    const attachKey = `catalog-attach-${randomUUID()}`;
    const attached = await attach(readyMediaId, 1, attachKey);
    assert.equal(attached.statusCode, 200, attached.body);
    const stableUrl = `https://public.example.test/functions/v1/dabboba-api/v1/catalog/media/${readyMediaId}/image`;
    assert.deepEqual(attached.json(), {
      productId,
      imageUrl: stableUrl,
      version: 2,
      mediaId: readyMediaId,
      role: "primary",
    });
    const preserved = await pool.query<{
      image_url: string;
      storefront_image_url: string | null;
      version: number;
      manufacturer: string;
      price: number;
      metadata: { source: string };
      on_hand: number;
      reserved: number;
      stock_version: number;
    }>(
      `SELECT product.image_url,product.storefront_image_url,product.version,product.manufacturer,product.price,product.metadata,
              stock.on_hand,stock.reserved,stock.version AS stock_version
       FROM catalog_products product JOIN product_stock stock ON stock.product_id=product.id
       WHERE product.id=$1`,
      [productId],
    );
    assert.deepEqual(preserved.rows[0], {
      image_url: stableUrl,
      storefront_image_url: null,
      version: 2,
      manufacturer: "DABBOBA",
      price: 10000,
      metadata: { source: "catalog-media-test" },
      on_hand: 7,
      reserved: 2,
      stock_version: 1,
    });
    const attachedMetadata = await pool.query<{ delivery_url: string }>(
      "SELECT metadata->>'catalogDeliveryUrl' AS delivery_url FROM media_assets WHERE id=$1",
      [readyMediaId],
    );
    assert.equal(attachedMetadata.rows[0]!.delivery_url, stableUrl);
    const attachReplay = await attach(readyMediaId, 1, attachKey);
    assert.equal(attachReplay.statusCode, 200, attachReplay.body);
    assert.equal(attachReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(attachReplay.json(), attached.json());
    const staleAttach = await attach(readyMediaId, 1);
    assert.equal(staleAttach.statusCode, 409, staleAttach.body);

    const unsupportedStorefront = await attach(
      gachaStorefrontMediaId,
      2,
      `catalog-attach-${randomUUID()}`,
      productId,
      "storefront",
    );
    assert.equal(unsupportedStorefront.statusCode, 400, unsupportedStorefront.body);
    const undersizedStorefront = await attach(
      undersizedGachaMediaId,
      1,
      `catalog-attach-${randomUUID()}`,
      drawProductId,
      "storefront",
    );
    assert.equal(undersizedStorefront.statusCode, 400, undersizedStorefront.body);

    const gachaPrimary = await attach(gachaPrimaryMediaId, 1, `catalog-attach-${randomUUID()}`, drawProductId);
    assert.equal(gachaPrimary.statusCode, 200, gachaPrimary.body);
    const gachaPrimaryUrl = `https://public.example.test/functions/v1/dabboba-api/v1/catalog/media/${gachaPrimaryMediaId}/image`;

    const gachaStorefront = await attach(
      gachaStorefrontMediaId,
      2,
      `catalog-attach-${randomUUID()}`,
      drawProductId,
      "storefront",
    );
    const gachaStorefrontUrl = `https://public.example.test/functions/v1/dabboba-api/v1/catalog/media/${gachaStorefrontMediaId}/image`;
    assert.equal(gachaStorefront.statusCode, 200, gachaStorefront.body);
    assert.deepEqual(gachaStorefront.json(), {
      productId: drawProductId,
      imageUrl: gachaStorefrontUrl,
      version: 3,
      mediaId: gachaStorefrontMediaId,
      role: "storefront",
    });
    const gachaImages = await pool.query<{ image_url: string | null; storefront_image_url: string | null }>(
      "SELECT image_url,storefront_image_url FROM catalog_products WHERE id=$1",
      [drawProductId],
    );
    assert.deepEqual(gachaImages.rows[0], { image_url: gachaPrimaryUrl, storefront_image_url: gachaStorefrontUrl });

    const kujiStorefront = await attach(
      kujiStorefrontMediaId,
      1,
      `catalog-attach-${randomUUID()}`,
      kujiProductId,
      "storefront",
    );
    assert.equal(kujiStorefront.statusCode, 200, kujiStorefront.body);
    assert.equal((kujiStorefront.json() as { role: string }).role, "storefront");

    const unassignedPublic = await app.inject({ method: "GET", url: `/v1/catalog/media/${unassignedMediaId}/image` });
    assert.equal(unassignedPublic.statusCode, 404, unassignedPublic.body);
    const activePublic = await app.inject({ method: "GET", url: `/v1/catalog/media/${readyMediaId}/image` });
    assert.equal(activePublic.statusCode, 302, activePublic.body);
    assert.equal(activePublic.headers["cache-control"], "private, no-store");
    assert.match(String(activePublic.headers.location), /^https:\/\/storage\.example\.test\/private\//);
    assert.equal(signedReadCalls, 1);
    const storefrontPublic = await app.inject({ method: "GET", url: `/v1/catalog/media/${gachaStorefrontMediaId}/image` });
    assert.equal(storefrontPublic.statusCode, 302, storefrontPublic.body);
    assert.equal(signedReadCalls, 2);

    const clearStorefront = (
      expectedVersion: number,
      key = `catalog-clear-${randomUUID()}`,
      role: "primary" | "storefront" = "storefront",
      token = admin.token,
    ) => app.inject({
      method: "DELETE",
      url: `/v1/admin/products/${drawProductId}/image`,
      headers: mutationHeaders(token, "상품 목록 사진 연결 해제", key),
      payload: { expectedVersion, role },
    });
    assert.equal((await clearStorefront(3, undefined, "primary")).statusCode, 400);
    assert.equal((await clearStorefront(3, undefined, "storefront", user.token)).statusCode, 403);
    assert.equal((await clearStorefront(2)).statusCode, 409);

    const clearKey = `catalog-clear-${randomUUID()}`;
    const cleared = await clearStorefront(3, clearKey);
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json(), {
      productId: drawProductId,
      imageUrl: null,
      version: 4,
      role: "storefront",
    });
    const clearReplay = await clearStorefront(3, clearKey);
    assert.equal(clearReplay.statusCode, 200, clearReplay.body);
    assert.equal(clearReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(clearReplay.json(), cleared.json());
    assert.equal((await clearStorefront(4, clearKey)).statusCode, 409);
    assert.equal((await clearStorefront(4)).statusCode, 409);

    const clearedImages = await pool.query<{ image_url: string | null; storefront_image_url: string | null; version: number }>(
      "SELECT image_url,storefront_image_url,version FROM catalog_products WHERE id=$1",
      [drawProductId],
    );
    assert.deepEqual(clearedImages.rows[0], { image_url: gachaPrimaryUrl, storefront_image_url: null, version: 4 });
    const clearedPublic = await app.inject({ method: "GET", url: `/v1/catalog/media/${gachaStorefrontMediaId}/image` });
    assert.equal(clearedPublic.statusCode, 404, clearedPublic.body);
    const clearAudit = await pool.query<{ action: string }>(
      "SELECT action FROM admin_audit_logs WHERE target_type='PRODUCT' AND target_id=$1 AND action='PRODUCT_STOREFRONT_IMAGE_CLEARED'",
      [drawProductId],
    );
    assert.equal(clearAudit.rowCount, 1);
    const clearOutbox = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM outbox_events WHERE aggregate_type='PRODUCT' AND aggregate_id=$1 AND event_type='catalog.product.storefront_image_cleared'",
      [drawProductId],
    );
    assert.equal(clearOutbox.rowCount, 1);

    const version = await pool.query<{ id: string }>(
      "INSERT INTO draw_probability_versions(product_id,version,status) VALUES($1,1,'DRAFT') RETURNING id",
      [drawProductId],
    );
    await pool.query(
      `INSERT INTO draw_pool_entries
        (probability_version_id,prize_product_id,rarity,weight,initial_quantity,remaining_quantity,
         prize_name_snapshot,prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot)
       SELECT $1,id,'A',1,11,11,name,image_url,sku,ip_id,category FROM catalog_products WHERE id=$2`,
      [version.rows[0]!.id, productId],
    );
    await pool.query(
      "UPDATE draw_probability_versions SET status='ACTIVE',published_by=$2,published_at=now() WHERE id=$1",
      [version.rows[0]!.id, admin.id],
    );
    await pool.query("UPDATE catalog_ips SET is_active=false WHERE id=$1", [ipId]);
    const snapshotPublic = await app.inject({ method: "GET", url: `/v1/catalog/media/${readyMediaId}/image` });
    assert.equal(snapshotPublic.statusCode, 302, snapshotPublic.body);

    const deleteAttached = await app.inject({
      method: "DELETE",
      url: `/v1/admin/catalog-media/${readyMediaId}`,
      headers: mutationHeaders(admin.token, "연결 이미지 삭제 검증"),
    });
    assert.equal(deleteAttached.statusCode, 409, deleteAttached.body);
    const deleteUnassigned = await app.inject({
      method: "DELETE",
      url: `/v1/admin/catalog-media/${unassignedMediaId}`,
      headers: mutationHeaders(admin.token, "미사용 이미지 정리"),
    });
    assert.equal(deleteUnassigned.statusCode, 204, deleteUnassigned.body);

    const audit = await pool.query<{ action: string; reason: string }>(
      `SELECT action,reason FROM admin_audit_logs
       WHERE admin_id=$1 AND target_id IN ($2,$3,$4)
       ORDER BY created_at,id`,
      [admin.id, uploadBody.mediaId, readyMediaId, productId],
    );
    assert.ok(audit.rows.some((row) => row.action === "CATALOG_MEDIA_UPLOAD_INTENT_CREATED" && row.reason === "상품 이미지 업로드"));
    assert.ok(audit.rows.some((row) => row.action === "CATALOG_MEDIA_UPLOAD_COMPLETED" && row.reason === "상품 이미지 완료"));
    assert.ok(audit.rows.some((row) => row.action === "PRODUCT_IMAGE_ATTACHED" && row.reason === "상품 대표 이미지 연결"));
  },
);
