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
