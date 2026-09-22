import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { createAuthHooks } from "./auth.js";

const config: ApiConfig = {
  environment: "test",
  surface: "all",
  host: "127.0.0.1",
  port: 8788,
  databaseUrl: "postgresql://unused",
  redisUrl: null,
  webOrigins: [],
  adminOrigins: [],
  sessionTokenPepper: "auth-hook-test-pepper",
  adminProxyIdentitySecret: null,
  supabaseUrl: null,
  supabaseJwtAudience: null,
  sessionTtlDays: 30,
  paymentProvider: "UNCONFIGURED",
  paymentWebhookSecret: null,
  gcsBucket: null,
  gcsProjectId: null,
  logLevel: "silent",
};

const actorRow = {
  session_id: "11111111-1111-4111-8111-111111111111",
  session_kind: "USER" as const,
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "member@example.test",
  nickname: "회원",
  role: "USER" as const,
  status: "ACTIVE" as const,
  suspended_until: null,
};

function request(warn = () => undefined) {
  return {
    actor: null,
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    log: { warn },
  } as unknown as FastifyRequest;
}

test("actor loading authenticates and touches stale last-seen state in one bounded statement", async () => {
  let calls = 0;
  let statement = "";
  const pool = {
    async query(sql: string) {
      calls += 1;
      statement = sql;
      return { rows: [actorRow], rowCount: 1 };
    },
  } as unknown as DatabasePool;

  const actor = await createAuthHooks(pool, config).loadActor(request());
  assert.equal(actor.userId, actorRow.user_id);
  assert.equal(calls, 1);
  assert.match(statement, /UPDATE sessions/);
  assert.match(statement, /FOR UPDATE OF s SKIP LOCKED/);
});

test("active customer sessions fail closed with exact current policy versions", async () => {
  let calls = 0;
  const pool = {
    async query(sql: string) {
      calls += 1;
      if (sql.includes("WITH active_session")) return { rows: [actorRow], rowCount: 1 };
      if (sql.includes("account_deletion_requests")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM legal_document_versions")) {
        return {
          rowCount: 2,
          rows: [
            { policy_key: "PRIVACY", policy_version: "2026-09-22", content_sha256: "b".repeat(64) },
            { policy_key: "TERMS", policy_version: "2026-09-22", content_sha256: "a".repeat(64) },
          ],
        };
      }
      if (sql.includes("accepted_count")) return { rows: [{ accepted_count: 1 }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as DatabasePool;
  const hooks = createAuthHooks(pool, config);
  await assert.rejects(
    () => (hooks.requireUser as unknown as (request: FastifyRequest) => Promise<void>)(request()),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 428
      && error.code === "LEGAL_ACCEPTANCE_REQUIRED"
      && JSON.stringify(error.details) === JSON.stringify({
        requiredPolicyVersions: { terms: "2026-09-22", privacy: "2026-09-22" },
      }),
  );
  assert.equal(calls, 4);
});

test("safe account recovery hooks authenticate without requiring policy acceptance", async () => {
  const statements: string[] = [];
  const pool = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("WITH active_session")) return { rows: [actorRow], rowCount: 1 };
      if (sql.includes("account_deletion_requests")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as DatabasePool;
  const hooks = createAuthHooks(pool, config);
  await (hooks.requireUserWithoutPolicy as unknown as (request: FastifyRequest) => Promise<void>)(request());
  assert.equal(statements.some((sql) => sql.includes("legal_document_versions")), false);
});
