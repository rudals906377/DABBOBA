import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  computeSessionRefreshDelay,
  computeSessionRefreshRetryDelay,
  DabbobaApiClient,
} from "../src/services/dabbobaApi.ts";

test("development sign-in, session rotation, logout, and deletion use the user-session contracts", async () => {
  const calls = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "http://127.0.0.1:8791",
      token: null,
    },
    createId: () => "customer-session-request-id",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/auth/dev-session")) {
        return Response.json({
          token: "first-user-token",
          expiresAt: "2026-09-24T00:00:00.000Z",
          actor: {
            userId: "11111111-1111-4111-8111-111111111111",
            email: "preview@example.com",
            nickname: "preview",
            role: "USER",
            status: "ACTIVE",
            sessionId: "22222222-2222-4222-8222-222222222222",
          },
        }, { status: 201 });
      }
      if (url.endsWith("/v1/auth/refresh")) {
        return Response.json({
          token: "rotated-user-token",
          expiresAt: "2026-09-25T00:00:00.000Z",
          rotatedFromSessionId: "22222222-2222-4222-8222-222222222222",
          actor: {
            userId: "11111111-1111-4111-8111-111111111111",
            email: "preview@example.com",
            nickname: "preview",
            role: "USER",
            status: "ACTIVE",
          },
          session: {
            id: "33333333-3333-4333-8333-333333333333",
            kind: "USER",
            createdAt: "2026-08-24T00:00:00.000Z",
            lastSeenAt: "2026-08-24T00:00:00.000Z",
            expiresAt: "2026-09-25T00:00:00.000Z",
          },
        }, { status: 201 });
      }
      if (url.endsWith("/v1/account/deletion-request")) {
        return Response.json({
          id: "44444444-4444-4444-8444-444444444444",
          status: "BLOCKED",
          blockers: { pointBalance: 10 },
          requestCount: 1,
          hardDeletePerformed: false,
          policy: "MANUAL_REVIEW_REQUIRED",
          requestedAt: "2026-08-24T00:00:00.000Z",
          lastRequestedAt: "2026-08-24T00:00:00.000Z",
        }, { status: 201 });
      }
      if (url.endsWith("/v1/auth/logout")) return new Response(null, { status: 204 });
      return new Response("not found", { status: 404 });
    },
  });

  const issued = await client.createDevelopmentSession("preview@example.com");
  assert.equal(calls[0].init.headers.has("authorization"), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: "preview@example.com" });

  client.setToken(issued.token);
  const rotated = await client.refreshUserSession();
  assert.equal(calls[1].init.headers.get("authorization"), "Bearer first-user-token");
  client.setToken(rotated.token);

  const deletion = await client.requestAccountDeletion("delete-account-once");
  assert.equal(deletion.hardDeletePerformed, false);
  assert.equal(calls[2].init.headers.get("authorization"), "Bearer rotated-user-token");
  assert.equal(calls[2].init.headers.get("idempotency-key"), "delete-account-once");

  await client.logoutUserSession();
  assert.equal(calls[3].init.headers.get("authorization"), "Bearer rotated-user-token");
  client.setToken(null);
  await assert.rejects(
    () => client.logoutUserSession(),
    (error) => error.code === "AUTH_TOKEN_REQUIRED" && error.status === 401,
  );
  assert.equal(calls.length, 4);
});

test("customer UI does not ship a public user token and wires remote logout and deletion", () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  assert.doesNotMatch(envExample, /^VITE_DABBOBA_USER_TOKEN=/m);
  assert.match(prototypeSource, /createDevelopmentSession/);
  assert.match(prototypeSource, /getCurrentUserSession\(controller\.signal\)/);
  assert.match(prototypeSource, /refreshUserSession\(\)/);
  assert.match(prototypeSource, /const advanceAuthGeneration = useCallback/);
  assert.match(prototypeSource, /authGenerationRef\.current \+= 1/);
  assert.match(prototypeSource, /if \(!sessionValidationComplete\) return/);
  assert.match(prototypeSource, /logoutUserSession/);
  assert.match(prototypeSource, /requestAccountDeletion/);
});

test("session refresh is single-flight and invalidates the matching token on 401", async () => {
  let refreshCalls = 0;
  let resolveRefresh;
  let responseMode = "success";
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "http://127.0.0.1:8791",
      token: "session-token",
    },
    fetch: async (url) => {
      assert.match(String(url), /\/v1\/auth\/refresh$/);
      refreshCalls += 1;
      if (responseMode === "unauthorized") {
        return Response.json({ error: { code: "SESSION_EXPIRED", message: "expired" } }, { status: 401 });
      }
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
  });

  const first = client.refreshUserSession();
  const second = client.refreshUserSession();
  assert.strictEqual(first, second);
  assert.equal(refreshCalls, 1);
  resolveRefresh(Response.json({
    token: "rotated-token",
    expiresAt: "2026-09-25T00:00:00.000Z",
    actor: {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "preview@example.com",
      nickname: "preview",
      role: "USER",
      status: "ACTIVE",
    },
    session: {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "USER",
      createdAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-09-25T00:00:00.000Z",
    },
  }, { status: 201 }));
  assert.equal((await first).token, "rotated-token");

  client.setToken("expired-token");
  responseMode = "unauthorized";
  await assert.rejects(
    () => client.refreshUserSession(),
    (error) => error.status === 401 && error.code === "SESSION_EXPIRED",
  );
  assert.equal(client.authenticated, false);
  await assert.rejects(
    () => client.getCurrentUserSession(),
    (error) => error.status === 401 && error.code === "AUTH_TOKEN_REQUIRED",
  );
  assert.equal(refreshCalls, 2);
});

test("generic authenticated 401 invalidation clears only the token that made the request", async () => {
  let callCount = 0;
  let resolveOldRequest;
  const invalidations = [];
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "http://127.0.0.1:8791",
      token: "old-session-token",
    },
    fetch: async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveOldRequest = resolve;
        });
      }
      return Response.json({ error: { code: "SESSION_EXPIRED", message: "expired" } }, { status: 401 });
    },
  });
  const unsubscribe = client.onAuthInvalidated((error) => invalidations.push(error.code));

  const oldRequest = client.getCurrentUserSession();
  client.setToken("new-session-token");
  resolveOldRequest(Response.json({ error: { code: "OLD_SESSION_EXPIRED", message: "old" } }, { status: 401 }));
  await assert.rejects(oldRequest, (error) => error.code === "OLD_SESSION_EXPIRED");
  assert.equal(client.configuration.token, "new-session-token");
  assert.deepEqual(invalidations, []);

  await assert.rejects(
    () => client.getCurrentUserSession(),
    (error) => error.code === "SESSION_EXPIRED" && error.status === 401,
  );
  assert.equal(client.configuration.token, null);
  assert.deepEqual(invalidations, ["SESSION_EXPIRED"]);
  unsubscribe();
});

test("snapshot cancellation rejects with AbortError instead of returning partial data", async () => {
  const controller = new AbortController();
  const client = new DabbobaApiClient({
    configuration: {
      mode: "remote",
      baseUrl: "http://127.0.0.1:8791",
      token: null,
    },
    fetch: async (_url, init) => new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        resolve(Response.json({ items: [], nextCursor: null }));
        return;
      }
      const rejectAbort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      if (signal.aborted) rejectAbort();
      else signal.addEventListener("abort", rejectAbort, { once: true });
    }),
  });

  const snapshot = client.loadSnapshot(controller.signal);
  controller.abort();
  await assert.rejects(snapshot, (error) => error instanceof Error && error.name === "AbortError");
});

test("session refresh delay is clamped before expiry", () => {
  const now = Date.parse("2026-08-25T00:00:00.000Z");
  assert.equal(computeSessionRefreshDelay("invalid", now), null);
  assert.equal(computeSessionRefreshDelay("2026-08-25T00:02:00.000Z", now), 0);
  assert.equal(computeSessionRefreshDelay("2026-08-25T00:10:00.000Z", now), 5 * 60_000);
  const longDelay = computeSessionRefreshDelay("2026-10-25T00:00:00.000Z", now);
  assert.equal(longDelay, 2_147_000_000);
  assert.ok(longDelay < Date.parse("2026-10-25T00:00:00.000Z") - now);
});

test("transient session refresh retries stay bounded and never cross expiry", () => {
  const now = Date.parse("2026-08-25T00:00:00.000Z");
  assert.equal(computeSessionRefreshRetryDelay("invalid", now), null);
  assert.equal(computeSessionRefreshRetryDelay("2026-08-24T23:59:59.000Z", now), null);
  assert.equal(computeSessionRefreshRetryDelay("2026-08-25T00:00:00.500Z", now), 500);
  assert.equal(computeSessionRefreshRetryDelay("2026-08-25T00:00:10.000Z", now), 9_000);
  assert.equal(computeSessionRefreshRetryDelay("2026-08-25T00:05:00.000Z", now), 30_000);
});

test("customer session UI guards stale auth work and clears local state in logout finally", () => {
  const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("../src/services/dabbobaApi.ts", import.meta.url), "utf8");

  assert.match(prototypeSource, /const sessionToken = apiRuntime\.client\.configuration\.token/);
  assert.match(prototypeSource, /authGenerationRef\.current === sessionGeneration/);
  assert.match(prototypeSource, /const snapshotToken = apiRuntime\.client\.configuration\.token/);
  assert.match(prototypeSource, /authGenerationRef\.current === snapshotGeneration/);
  assert.match(prototypeSource, /finally \{\s*clearUserSession\(\);\s*\}/);
  assert.match(prototypeSource, /setMemberSettings\(EMPTY_REMOTE_MEMBER_SETTINGS\)/);
  assert.match(prototypeSource, /exchangeApplicationDecisions: \{\}/);
  assert.match(prototypeSource, /apiRuntime\.client\.onAuthInvalidated/);
  assert.match(serviceSource, /private sessionRefreshTask: SessionRefreshTask \| null = null/);
  assert.match(serviceSource, /this\.configuration\.token === requestToken/);
  assert.match(serviceSource, /if \(signal\?\.aborted\) throw createAbortError\(\)/);
  assert.match(prototypeSource, /computeSessionRefreshRetryDelay\(sessionState\.session\.expiresAt\)/);
  assert.match(prototypeSource, /사용자 세션 갱신에 일시적으로 실패해 만료 전에 다시 시도합니다/);
  assert.doesNotMatch(prototypeSource, /\|\|\s*apiRuntime\.client\.configuration\.token === sessionToken/);
});
