import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, FastifyRequest } from "fastify";
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

test("admin keepalive extends only the authenticated, unrevoked session", async () => {
  let handler: ((request: FastifyRequest) => Promise<{ expiresAt: string }>) | undefined;
  const app = {
    post(path: string, ...args: unknown[]) {
      if (path === "/v1/admin/auth/keepalive") handler = args.at(-1) as typeof handler;
    },
    get() {},
  } as unknown as FastifyInstance;
  const expiry = new Date("2026-09-27T12:00:00.000Z");
  let found = true;
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const context = {
    config: { sessionTtlDays: 30 },
    auth: { requireAdmin() {} },
    pool: {
      async query(sql: string, values: unknown[]) {
        statements.push({ sql, values });
        return { rows: found ? [{ expires_at: expiry }] : [], rowCount: found ? 1 : 0 };
      },
    },
  } as unknown as ApiContext;
  await registerAuthRoutes(app, context);
  assert.ok(handler);
  const request = { actor: { sessionId: "session-id", userId: "admin-id" } } as unknown as FastifyRequest;
  assert.deepEqual(await handler(request), { expiresAt: expiry.toISOString() });
  assert.deepEqual(statements[0]!.values, ["session-id", "admin-id", 30]);
  assert.match(statements[0]!.sql, /session_kind = 'ADMIN'/);
  assert.match(statements[0]!.sql, /revoked_at IS NULL AND expires_at > now\(\)/);

  found = false;
  await assert.rejects(() => handler!(request), (error: unknown) => error instanceof AppError && error.statusCode === 401);
});
