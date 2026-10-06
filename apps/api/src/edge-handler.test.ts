import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { signAdminServiceRequest } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import { buildAppCore } from "./app-core.js";
import {
  assertSupabaseEdgeApiConfig,
  createEdgeMediaRuntime,
  createSupabaseEdgeApiHandler,
  EDGE_REQUEST_BODY_TIMEOUT_MS,
  normalizeSupabaseEdgeApiEnvironment,
  normalizeSupabaseEdgeAdminEnvironment,
  type EdgeApiEnvironment,
} from "./edge-handler.js";
import { createEdgeApiLogger } from "./lib/edge-logger.js";
import { edgeMediaRuntime } from "./lib/media-runtime-edge.js";

const projectRef = "abcdefghijklmnopqrst";
const runtimeDatabaseUrl = `postgresql://dabboba_runtime.${projectRef}:fixture@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;

function edgeEnvironment(overrides: EdgeApiEnvironment = {}): EdgeApiEnvironment {
  return {
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    DABBOBA_API_DATABASE_URL: runtimeDatabaseUrl,
    DABBOBA_API_SESSION_TOKEN_PEPPER: "fixture-edge-session-pepper-1234567890",
    DABBOBA_API_WEB_ORIGINS: "https://app.example.test",
    DABBOBA_API_PAYMENT_PROVIDER: "UNCONFIGURED",
    DABBOBA_API_LOG_LEVEL: "silent",
    DABBOBA_STORAGE_BUCKET: "dabboba-media",
    DABBOBA_STORAGE_SERVICE_KEY: "fixture-server-storage-key",
    DABBOBA_STORAGE_S3_ENDPOINT: `https://${projectRef}.storage.supabase.co/storage/v1/s3`,
    DABBOBA_STORAGE_S3_REGION: "ap-northeast-2",
    DABBOBA_STORAGE_S3_ACCESS_KEY_ID: "fixture-access-key",
    DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: "fixture-storage-secret",
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "managed-fixture-service-role-key",
    ...overrides,
  };
}

test("Edge preserves explicit payment-test release tier without inventing or mixing environments", () => {
  assert.equal(normalizeSupabaseEdgeApiEnvironment(edgeEnvironment()).DABBOBA_RELEASE_ENVIRONMENT_TIER, undefined);
  assert.equal(normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    DABBOBA_RELEASE_ENVIRONMENT_TIER: "STAGING",
  })).DABBOBA_RELEASE_ENVIRONMENT_TIER, "STAGING");
  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    DABBOBA_RELEASE_ENVIRONMENT_TIER: "PRODUCTION",
  })), /release tier must match/);
});

test("admin Edge function rejects direct requests, customer paths, and mutated signed content before app creation", async () => {
  const captured: InjectOptions[] = [];
  let builds = 0;
  const serviceSecret = "fixture-admin-service-secret-1234567890";
  const environment = edgeEnvironment({
    DABBOBA_ADMIN_ORIGINS: "https://admin.example.test",
    DABBOBA_ADMIN_PROXY_IDENTITY_SECRET: "fixture-admin-proxy-secret-1234567890",
    DABBOBA_ADMIN_EDGE_CLIENT_IP_HEADER: "cf-connecting-ip",
    DABBOBA_ADMIN_SERVICE_SECRET: serviceSecret,
  });
  const handler = createSupabaseEdgeApiHandler({
    surface: "admin",
    readEnvironment: () => environment,
    buildApp: async (config) => {
      builds += 1;
      assert.equal(config.surface, "admin");
      return fakeApp(captured);
    },
  });
  const base = "https://example.test/functions/v1/dabboba-admin-api";
  assert.equal((await handler(new Request(`${base}/v1/admin/dashboard`))).status, 403);
  assert.equal((await handler(new Request(`${base}/v1/catalog/products`))).status, 404);
  assert.equal((await handler(new Request("https://example.test/functions/v1/dabboba-api/v1/admin/dashboard"))).status, 404);
  assert.equal(builds, 0);

  const path = "/functions/v1/dabboba-admin-api/v1/admin/products?limit=30";
  const canonicalPath = "/v1/admin/products?limit=30";
  const requestId = "ef0a189b-0435-497f-b36a-e8e2f8f390e4";
  const body = JSON.stringify({ name: "예시" });
  const signature = signAdminServiceRequest({
    secret: serviceSecret, method: "POST", path: canonicalPath, requestId,
    authorization: "Bearer opaque-admin", reason: encodeURIComponent("상품 등록"), reasonEncoding: "utf-8-percent",
    contentType: "application/json", body,
  });
  const headers = {
    ...signature,
    "x-request-id": requestId,
    authorization: "Bearer opaque-admin",
    "x-admin-reason": encodeURIComponent("상품 등록"),
    "x-admin-reason-encoding": "utf-8-percent",
    "content-type": "application/json",
  };
  assert.equal((await handler(new Request(`https://example.test${path}`, { method: "POST", headers, body: `${body} ` }))).status, 403);
  assert.equal(builds, 0);
  assert.equal((await handler(new Request(`https://example.test${path}`, { method: "POST", headers, body }))).status, 207);
  assert.equal((await handler(new Request(`https://example.test/dabboba-admin-api${canonicalPath}`, { method: "POST", headers, body }))).status, 207);
  assert.equal(builds, 1);
  assert.equal(captured[0]?.url, "/v1/admin/products?limit=30");
  assert.equal(captured[0]?.headers["x-dabboba-admin-service-signature"], undefined);
  assert.equal(captured[0]?.headers.authorization, "Bearer opaque-admin");
  assert.equal(normalizeSupabaseEdgeAdminEnvironment(environment).API_SURFACE, "admin");
});

type InjectOptions = {
  method: string;
  url: string;
  headers: Record<string, string>;
  payload?: Buffer;
  remoteAddress?: string;
};

function fakeApp(captured: InjectOptions[]) {
  return {
    async inject(options: InjectOptions) {
      captured.push(options);
      const statusCode = options.url === "/no-content" ? 204
        : options.url === "/not-modified" ? 304
        : 207;
      return {
        statusCode,
        headers: {
          "content-type": "application/octet-stream",
          "set-cookie": ["a=1; HttpOnly", "b=2; Secure"],
          connection: "close",
        },
        rawPayload: Buffer.from([0, 255, 1]),
      };
    },
  };
}

test("Edge API rejects wrong, colliding, and encoded-slash function paths before config or app creation", async () => {
  let reads = 0;
  let builds = 0;
  let cancelled = 0;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => { reads += 1; return edgeEnvironment(); },
    buildApp: async () => { builds += 1; return fakeApp([]); },
  });
  const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled += 1; } });
  const request = new Request("https://example.test/dabboba-api-collision/v1/catalog", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal((await handler(request)).status, 404);
  assert.equal((await handler(new Request("https://example.test/dabboba-api/v1%2Fadmin/dashboard"))).status, 404);
  assert.equal((await handler(new Request("https://example.test/v1/catalog/products"))).status, 404);
  assert.equal(cancelled, 1);
  assert.equal(reads, 0);
  assert.equal(builds, 0);
});

test("Edge API preserves customer request bytes and query while removing spoofed and nominated hop headers", async () => {
  const captured: InjectOptions[] = [];
  let builds = 0;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    buildApp: async (config) => {
      builds += 1;
      assert.equal(config.surface, "customer");
      assert.equal(config.redisUrl, null);
      return fakeApp(captured);
    },
  });
  const payload = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]);
  const response = await handler(new Request("https://example.test/functions/v1/dabboba-api/v1/payments/webhooks/KG?x=%2F", {
    method: "POST",
    headers: {
      authorization: "Bearer opaque-session",
      cookie: "session=opaque",
      connection: "x-remove",
      "x-remove": "secret-hop-value",
      "x-forwarded-for": "203.0.113.9",
      "content-type": "application/octet-stream",
    },
    body: payload,
  }));
  assert.equal(response.status, 207);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 255, 1]));
  assert.equal(builds, 1);
  assert.equal(captured[0]?.url, "/v1/payments/webhooks/KG?x=%2F");
  assert.deepEqual(captured[0]?.payload, payload);
  assert.equal(captured[0]?.headers.authorization, "Bearer opaque-session");
  assert.equal(captured[0]?.headers.cookie, "session=opaque");
  assert.equal(captured[0]?.headers["x-forwarded-for"], undefined);
  assert.equal(captured[0]?.headers["x-remove"], undefined);
  assert.equal(response.headers.get("connection"), null);
  assert.match(response.headers.get("set-cookie") ?? "", /a=1/);
  assert.match(response.headers.get("set-cookie") ?? "", /b=2/);
});

test("Edge API passes only the operator-verified client-IP header and maps it into the API config", async () => {
  const captured: InjectOptions[] = [];
  let trustedHeader: string | null | undefined;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment({ DABBOBA_TRUSTED_CLIENT_IP_HEADER: "CF-Connecting-IP" }),
    buildApp: async (config) => {
      trustedHeader = config.trustedClientIpHeader;
      return fakeApp(captured);
    },
  });
  const response = await handler(new Request("https://example.test/functions/v1/dabboba-api/v1/catalog/products", {
    headers: {
      "cf-connecting-ip": "198.51.100.30",
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.10",
      forwarded: "for=203.0.113.11",
    },
  }), { remoteAddr: { hostname: "10.0.0.1" } });
  assert.equal(response.status, 207);
  assert.equal(trustedHeader, "cf-connecting-ip");
  assert.equal(captured[0]?.headers["cf-connecting-ip"], "198.51.100.30");
  assert.equal(captured[0]?.headers["x-forwarded-for"], undefined);
  assert.equal(captured[0]?.headers["x-real-ip"], undefined);
  assert.equal(captured[0]?.headers.forwarded, undefined);
  assert.equal(captured[0]?.remoteAddress, "10.0.0.1");

  const unconfigured: InjectOptions[] = [];
  const defaultHandler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    buildApp: async (config) => {
      assert.equal(config.trustedClientIpHeader, null);
      return fakeApp(unconfigured);
    },
  });
  await defaultHandler(new Request("https://example.test/functions/v1/dabboba-api/v1/catalog/products", {
    headers: { "cf-connecting-ip": "198.51.100.30" },
  }));
  assert.equal(unconfigured[0]?.headers["cf-connecting-ip"], undefined);
  assert.throws(
    () => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({ TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip" })),
    /forbidden legacy setting/,
  );
});

test("Edge API injects the hosted WASM sanitizer into the shared media runtime", async () => {
  const sanitizeImage = async () => ({
    data: Buffer.from("webp"),
    mimeType: "image/webp" as const,
    checksumSha256: "0".repeat(64),
    byteSize: 4,
    width: 1,
    height: 1,
  });
  let received: unknown;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    sanitizeImage,
    buildApp: async (_config, sanitizer) => {
      received = sanitizer;
      return fakeApp([]);
    },
  });
  assert.equal((await handler(new Request("https://example.test/dabboba-api/healthz"))).status, 207);
  assert.equal(received, sanitizeImage);
});

test("admin Edge function injects the same WASM sanitizer so catalog-media completion is available", async () => {
  const sanitizeImage = async () => ({
    data: Buffer.from("webp"),
    mimeType: "image/webp" as const,
    checksumSha256: "0".repeat(64),
    byteSize: 4,
    width: 1,
    height: 1,
  });
  let received: unknown;
  const serviceSecret = "fixture-admin-service-secret-1234567890";
  const handler = createSupabaseEdgeApiHandler({
    surface: "admin",
    readEnvironment: () => edgeEnvironment({
      DABBOBA_ADMIN_ORIGINS: "https://admin.example.test",
      DABBOBA_ADMIN_PROXY_IDENTITY_SECRET: "fixture-admin-proxy-secret-1234567890",
      DABBOBA_ADMIN_EDGE_CLIENT_IP_HEADER: "cf-connecting-ip",
      DABBOBA_ADMIN_SERVICE_SECRET: serviceSecret,
    }),
    sanitizeImage,
    buildApp: async (config, sanitizer) => {
      assert.equal(config.surface, "admin");
      received = sanitizer;
      return fakeApp([]);
    },
  });
  const canonicalPath = "/v1/admin/catalog-media/uploads";
  const requestId = "0b8f4f7e-6a47-4c4c-9a55-2f0d3c1f7a11";
  const body = JSON.stringify({ mimeType: "image/png" });
  const signature = signAdminServiceRequest({
    secret: serviceSecret, method: "POST", path: canonicalPath, requestId,
    authorization: "Bearer opaque-admin", reason: encodeURIComponent("상품 이미지"), reasonEncoding: "utf-8-percent",
    contentType: "application/json", body,
  });
  const response = await handler(new Request(`https://example.test/dabboba-admin-api${canonicalPath}`, {
    method: "POST",
    headers: {
      ...signature,
      "x-request-id": requestId,
      authorization: "Bearer opaque-admin",
      "x-admin-reason": encodeURIComponent("상품 이미지"),
      "x-admin-reason-encoding": "utf-8-percent",
      "content-type": "application/json",
    },
    body,
  }));
  assert.equal(response.status, 207);
  assert.equal(received, sanitizeImage);

  assert.equal(edgeMediaRuntime.completionAvailable, false);
  assert.equal(createEdgeMediaRuntime().completionAvailable, false);
  const adminRuntime = createEdgeMediaRuntime(sanitizer(received));
  assert.equal(adminRuntime.completionAvailable, true);
  assert.equal((await adminRuntime.sanitizeImage(Buffer.from("png"), "image/png")).mimeType, "image/webp");
  const failing = createEdgeMediaRuntime(async () => { throw new Error("decode failed"); });
  await assert.rejects(failing.sanitizeImage(Buffer.from("x"), "image/png"), /안전하게 처리할 수 없습니다/);
});

function sanitizer(value: unknown) {
  return value as Parameters<typeof createEdgeMediaRuntime>[0];
}

test("Edge API reuses the managed Supabase service role key when no duplicate Storage secret is set", () => {
  const normalized = normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    DABBOBA_STORAGE_SERVICE_KEY: undefined,
  }));
  assert.equal(normalized.SUPABASE_STORAGE_SERVICE_KEY, "managed-fixture-service-role-key");
  assert.equal(normalized.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("Edge API bounds declared and streamed bodies and cancels already-aborted input before app creation", async () => {
  let builds = 0;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    buildApp: async () => { builds += 1; return fakeApp([]); },
  });
  const declared = await handler(new Request("https://example.test/dabboba-api/v1/orders", {
    method: "POST",
    headers: { "content-length": "1048577" },
    body: "x",
  }));
  assert.equal(declared.status, 413);

  let streamedCancelled = false;
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(700_000));
      controller.enqueue(new Uint8Array(400_000));
    },
    cancel() { streamedCancelled = true; },
  });
  const streamedResponse = await handler(new Request("https://example.test/dabboba-api/v1/orders", {
    method: "POST",
    body: streamed,
    duplex: "half",
  } as RequestInit & { duplex: "half" }));
  assert.equal(streamedResponse.status, 413);
  assert.equal(streamedCancelled, true);

  let abortedCancelled = false;
  const controller = new AbortController();
  const abortedBody = new ReadableStream<Uint8Array>({ cancel: () => { abortedCancelled = true; } });
  const abortedRequest = new Request("https://example.test/dabboba-api/v1/orders", {
    method: "POST",
    signal: controller.signal,
    body: abortedBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  controller.abort();
  assert.equal((await handler(abortedRequest)).status, 499);
  assert.equal(abortedCancelled, true);
  assert.equal(builds, 0);
});

test("Edge API uses a fixed ten-second production body deadline and restricts shorter overrides to tests", () => {
  assert.equal(EDGE_REQUEST_BODY_TIMEOUT_MS, 10_000);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createSupabaseEdgeApiHandler({
      readEnvironment: () => edgeEnvironment(),
      testOnlyBodyTimeoutMs: 10,
    }), /restricted to bounded unit tests/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("Edge API cancels a valid JSON body whose EOF stalls and returns 408 before app or environment access", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  let cancelled = false;
  let reads = 0;
  let builds = 0;
  try {
    const handler = createSupabaseEdgeApiHandler({
      readEnvironment: () => { reads += 1; return edgeEnvironment(); },
      buildApp: async () => { builds += 1; return fakeApp([]); },
      testOnlyBodyTimeoutMs: 20,
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"valid":true}'));
      },
      cancel() { cancelled = true; },
    });
    const response = await handler(new Request("https://example.test/dabboba-api/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    assert.equal(response.status, 408);
    assert.equal((await response.json() as { error?: { code?: unknown } }).error?.code, "REQUEST_TIMEOUT");
    assert.equal(cancelled, true);
    assert.equal(reads, 0);
    assert.equal(builds, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("Edge API emits bodyless Web responses for HEAD, 204, and 304 and initializes once under concurrency", async () => {
  const captured: InjectOptions[] = [];
  let builds = 0;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    buildApp: async () => { builds += 1; return fakeApp(captured); },
  });
  const [head, noContent, notModified] = await Promise.all([
    handler(new Request("https://example.test/dabboba-api/healthz", { method: "HEAD" })),
    handler(new Request("https://example.test/dabboba-api/no-content", { method: "OPTIONS" })),
    handler(new Request("https://example.test/dabboba-api/not-modified")),
  ]);
  assert.equal(head.status, 207);
  assert.equal(noContent.status, 204);
  assert.equal(notModified.status, 304);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await noContent.arrayBuffer()).byteLength, 0);
  assert.equal((await notModified.arrayBuffer()).byteLength, 0);
  assert.equal(builds, 1);
});

test("Edge API environment rejects legacy secrets, non-customer surfaces, owner roles, and session-pooler URLs", () => {
  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({ DATABASE_URL: runtimeDatabaseUrl })), /forbidden legacy/);
  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({ API_SURFACE: "all" })), /customer surface/);
  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({ DABBOBA_ENVIRONMENT_TIER: "TEST" })), /STAGING or PRODUCTION/);

  const baseConfig = {
    environment: "production",
    environmentTier: "STAGING",
    surface: "customer",
    redisUrl: null,
    databaseUrl: runtimeDatabaseUrl,
    gcsBucket: null,
    gcsProjectId: null,
    mediaStorageProvider: "supabase",
    supabaseStorage: {},
  } as unknown as ApiConfig;
  assert.doesNotThrow(() => assertSupabaseEdgeApiConfig(baseConfig));
  assert.throws(() => assertSupabaseEdgeApiConfig({
    ...baseConfig,
    databaseUrl: runtimeDatabaseUrl.replace(":6543/", ":5432/"),
  }), /transaction pooler/);
  assert.throws(() => assertSupabaseEdgeApiConfig({
    ...baseConfig,
    databaseUrl: runtimeDatabaseUrl.replace(`dabboba_runtime.${projectRef}`, `postgres.${projectRef}`),
  }), /restricted dabboba_runtime/);
});

test("Edge API maps only the dedicated customer Auth key and supports the built-in anon-key fallback", () => {
  const dedicated = normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    DABBOBA_API_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_edge_customer_fixture",
    DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: "KAKAO,EMAIL",
    DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64url"),
    DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
    SUPABASE_ANON_KEY: "legacy-anon-key-that-must-not-win",
  }));
  assert.equal(dedicated.SUPABASE_PUBLISHABLE_KEY, "sb_publishable_edge_customer_fixture");
  assert.equal(dedicated.CUSTOMER_AUTH_ENABLED_PROVIDERS, "KAKAO,EMAIL");
  assert.equal(dedicated.APPLE_TOKEN_ENCRYPTION_KEY_VERSION, "1");
  assert.equal(dedicated.SUPABASE_ANON_KEY, undefined);

  const fallback = normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    SUPABASE_ANON_KEY: "legacy-anon-public-key-fixture",
  }));
  assert.equal(fallback.SUPABASE_PUBLISHABLE_KEY, "legacy-anon-public-key-fixture");
  assert.equal(fallback.SUPABASE_ANON_KEY, undefined);

  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    SUPABASE_PUBLISHABLE_KEY: "raw-publishable-key-must-not-bypass-edge-namespacing",
  })), /forbidden legacy/);
  assert.throws(() => normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    CUSTOMER_AUTH_ENABLED_PROVIDERS: "KAKAO",
  })), /forbidden legacy/);
});

test("Edge API maps PortOne credentials and the distinct worker requery secret only from dedicated names", () => {
  const normalized = normalizeSupabaseEdgeApiEnvironment(edgeEnvironment({
    DABBOBA_API_PAYMENT_RECONCILIATION_WORKER_SECRET: "worker-requery-secret-for-tests",
    DABBOBA_API_PORTONE_API_SECRET: "provider-api-secret-for-tests",
    DABBOBA_API_PORTONE_MERCHANT_ID: "merchant-fixture",
    DABBOBA_API_PORTONE_STORE_ID: "store-fixture",
    DABBOBA_API_PORTONE_CHANNEL_KEY: "channel-fixture",
    DABBOBA_API_PORTONE_KCP_CHANNEL_KEY: "channel-key-kcp-fixture",
    DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT: "TEST",
    DABBOBA_API_PORTONE_WEBHOOK_SECRET: "provider-webhook-secret-for-tests",
  }));
  assert.equal(normalized.PAYMENT_RECONCILIATION_WORKER_SECRET, "worker-requery-secret-for-tests");
  assert.equal(normalized.PORTONE_API_SECRET, "provider-api-secret-for-tests");
  assert.equal(normalized.PORTONE_CHANNEL_ENVIRONMENT, "TEST");
  assert.equal(normalized.PORTONE_KCP_CHANNEL_KEY, "channel-key-kcp-fixture");
  assert.equal(normalized.DABBOBA_API_PORTONE_KCP_CHANNEL_KEY, undefined);
  assert.equal(normalized.DABBOBA_API_PORTONE_API_SECRET, undefined);
});

test("Edge API uses the real customer Fastify surface without bypassing auth and preserves raw JSON bytes", async (t) => {
  const unusedPool = {
    query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
  } as unknown as DatabasePool;
  let appToClose: Awaited<ReturnType<typeof buildAppCore>>["app"] | null = null;
  t.after(async () => appToClose?.close());
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => edgeEnvironment(),
    buildApp: async (config) => {
      const built = await buildAppCore({
        config,
        mediaRuntime: edgeMediaRuntime,
        pool: unusedPool,
        readinessPool: unusedPool,
        redis: null,
        loggerInstance: createEdgeApiLogger("silent"),
        edgeSafeLogging: true,
      });
      built.app.post("/v1/test-only/raw-body", async (request) => ({
        rawBody: request.rawBody?.toString("base64") ?? null,
      }));
      appToClose = built.app;
      return built.app as unknown as ReturnType<typeof fakeApp>;
    },
  });

  assert.equal((await handler(new Request("https://example.test/dabboba-api/healthz"))).status, 200);
  assert.equal((await handler(new Request("https://example.test/dabboba-api/v1/admin/dashboard"))).status, 404);
  assert.equal((await handler(new Request("https://example.test/dabboba-api/v1/account/profile"))).status, 401);

  const raw = Buffer.from('{ "value" : 1 }\n');
  const rawResponse = await handler(new Request("https://example.test/dabboba-api/v1/test-only/raw-body", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  }));
  assert.equal(rawResponse.status, 200);
  assert.equal((await rawResponse.json() as { rawBody: string }).rawBody, raw.toString("base64"));
});
