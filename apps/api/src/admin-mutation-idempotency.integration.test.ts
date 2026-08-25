import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "./app.js";
import { issueSession } from "./plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "legacy admin mutations replay 201, 200, and 204 responses without duplicate side effects",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-admin-mutation-idempotency-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "admin-mutation-idempotency-integration-pepper",
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
    const admin = await pool.query<{ id: string }>(
      "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'ADMIN','ACTIVE') RETURNING id",
      [`admin-idempotency-${suffix}@example.test`, `멱등 관리자 ${suffix}`],
    );
    const session = await issueSession(pool, config, {
      userId: admin.rows[0]!.id,
      kind: "ADMIN",
      ip: "203.0.113.103",
      userAgent: "Dabboba Admin Mutation Idempotency Integration/1.0",
    });
    const headers = (key: string, reason: string) => ({
      authorization: `Bearer ${session.token}`,
      "idempotency-key": key,
      "x-admin-reason": reason,
    });

    const createKey = `admin-notice-create-${randomUUID()}`;
    const createReason = "공지 생성 멱등성 검증";
    const createPayload = {
      title: `멱등 공지 ${suffix}`,
      content: "같은 관리자 요청은 하나의 공지만 생성해야 합니다.",
      isPinned: false,
      isPublished: true,
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/notices",
      headers: headers(createKey, createReason),
      payload: createPayload,
    });
    assert.equal(created.statusCode, 201, created.body);
    const noticeId = (created.json() as { id: string }).id;

    const createReplay = await app.inject({
      method: "POST",
      url: "/v1/admin/notices",
      headers: headers(createKey, createReason),
      payload: createPayload,
    });
    assert.equal(createReplay.statusCode, 201, createReplay.body);
    assert.equal(createReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(createReplay.json(), created.json());

    const changedBody = await app.inject({
      method: "POST",
      url: "/v1/admin/notices",
      headers: headers(createKey, createReason),
      payload: { ...createPayload, content: "같은 키에 다른 본문" },
    });
    assert.equal(changedBody.statusCode, 409, changedBody.body);

    const changedReason = await app.inject({
      method: "POST",
      url: "/v1/admin/notices",
      headers: headers(createKey, "같은 키에 다른 감사 사유"),
      payload: createPayload,
    });
    assert.equal(changedReason.statusCode, 409, changedReason.body);

    const crossPath = await app.inject({
      method: "POST",
      url: "/v1/admin/ips",
      headers: headers(createKey, createReason),
      payload: {
        id: `blocked-${suffix}`,
        slug: `blocked-${suffix}`,
        nameKo: "교차 경로 차단",
        nameEn: "Cross Path Reuse",
        nameJa: null,
        aliases: [],
        description: "같은 관리자 키를 다른 경로에 재사용할 수 없습니다.",
        imageUrl: null,
        isActive: true,
      },
    });
    assert.equal(crossPath.statusCode, 409, crossPath.body);

    const updateKey = `admin-notice-update-${randomUUID()}`;
    const updateReason = "공지 수정 멱등성 검증";
    const updatePayload = { ...createPayload, title: `수정 공지 ${suffix}`, expectedVersion: 1 };
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/admin/notices/${noticeId}`,
      headers: headers(updateKey, updateReason),
      payload: updatePayload,
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal((updated.json() as { version: number }).version, 2);
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/v1/admin/notices/${noticeId}`,
      headers: headers(updateKey, updateReason),
      payload: updatePayload,
    });
    assert.equal(updateReplay.statusCode, 200, updateReplay.body);
    assert.equal(updateReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(updateReplay.json(), updated.json());

    const deleteKey = `admin-notice-delete-${randomUUID()}`;
    const deleteReason = "공지 삭제 멱등성 검증";
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/admin/notices/${noticeId}`,
      headers: headers(deleteKey, deleteReason),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleted.statusCode, 204, deleted.body);
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/v1/admin/notices/${noticeId}`,
      headers: headers(deleteKey, deleteReason),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleteReplay.statusCode, 204, deleteReplay.body);
    assert.equal(deleteReplay.headers["x-idempotent-replay"], "true");

    const restoreKey = `admin-notice-restore-${randomUUID()}`;
    const restoreReason = "공지 복구 멱등성 검증";
    const restored = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${noticeId}/restore`,
      headers: headers(restoreKey, restoreReason),
      payload: { expectedVersion: 3 },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const restoreReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${noticeId}/restore`,
      headers: headers(restoreKey, restoreReason),
      payload: { expectedVersion: 3 },
    });
    assert.equal(restoreReplay.statusCode, 200, restoreReplay.body);
    assert.equal(restoreReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(restoreReplay.json(), restored.json());

    const secondCreateKey = `admin-notice-second-${randomUUID()}`;
    const second = await app.inject({
      method: "POST",
      url: "/v1/admin/notices",
      headers: headers(secondCreateKey, "두 번째 공지 생성"),
      payload: { ...createPayload, title: `두 번째 공지 ${suffix}`, isPublished: false },
    });
    assert.equal(second.statusCode, 201, second.body);
    const secondNoticeId = (second.json() as { id: string }).id;

    const visibilityKey = `admin-notice-visibility-${randomUUID()}`;
    const visibilityReason = "공지 숨김 멱등성 검증";
    const hidden = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${noticeId}/visibility`,
      headers: headers(visibilityKey, visibilityReason),
      payload: { status: "HIDDEN", expectedVersion: 4 },
    });
    assert.equal(hidden.statusCode, 200, hidden.body);
    const hiddenReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${noticeId}/visibility`,
      headers: headers(visibilityKey, visibilityReason),
      payload: { status: "HIDDEN", expectedVersion: 4 },
    });
    assert.equal(hiddenReplay.statusCode, 200, hiddenReplay.body);
    assert.equal(hiddenReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(hiddenReplay.json(), hidden.json());

    const changedTarget = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${secondNoticeId}/visibility`,
      headers: headers(visibilityKey, visibilityReason),
      payload: { status: "HIDDEN", expectedVersion: 4 },
    });
    assert.equal(changedTarget.statusCode, 409, changedTarget.body);

    const state = await pool.query<{
      version: number;
      notice_count: string;
      version_count: string;
      audit_count: string;
      outbox_count: string;
      idempotency_count: string;
      blocked_ip_count: string;
    }>(`
      SELECT n.version,
        (SELECT count(*) FROM notices WHERE id=$1) AS notice_count,
        (SELECT count(*) FROM notice_versions WHERE notice_id=$1) AS version_count,
        (SELECT count(*) FROM admin_audit_logs WHERE target_type='NOTICE' AND target_id=$1::text) AS audit_count,
        (SELECT count(*) FROM outbox_events WHERE aggregate_type='NOTICE' AND aggregate_id=$1::text) AS outbox_count,
        (SELECT count(*) FROM idempotency_keys WHERE actor_id=$2 AND scope='ADMIN_MUTATION' AND state='COMPLETED' AND resource_id=$1::text) AS idempotency_count,
        (SELECT count(*) FROM catalog_ips WHERE id=$3) AS blocked_ip_count
      FROM notices n WHERE n.id=$1`, [noticeId, admin.rows[0]!.id, `blocked-${suffix}`]);
    assert.deepEqual(state.rows[0], {
      version: 5,
      notice_count: "1",
      version_count: "4",
      audit_count: "5",
      outbox_count: "3",
      idempotency_count: "5",
      blocked_ip_count: "0",
    });
  },
);
