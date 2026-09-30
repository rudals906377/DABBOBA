import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import type { Actor } from "../plugins/auth.js";
import { adminMutationHeaders, writeAdminAudit } from "./audit.js";

function request(headers: Record<string, string>, id = "request-1") {
  return { headers, id } as unknown as FastifyRequest;
}

const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";

test("admin mutation headers decode explicitly marked UTF-8 reasons and retain legacy ASCII", () => {
  assert.deepEqual(adminMutationHeaders(request({
    "x-admin-reason": "catalog price correction",
    "idempotency-key": idempotencyKey,
  })), { reason: "catalog price correction", idempotencyKey });

  assert.deepEqual(adminMutationHeaders(request({
    "x-admin-reason": "기존 테스트 사유",
    "idempotency-key": idempotencyKey,
  })), { reason: "기존 테스트 사유", idempotencyKey });

  const reason = "쿠지 확률표 초안 생성";
  assert.deepEqual(adminMutationHeaders(request({
    "x-admin-reason": encodeURIComponent(reason),
    "x-admin-reason-encoding": "utf-8-percent",
    "idempotency-key": idempotencyKey,
  }), reason), { reason, idempotencyKey });
});

test("admin mutation headers reject malformed, unknown, control, overlong, and mismatched reasons", () => {
  const base = { "idempotency-key": idempotencyKey, "x-admin-reason-encoding": "utf-8-percent" };
  assert.throws(() => adminMutationHeaders(request({ ...base, "x-admin-reason": "%E0%A4%A" })), /인코딩/);
  assert.throws(() => adminMutationHeaders(request({ ...base, "x-admin-reason": "ok", "x-admin-reason-encoding": "base64" })), /인코딩/);
  assert.throws(() => adminMutationHeaders(request({ ...base, "x-admin-reason": encodeURIComponent("줄바꿈\n거절") })), /2~1000자/);
  assert.throws(() => adminMutationHeaders(request({ ...base, "x-admin-reason": "a".repeat(9_001) })), /너무 깁니다/);
  assert.throws(() => adminMutationHeaders(request({ ...base, "x-admin-reason": encodeURIComponent("실제 사유") }), "다른 사유"), /일치/);
});

test("admin audit stores the decoded Korean reason without changing its text", async () => {
  const reason = "상품 가격 수정 사유";
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push(values ? { sql, values } : { sql });
      if (sql.includes("FROM sessions")) {
        return { rowCount: 1, rows: [{ ip_address: "127.0.0.1", user_agent: "test" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabaseClient;
  const actor: Actor = {
    userId: "admin-1", email: "admin@example.test", nickname: "관리자", role: "ADMIN",
    status: "ACTIVE", sessionId: "session-1", sessionKind: "ADMIN", sessionScope: "FULL",
  };

  await writeAdminAudit(client, request({
    "x-admin-reason": encodeURIComponent(reason),
    "x-admin-reason-encoding": "utf-8-percent",
    "idempotency-key": idempotencyKey,
  }), actor, { action: "CATALOG_UPDATE", targetType: "PRODUCT", targetId: "product-1", reason });

  const insert = calls.find((call) => call.sql.includes("INSERT INTO admin_audit_logs"));
  assert.ok(insert);
  assert.equal(insert.values?.[4], reason);
});
