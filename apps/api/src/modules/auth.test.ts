import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiContext } from "../types.js";
import { AppError } from "../lib/errors.js";
import { nextAdminLoginFailureState, registerAuthRoutes } from "./auth.js";

test("an expired admin lock starts a fresh failure window without immediately relocking", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(
    nextAdminLoginFailureState({
      failedAttempts: 5,
      lockedUntil: new Date("2026-08-24T11:59:59.999Z"),
      now,
    }),
    { failedAttempts: 1, lockedUntil: null },
  );
  assert.deepEqual(
    nextAdminLoginFailureState({
      failedAttempts: 5,
      lockedUntil: now,
      now,
    }),
    { failedAttempts: 1, lockedUntil: null },
  );
});

test("a fresh admin failure window locks only on its fifth failure", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(
    nextAdminLoginFailureState({ failedAttempts: 3, lockedUntil: null, now }),
    { failedAttempts: 4, lockedUntil: null },
  );
  assert.deepEqual(
    nextAdminLoginFailureState({ failedAttempts: 4, lockedUntil: null, now }),
    {
      failedAttempts: 5,
      lockedUntil: new Date("2026-08-24T12:15:00.000Z"),
    },
  );
});

test("admin keepalive rotates the session and never renews past the absolute cap", async () => {
  type KeepaliveResult = { token: string; expiresAt: string; sessionId: string; rotatedFromSessionId: string };
  let handler: ((request: FastifyRequest, reply: FastifyReply) => Promise<KeepaliveResult>) | undefined;
  const app = {
    post(path: string, ...args: unknown[]) {
      if (path === "/v1/admin/auth/keepalive") handler = args.at(-1) as typeof handler;
    },
    get() {},
  } as unknown as FastifyInstance;
  const expiry = new Date("2026-09-27T12:00:00.000Z");
  let state: "active" | "past-cap" | "missing" = "active";
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("FOR UPDATE")) {
        if (state === "missing") return { rows: [], rowCount: 0 };
        return { rows: [{ within_cap: state === "active" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO sessions")) {
        return { rows: [{ id: "rotated-session-id", expires_at: expiry }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const context = {
    config: { sessionTtlDays: 30, sessionTokenPepper: "pepper", adminSessionMaxHours: 8, adminSessionIdleMinutes: 30 },
    auth: { requireAdmin() {} },
    pool: { async connect() { return client; } },
  } as unknown as ApiContext;
  await registerAuthRoutes(app, context);
  assert.ok(handler);
  const request = { actor: { sessionId: "session-id", userId: "admin-id" } } as unknown as FastifyRequest;
  const reply = {
    header() { return reply; },
    send(body: unknown) { return body; },
  } as unknown as FastifyReply;

  const result = await handler(request, reply);
  assert.equal(result.expiresAt, expiry.toISOString());
  assert.equal(result.sessionId, "rotated-session-id");
  assert.equal(result.rotatedFromSessionId, "session-id");
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  const lock = statements.find((entry) => entry.sql.includes("FOR UPDATE"))!;
  assert.deepEqual(lock.values, ["session-id", "admin-id", 8]);
  assert.match(lock.sql, /session_kind='ADMIN'/);
  assert.match(lock.sql, /revoked_at IS NULL AND expires_at>now\(\)/);
  assert.ok(statements.some((entry) => /revoke_reason='ROTATED'/.test(entry.sql)));
  const insert = statements.find((entry) => entry.sql.includes("INSERT INTO sessions"))!;
  assert.match(insert.sql, /LEAST\(created_at \+ \(\$3::integer \* interval '1 hour'\),\s+now\(\) \+ \(\$4::integer \* interval '1 minute'\)\)/);
  assert.match(insert.sql, /created_at,now\(\)/);
  assert.deepEqual([insert.values[0], insert.values[2], insert.values[3]], ["session-id", 8, 30]);
  assert.notEqual(insert.values[1], result.token, "only the token digest is stored");
  assert.ok(statements.some((entry) => entry.sql === "COMMIT"));

  statements.length = 0;
  state = "past-cap";
  await assert.rejects(() => handler!(request, reply), (error: unknown) => error instanceof AppError && error.statusCode === 401);
  assert.ok(statements.some((entry) => /revoke_reason='ADMIN_SESSION_MAX_AGE'/.test(entry.sql)));
  assert.equal(statements.some((entry) => entry.sql.includes("INSERT INTO sessions")), false);
  assert.ok(statements.some((entry) => entry.sql === "COMMIT"), "the cap revocation is committed before the 401");

  state = "missing";
  await assert.rejects(() => handler!(request, reply), (error: unknown) => error instanceof AppError && error.statusCode === 401);
});
