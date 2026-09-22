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

type Session = {
  token: string;
  actor: { userId: string };
};

test(
  "wanted request owner update/delete lifecycle preserves version and unique likes",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-wanted-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "wanted-integration-session-pepper-value",
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
    const ipId = `wanted-lifecycle-${suffix}`;
    await pool.query(
      `INSERT INTO catalog_ips(id,slug,name_ko,name_en)
       VALUES($1,$2,$3,$4)`,
      [ipId, ipId, `신청방 테스트 ${suffix}`, `Wanted lifecycle ${suffix}`],
    );
    const session = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email: `wanted-${label}-${suffix}@example.test` },
      });
      assert.equal(response.statusCode, 201, response.body);
      const created = response.json() as Session;
      await acceptRequiredPoliciesForIntegrationTest(pool, created.actor.userId);
      await acceptUgcOperationsPolicyForIntegrationTest(pool, created.actor.userId);
      return created;
    };
    const owner = await session("owner");
    const other = await session("other");
    const headers = (value: Session, key = randomUUID()) => ({
      authorization: `Bearer ${value.token}`,
      "idempotency-key": key,
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/wanted-requests",
      headers: headers(owner),
      payload: {
        category: "figure",
        ipId,
        desiredItem: "수정 전 신청 상품",
        details: "신청 글 생명주기 검증",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdBody = created.json() as { id: string; version: number; likeCount: number };
    const requestId = createdBody.id;
    assert.equal(createdBody.version, 1);
    assert.equal(createdBody.likeCount, 0);

    const emptyPatch = await app.inject({
      method: "PATCH",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner),
      payload: { expectedVersion: 1 },
    });
    assert.equal(emptyPatch.statusCode, 400, emptyPatch.body);
    const deniedPatch = await app.inject({
      method: "PATCH",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(other),
      payload: { expectedVersion: 1, desiredItem: "권한 없는 수정" },
    });
    assert.equal(deniedPatch.statusCode, 403, deniedPatch.body);

    const patchKey = randomUUID();
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner, patchKey),
      payload: {
        expectedVersion: 1,
        category: "gacha",
        desiredItem: "수정된 신청 상품",
        details: "수정된 상세 내용",
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    const updatedBody = updated.json() as {
      version: number; category: string; desiredItem: string; details: string;
    };
    assert.deepEqual(
      {
        version: updatedBody.version,
        category: updatedBody.category,
        desiredItem: updatedBody.desiredItem,
        details: updatedBody.details,
      },
      {
        version: 2,
        category: "gacha",
        desiredItem: "수정된 신청 상품",
        details: "수정된 상세 내용",
      },
    );
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner, patchKey),
      payload: {
        expectedVersion: 1,
        category: "gacha",
        desiredItem: "수정된 신청 상품",
        details: "수정된 상세 내용",
      },
    });
    assert.equal(updateReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(updateReplay.json(), updated.json());
    const stalePatch = await app.inject({
      method: "PATCH",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner),
      payload: { expectedVersion: 1, details: "오래된 수정" },
    });
    assert.equal(stalePatch.statusCode, 409, stalePatch.body);

    const firstLike = await app.inject({
      method: "POST",
      url: `/v1/wanted-requests/${requestId}/like`,
      headers: headers(other),
      payload: { liked: true },
    });
    assert.equal(firstLike.statusCode, 200, firstLike.body);
    assert.deepEqual(firstLike.json(), { requestId, liked: true, likeCount: 1 });
    const duplicateDesiredLike = await app.inject({
      method: "POST",
      url: `/v1/wanted-requests/${requestId}/like`,
      headers: headers(other),
      payload: { liked: true },
    });
    assert.deepEqual(duplicateDesiredLike.json(), { requestId, liked: true, likeCount: 1 });
    const uniqueLike = await pool.query<{ count: string }>(
      "SELECT count(*) FROM wanted_request_likes WHERE request_id=$1 AND user_id=$2",
      [requestId, other.actor.userId],
    );
    assert.equal(Number(uniqueLike.rows[0]!.count), 1);
    const selfLike = await app.inject({
      method: "POST",
      url: `/v1/wanted-requests/${requestId}/like`,
      headers: headers(owner),
      payload: { liked: true },
    });
    assert.equal(selfLike.statusCode, 403, selfLike.body);

    const authenticatedList = await app.inject({
      method: "GET",
      url: `/v1/wanted-requests?ipId=${ipId}&limit=1`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    assert.equal(authenticatedList.statusCode, 200, authenticatedList.body);
    const listed = (authenticatedList.json() as {
      items: Array<{ id: string; likedByViewer: boolean; version: number }>;
    }).items.find((item) => item.id === requestId);
    assert.equal(listed?.id, requestId);
    assert.equal(listed?.likedByViewer, true);
    assert.equal(listed?.version, 2);

    const deniedDelete = await app.inject({
      method: "DELETE",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(other),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deniedDelete.statusCode, 403, deniedDelete.body);
    const staleDelete = await app.inject({
      method: "DELETE",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner),
      payload: { expectedVersion: 1 },
    });
    assert.equal(staleDelete.statusCode, 409, staleDelete.body);
    const deleteKey = randomUUID();
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner, deleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json(), { requestId, status: "DELETED", version: 3 });
    const deleteReplay = await app.inject({
      method: "DELETE",
      url: `/v1/wanted-requests/${requestId}`,
      headers: headers(owner, deleteKey),
      payload: { expectedVersion: 2 },
    });
    assert.equal(deleteReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(deleteReplay.json(), deleted.json());

    const publicListAfterDelete = await app.inject({
      method: "GET",
      url: `/v1/wanted-requests?ipId=${ipId}&limit=100`,
    });
    assert.ok(!(publicListAfterDelete.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === requestId));
    const stored = await pool.query<{ status: string; version: number }>(
      "SELECT status,version FROM wanted_requests WHERE id=$1",
      [requestId],
    );
    assert.deepEqual(stored.rows[0], { status: "DELETED", version: 3 });
  },
);
