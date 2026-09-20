import { createHmac } from "node:crypto";
import type { DatabasePool } from "@dabboba/db";
import { createDatabasePool } from "@dabboba/db";
import { buildAppCore } from "./app-core.js";
import { createSupabaseEdgeApiHandler } from "./edge-handler.js";
import { createEdgeApiLogger } from "./lib/edge-logger.js";
import { edgeMediaRuntime } from "./lib/media-runtime-edge.js";

const FIXTURE_HOST = "127.0.0.1";
const FIXTURE_PORT = "55441";
const FIXTURE_DATABASE = "dabboba_edge_test";
const FIXTURE_ROLE = "dabboba_runtime";
const PROJECT_REFERENCE = "abcdefghijklmnopqrst";

function assertFixtureDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error("Edge API smoke requires a valid local fixture URL"); }
  let username: string;
  try { username = decodeURIComponent(parsed.username); }
  catch { throw new Error("Edge API smoke requires the restricted fixture role"); }
  if (
    parsed.protocol !== "postgresql:"
    || parsed.hostname !== FIXTURE_HOST
    || parsed.port !== FIXTURE_PORT
    || parsed.pathname !== `/${FIXTURE_DATABASE}`
    || username !== FIXTURE_ROLE
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Edge API smoke is restricted to the dedicated loopback runtime fixture");
  }
}

function productionBoundaryEnvironment() {
  return {
    DABBOBA_ENVIRONMENT_TIER: "STAGING",
    DABBOBA_API_DATABASE_URL: `postgresql://dabboba_runtime.${PROJECT_REFERENCE}:fixture@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`,
    DABBOBA_API_SESSION_TOKEN_PEPPER: "edge-smoke-session-pepper-1234567890",
    DABBOBA_API_WEB_ORIGINS: "https://app.example.test",
    DABBOBA_API_PAYMENT_PROVIDER: "UNCONFIGURED",
    DABBOBA_API_LOG_LEVEL: "silent",
    DABBOBA_STORAGE_BUCKET: "dabboba-media",
    DABBOBA_STORAGE_SERVICE_KEY: "edge-smoke-server-storage-key",
    DABBOBA_STORAGE_S3_ENDPOINT: `https://${PROJECT_REFERENCE}.storage.supabase.co/storage/v1/s3`,
    DABBOBA_STORAGE_S3_REGION: "ap-northeast-2",
    DABBOBA_STORAGE_S3_ACCESS_KEY_ID: "edge-smoke-access-key",
    DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: "edge-smoke-storage-secret",
    SUPABASE_URL: `https://${PROJECT_REFERENCE}.supabase.co`,
  };
}

export async function createLocalEdgeApiIntegrationHarness(input: {
  databaseUrl: string;
  hmacKey: string;
}) {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "test" || process.env.DABBOBA_ENVIRONMENT_TIER !== "TEST") {
    throw new Error("Edge API integration harness requires an explicit test environment");
  }
  assertFixtureDatabaseUrl(input.databaseUrl);
  if (!/^[\x21-\x7e]{32,128}$/.test(input.hmacKey)) throw new Error("Edge API smoke HMAC key is invalid");

  const pool = createDatabasePool(input.databaseUrl, "dabboba-api-edge-integration", {
    runtimeEnvironment: "test",
    max: 4,
    queryTimeoutMs: 12_000,
    statementTimeoutMs: 10_000,
  });
  let app: Awaited<ReturnType<typeof buildAppCore>>["app"] | null = null;
  let closed = false;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: productionBoundaryEnvironment,
    buildApp: async (config) => {
      const built = await buildAppCore({
        config,
        mediaRuntime: edgeMediaRuntime,
        pool: pool as DatabasePool,
        readinessPool: pool as DatabasePool,
        redis: null,
        loggerInstance: createEdgeApiLogger("silent"),
        edgeSafeLogging: true,
      });
      built.app.post("/v1/test-only/raw-hmac", async (request) => ({
        digest: createHmac("sha256", input.hmacKey).update(request.rawBody ?? Buffer.alloc(0)).digest("hex"),
      }));
      app = built.app;
      return built.app as never;
    },
  });

  return {
    handler,
    async close() {
      if (closed) return;
      closed = true;
      if (app) await app.close();
      await pool.end();
    },
  };
}
