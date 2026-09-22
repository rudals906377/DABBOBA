import assert from "node:assert/strict";
import test from "node:test";
import { createDabbobaClient, errorMessage } from "./index.js";

test("API error helper exposes safe contract messages only", () => {
  assert.equal(errorMessage({ error: { message: "로그인이 필요합니다." } }), "로그인이 필요합니다.");
  assert.equal(errorMessage(new Error("secret")), "요청을 처리하지 못했습니다.");
});

test("API client reports unauthorized responses after attaching the bearer token", async () => {
  const seen: Array<{ authorization: string | null; status: number }> = [];
  const client = createDabbobaClient({
    baseUrl: "https://api.dabboba.test",
    token: () => "expired-session",
    requestId: () => "request-id",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return new Response(JSON.stringify({ error: { message: "로그인이 필요합니다." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
    onUnauthorized: ({ request, response }) => {
      seen.push({
        authorization: request.headers.get("authorization"),
        status: response.status,
      });
    },
  });

  const result = await client.GET("/v1/auth/me");

  assert.equal(result.response.status, 401);
  assert.deepEqual(seen, [{ authorization: "Bearer expired-session", status: 401 }]);
});

test("API client does not report successful responses as unauthorized", async () => {
  let unauthorizedCalls = 0;
  const client = createDabbobaClient({
    baseUrl: "https://api.dabboba.test",
    requestId: () => "request-id",
    fetch: async () => new Response(JSON.stringify({ actor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    onUnauthorized: () => {
      unauthorizedCalls += 1;
    },
  });

  await client.GET("/v1/auth/me");

  assert.equal(unauthorizedCalls, 0);
});

test("API client creates a correlation id without an explicit generator", async () => {
  let requestId = "";
  const client = createDabbobaClient({
    baseUrl: "https://api.dabboba.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestId = request.headers.get("x-request-id") || "";
      return new Response(JSON.stringify({ actor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.GET("/v1/auth/me");

  assert.match(requestId, /^(?:[0-9a-f-]{36}|client-[a-z0-9]+-[a-z0-9]+)$/);
});
