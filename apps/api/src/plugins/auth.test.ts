import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { createAuthHooks, issueSession } from "./auth.js";

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
  scope: "FULL" as const,
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "member@example.test",
  nickname: "회원",
  role: "USER" as const,
  status: "ACTIVE" as const,
  suspended_until: null,
};

function request(warn = () => undefined, routeConfig: Record<string, unknown> = {}) {
  return {
    actor: null,
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    log: { warn },
    routeOptions: { config: routeConfig },
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

test("account-deletion sessions are rejected unless the route opts in", async () => {
  const deletionRow = { ...actorRow, scope: "ACCOUNT_DELETION" as const };
  const pool = {
    async query(sql: string) {
      if (sql.includes("WITH active_session")) return { rows: [deletionRow], rowCount: 1 };
      if (sql.includes("account_deletion_requests")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as DatabasePool;
  const hooks = createAuthHooks(pool, config);
  const requireUser = hooks.requireUserWithoutPolicy as unknown as (request: FastifyRequest) => Promise<void>;
  for (const routeConfig of [{}, { allowAccountDeletionScope: false }]) {
    await assert.rejects(
      () => requireUser(request(undefined, routeConfig)),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 403
        && error.code === "SESSION_SCOPE_FORBIDDEN",
    );
  }
  await assert.rejects(
    () => hooks.loadActor(request()),
    (error: unknown) => error instanceof AppError && error.code === "SESSION_SCOPE_FORBIDDEN",
  );
  const allowed = request(undefined, { allowAccountDeletionScope: true });
  await requireUser(allowed);
  assert.equal(allowed.actor?.sessionScope, "ACCOUNT_DELETION");

  const fullSession = request();
  const fullPool = {
    async query(sql: string) {
      if (sql.includes("WITH active_session")) return { rows: [actorRow], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as DatabasePool;
  assert.equal((await createAuthHooks(fullPool, config).loadActor(fullSession)).sessionScope, "FULL");
});

test("administrator lookups reject sessions past the absolute lifetime", async () => {
  let statement = "";
  let parameters: unknown[] = [];
  const pool = {
    async query(sql: string, values: unknown[]) {
      statement = sql;
      parameters = values;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabasePool;
  await assert.rejects(
    () => createAuthHooks(pool, { ...config, adminSessionMaxHours: 8 }).loadActor(request()),
    (error: unknown) => error instanceof AppError && error.statusCode === 401,
  );
  assert.match(statement, /s\.session_kind <> 'ADMIN'\s+OR s\.created_at \+ \(\$2::integer \* interval '1 hour'\) > now\(\)/);
  assert.equal(parameters[1], 8);

  await assert.rejects(() => createAuthHooks(pool, config).loadActor(request()));
  assert.equal(parameters[1], 12);
});

test("administrator sessions start with the idle window and never exceed the cap", async () => {
  const inserted: unknown[][] = [];
  const pool = {
    async query(_sql: string, values: unknown[]) {
      inserted.push(values);
      return { rows: [{ id: "33333333-3333-4333-8333-333333333333" }], rowCount: 1 };
    },
  } as unknown as DatabasePool;
  const before = Date.now();
  const admin = await issueSession(pool, { ...config, adminSessionIdleMinutes: 45 }, {
    userId: actorRow.user_id,
    kind: "ADMIN",
  });
  const after = Date.now();
  assert.ok(admin.expiresAt.getTime() >= before + 45 * 60_000, admin.expiresAt.toISOString());
  assert.ok(admin.expiresAt.getTime() <= after + 45 * 60_000, admin.expiresAt.toISOString());
  assert.equal(inserted[0]![2], "FULL");

  const customer = await issueSession(pool, config, { userId: actorRow.user_id, kind: "USER" });
  assert.ok(customer.expiresAt.getTime() - before > 29 * 86_400_000);

  const deletion = await issueSession(pool, config, {
    userId: actorRow.user_id,
    kind: "USER",
    scope: "ACCOUNT_DELETION",
    expiresInMs: 15 * 60_000,
  });
  assert.equal(inserted[2]![2], "ACCOUNT_DELETION");
  assert.ok(deletion.expiresAt.getTime() - before <= 15 * 60_000 + 1_000);
  await assert.rejects(
    () => issueSession(pool, config, { userId: actorRow.user_id, kind: "ADMIN", scope: "ACCOUNT_DELETION" }),
    /Account-deletion scope applies only to customer sessions/,
  );
});
