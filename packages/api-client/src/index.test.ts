import assert from "node:assert/strict";
import test from "node:test";
import {
  createDabbobaClient,
  DEFAULT_REQUEST_TIMEOUT_MS,
  errorMessage,
  idempotencyHeaders,
  idempotencyKeyFrom,
  requestTimeoutSignal,
} from "./index.js";

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

function okFetch(seen: Request[]): typeof fetch {
  return async (input, init) => {
    seen.push(input instanceof Request ? input : new Request(input, init));
    return new Response(JSON.stringify({ actor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

test("API client applies a default timeout signal when the caller passes none", async () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 15_000);
  const seen: Request[] = [];
  const client = createDabbobaClient({ baseUrl: "https://api.dabboba.test", fetch: okFetch(seen) });

  await client.GET("/v1/auth/me");

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.signal.aborted, false);
});

test("API client default timeout aborts a request that never answers", async () => {
  let observed: unknown = null;
  const client = createDabbobaClient({
    baseUrl: "https://api.dabboba.test",
    timeoutMs: 20,
    fetch: (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          observed = request.signal.reason;
          reject(request.signal.reason);
        });
      });
    },
  });

  await assert.rejects(client.GET("/v1/auth/me"), (error: unknown) => (error as Error).name === "TimeoutError");
  assert.equal((observed as Error).name, "TimeoutError");
});

test("API client keeps a caller-provided signal instead of the default timeout", async () => {
  const controller = new AbortController();
  let aborted = false;
  const client = createDabbobaClient({
    baseUrl: "https://api.dabboba.test",
    timeoutMs: 10,
    fetch: (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return new Promise<Response>((resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
          reject(request.signal.reason);
        });
        // Outlive the 10 ms default: only the caller's signal may cancel this.
        setTimeout(() => resolve(new Response(JSON.stringify({ actor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })), 60);
      });
    },
  });

  const result = await client.GET("/v1/auth/me", { signal: controller.signal });

  assert.equal(result.response.status, 200);
  assert.equal(aborted, false);
});

test("API client timeout can be disabled per client", async () => {
  const seen: Request[] = [];
  const client = createDabbobaClient({ baseUrl: "https://api.dabboba.test", timeoutMs: 0, fetch: okFetch(seen) });
  await client.GET("/v1/auth/me");
  assert.equal(seen.length, 1);
});

test("requestTimeoutSignal falls back to an AbortController timer", async () => {
  const original = AbortSignal.timeout;
  try {
    (AbortSignal as { timeout?: unknown }).timeout = undefined;
    const signal = requestTimeoutSignal(5);
    assert.equal(signal.aborted, false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as Error).name, "TimeoutError");
  } finally {
    AbortSignal.timeout = original;
  }
});

test("idempotency key helpers produce stable API-compatible keys", async () => {
  const key = idempotencyKeyFrom("kuji-room-join", "user 1/é", "product-9");
  assert.equal(key, "kuji-room-join:user_1__:product-9");
  assert.equal(idempotencyKeyFrom("kuji-room-join", "user 1/é", "product-9"), key);
  assert.match(key, /^[A-Za-z0-9._:-]{16,200}$/);
  assert.equal(idempotencyKeyFrom("a").length, 16);
  assert.equal(idempotencyKeyFrom("x".repeat(500)).length, 200);

  const random = idempotencyHeaders();
  assert.match(random["Idempotency-Key"], /^[A-Za-z0-9._:-]{16,200}$/);

  const seen: Request[] = [];
  const client = createDabbobaClient({ baseUrl: "https://api.dabboba.test", fetch: okFetch(seen) });
  await client.GET("/v1/auth/me", { params: { header: idempotencyHeaders("order-retry-0001") } as never });
  assert.equal(seen[0]!.headers.get("idempotency-key"), "order-retry-0001");
});
