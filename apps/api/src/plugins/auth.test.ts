import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
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
