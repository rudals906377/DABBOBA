import { createLocalEdgeApiIntegrationHarness } from "./api.smoke.generated.js";

const HMAC_KEY = "edge-smoke-hmac-key-123456789012345";

async function response(value: Response | undefined): Promise<Response> {
  if (!(value instanceof Response)) throw new Error("Supabase Edge API returned no Response");
  return value;
}

async function sha256HmacHex(key: string, value: Uint8Array): Promise<string> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, input.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("bundled Edge API runs the real customer Fastify surface against the restricted fixture", async () => {
  const databaseUrl = Deno.env.get("DABBOBA_EDGE_SMOKE_DATABASE_URL");
  if (!databaseUrl) throw new Error("Missing DABBOBA_EDGE_SMOKE_DATABASE_URL");
  const harness = await createLocalEdgeApiIntegrationHarness({ databaseUrl, hmacKey: HMAC_KEY });
  try {
    const health = await response(await harness.handler(new Request("https://example.test/dabboba-api/healthz")));
    if (health.status !== 200) throw new Error("Edge health route failed");
    const ready = await response(await harness.handler(new Request("https://example.test/dabboba-api/readyz")));
    if (ready.status !== 200) throw new Error("Edge readiness route failed");
    const catalog = await response(await harness.handler(new Request("https://example.test/dabboba-api/v1/catalog/products?limit=1")));
    if (catalog.status !== 200) throw new Error("Edge catalog route failed");
    const unauthorized = await response(await harness.handler(new Request("https://example.test/dabboba-api/v1/account/profile")));
    if (unauthorized.status !== 401) throw new Error("Edge auth boundary failed");
    const admin = await response(await harness.handler(new Request("https://example.test/dabboba-api/v1/admin/dashboard")));
    if (admin.status !== 404) throw new Error("Edge customer surface isolation failed");

    const cors = await response(await harness.handler(new Request("https://example.test/dabboba-api/v1/catalog/products", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.test",
        "access-control-request-method": "GET",
      },
    })));
    if (cors.status !== 204 || cors.headers.get("access-control-allow-origin") !== "https://app.example.test") {
      throw new Error("Edge CORS route failed");
    }
    const head = await response(await harness.handler(new Request("https://example.test/dabboba-api/healthz", { method: "HEAD" })));
    if (head.status !== 200 || (await head.arrayBuffer()).byteLength !== 0) throw new Error("Edge HEAD route failed");

    const rawBytes = new TextEncoder().encode('{ "amount" : 1000, "memo" : "한글" }\n');
    const rawDigest = await sha256HmacHex(HMAC_KEY, rawBytes);
    const raw = await response(await harness.handler(new Request("https://example.test/dabboba-api/v1/test-only/raw-hmac", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBytes,
    })));
    const rawBody = await raw.json() as { digest?: unknown };
    if (raw.status !== 200 || rawBody.digest !== rawDigest) throw new Error("Edge raw JSON byte preservation failed");

    const concurrent = await Promise.all(Array.from({ length: 8 }, async (_, index) => response(await harness.handler(
      new Request(`https://example.test/dabboba-api/${index % 2 ? "healthz" : "v1/catalog/products?limit=1"}`),
    ))));
    if (concurrent.some((item) => item.status !== 200)) throw new Error("Edge concurrent request smoke failed");
  } finally {
    await harness.close();
  }
});

Deno.test("bundled Edge API serves real loopback HTTP without losing request bytes or surface boundaries", async () => {
  const databaseUrl = Deno.env.get("DABBOBA_EDGE_SMOKE_DATABASE_URL");
  if (!databaseUrl) throw new Error("Missing DABBOBA_EDGE_SMOKE_DATABASE_URL");
  const harness = await createLocalEdgeApiIntegrationHarness({ databaseUrl, hmacKey: HMAC_KEY });
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  try {
    server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request, info) =>
      response(await harness.handler(request, { remoteAddr: { hostname: info.remoteAddr.hostname } })));
    const base = `http://127.0.0.1:${server.addr.port}/dabboba-api`;
    const request = async (path: string, init?: RequestInit) => {
      const result = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
      // Consume every response so the test's leak checks remain meaningful.
      return { status: result.status, headers: result.headers, bytes: new Uint8Array(await result.arrayBuffer()) };
    };
    for (const [path, expected] of [
      ["/healthz", 200], ["/readyz", 200], ["/v1/catalog/products?limit=1", 200],
      ["/v1/account/profile", 401], ["/v1/admin/dashboard", 404],
    ] as const) {
      const result = await request(path);
      if (result.status !== expected) throw new Error(`HTTP ${path}: expected ${expected}, received ${result.status}`);
    }
    const cors = await request("/v1/catalog/products", {
      method: "OPTIONS",
      headers: { origin: "https://app.example.test", "access-control-request-method": "GET" },
    });
    if (cors.status !== 204 || cors.headers.get("access-control-allow-origin") !== "https://app.example.test") {
      throw new Error("HTTP CORS boundary failed");
    }
    const head = await request("/healthz", { method: "HEAD" });
    if (head.status !== 200 || head.bytes.length !== 0) throw new Error("HTTP HEAD must have no response body");
    const bytes = new TextEncoder().encode('{ "amount" : 1000, "memo" : "한글" }\n');
    const raw = await request("/v1/test-only/raw-hmac", {
      method: "POST", headers: { "content-type": "application/json" }, body: bytes,
    });
    const digest = (JSON.parse(new TextDecoder().decode(raw.bytes)) as { digest?: unknown }).digest;
    if (raw.status !== 200 || digest !== await sha256HmacHex(HMAC_KEY, bytes)) {
      throw new Error("HTTP ingress changed the signed JSON bytes");
    }
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => request("/healthz")));
    if (concurrent.some((item) => item.status !== 200)) throw new Error("HTTP concurrent requests failed");
  } finally {
    try { await server?.shutdown(); }
    finally { await harness.close(); }
  }
});
