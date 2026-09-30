import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool } from "@dabboba/db";
import { buildAppCore } from "../app-core.js";
import type { ApiMediaRuntime, ApiMediaStorage } from "../lib/media-runtime.js";
import { SUPABASE_MAX_UPLOAD_BYTES } from "../lib/media-storage.js";
import { adminMediaReadPermission } from "./media.js";

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const mediaId = "30000000-0000-4000-8000-000000000001";
const ownerId = "40000000-0000-4000-8000-000000000001";
const bearer = { authorization: `Bearer ${"t".repeat(43)}` };

function config(): ApiConfig {
  return {
    environment: "test",
    surface: "all",
    host: "127.0.0.1",
    port: 8788,
    databaseUrl: "postgresql://unused",
    redisUrl: null,
    webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: ["http://127.0.0.1:4180"],
    sessionTokenPepper: "media-access-test-pepper",
    adminProxyIdentitySecret: null,
    supabaseUrl: null,
    supabaseJwtAudience: null,
    sessionTtlDays: 30,
    paymentProvider: "UNCONFIGURED",
    paymentWebhookSecret: null,
    gcsBucket: null,
    gcsProjectId: null,
    mediaStorageProvider: "supabase",
    logLevel: "silent",
  };
}

function storage(signed: string[]): ApiMediaStorage {
  return {
    provider: "supabase",
    bucket: "private-media",
    maxUploadBytes: SUPABASE_MAX_UPLOAD_BYTES,
    location: { provider: "supabase", bucket: "private-media" },
    file: () => { throw new Error("not used"); },
    upload: async () => { throw new Error("upload must not be signed for an oversized intent"); },
    saveFinal: async () => { throw new Error("not used"); },
    signedRead: async (key: string) => {
      signed.push(key);
      return `https://storage.example.test/${key}`;
    },
  } as unknown as ApiMediaStorage;
}

function runtime(signed: string[]): ApiMediaRuntime {
  return {
    completionAvailable: true,
    configuredMediaStorage: () => storage(signed),
    sanitizeImage: async () => { throw new Error("not used"); },
  };
}

type Query = { sql: string; values: unknown[] };

function fakePool(input: { kind: "USER" | "ADMIN"; role: string; permissions: string[]; purpose?: string }) {
  const observed: Query[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    observed.push({ sql, values });
    if (sql.includes("WITH active_session AS MATERIALIZED")) {
      return {
        rowCount: 1,
        rows: [{
          session_id: sessionId,
          session_kind: input.kind,
          scope: "FULL",
          user_id: userId,
          email: "person@example.test",
          nickname: "person",
          role: input.role,
          status: "ACTIVE",
          suspended_until: null,
        }],
      };
    }
    if (sql.includes("FROM legal_document_versions") && sql.includes("ORDER BY policy_key")) {
      return {
        rowCount: 2,
        rows: [
          { policy_key: "PRIVACY", policy_version: "v1", content_sha256: "a".repeat(64) },
          { policy_key: "TERMS", policy_version: "v1", content_sha256: "b".repeat(64) },
        ],
      };
    }
    if (sql.includes("accepted_count")) return { rowCount: 1, rows: [{ accepted_count: 2 }] };
    if (sql.includes("FROM admin_role_permissions")) {
      return input.permissions.includes(String(values[1])) ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM media_assets WHERE id=$1 AND status='READY'")) {
      return {
        rowCount: 1,
        rows: [{
          id: mediaId,
          owner_id: ownerId,
          purpose: input.purpose ?? "INQUIRY",
          object_key: `uploads/${ownerId}/${mediaId}/evidence.webp`,
          object_generation: null,
          detected_mime_type: "image/webp",
          metadata: { storage: { provider: "supabase", bucket: "private-media", version: "50000000-0000-4000-8000-000000000001" } },
        }],
      };
    }
    if (sql.includes("FROM sessions")) return { rowCount: 1, rows: [{ ip_address: "192.0.2.1", user_agent: "console" }] };
    return { rowCount: 0, rows: [] };
  };
  const client = { query, release() {} };
  return { pool: { query, connect: async () => client } as unknown as DatabasePool, observed };
}

test("admin media read permission follows the console surface that owns the upload", () => {
  assert.equal(adminMediaReadPermission("INQUIRY"), "inquiries.read");
  assert.equal(adminMediaReadPermission("CATALOG"), "catalog.read");
  assert.equal(adminMediaReadPermission("CATALOG_REQUEST"), "catalog.read");
  for (const purpose of ["POST", "COMMENT", "EXCHANGE", "WANTED_REQUEST", "PROFILE"]) {
    assert.equal(adminMediaReadPermission(purpose), "moderation.read", purpose);
  }
});

test("admin media signed URLs require the owning permission and are audited before signing", async () => {
  const denied = fakePool({ kind: "ADMIN", role: "ADMIN", permissions: ["moderation.read"] });
  const deniedSigned: string[] = [];
  const deniedApp = await buildAppCore({ config: config(), mediaRuntime: runtime(deniedSigned), pool: denied.pool, redis: null });
  try {
    const response = await deniedApp.app.inject({ method: "GET", url: `/v1/admin/media/${mediaId}/url`, headers: bearer });
    assert.equal(response.statusCode, 403, response.body);
    assert.deepEqual(deniedSigned, []);
    assert.equal(denied.observed.some(({ sql }) => sql.includes("INSERT INTO admin_audit_logs")), false);
  } finally {
    await deniedApp.app.close();
  }

  const allowed = fakePool({ kind: "ADMIN", role: "ADMIN", permissions: ["inquiries.read"] });
  const signed: string[] = [];
  const allowedApp = await buildAppCore({ config: config(), mediaRuntime: runtime(signed), pool: allowed.pool, redis: null });
  try {
    const response = await allowedApp.app.inject({ method: "GET", url: `/v1/admin/media/${mediaId}/url`, headers: bearer });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(signed.length, 1);
    const audit = allowed.observed.find(({ sql }) => sql.includes("INSERT INTO admin_audit_logs"));
    assert.ok(audit);
    assert.match(audit.sql, /'MEDIA_SIGNED_URL_ISSUED','MEDIA'/);
    assert.equal(audit.values[0], userId);
    assert.equal(audit.values[1], mediaId);
    assert.equal(audit.values[3], response.headers["x-request-id"]);
    assert.deepEqual(JSON.parse(String(audit.values[5])), { purpose: "INQUIRY", ownerId, permission: "inquiries.read" });
    const auditIndex = allowed.observed.indexOf(audit);
    const commitIndex = allowed.observed.findIndex(({ sql }, index) => index > auditIndex && sql === "COMMIT");
    assert.ok(commitIndex > auditIndex);
  } finally {
    await allowedApp.app.close();
  }
});

test("upload intents above the active storage provider's limit are rejected with 413", async () => {
  const { pool } = fakePool({ kind: "USER", role: "USER", permissions: [] });
  const { app } = await buildAppCore({ config: config(), mediaRuntime: runtime([]), pool, redis: null });
  const body = (byteSize: number) => ({
    purpose: "INQUIRY",
    filename: "evidence.png",
    mimeType: "image/png",
    byteSize,
    checksumSha256: "c".repeat(64),
    acceptedUploadMethods: ["PUT"],
  });
  try {
    for (const byteSize of [SUPABASE_MAX_UPLOAD_BYTES + 1, 20 * 1024 * 1024]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/media/uploads",
        headers: { ...bearer, "idempotency-key": "media-intent-key-0001" },
        payload: body(byteSize),
      });
      assert.equal(response.statusCode, 413, response.body);
      assert.equal(response.json().error.code, "MEDIA_TOO_LARGE");
    }
  } finally {
    await app.close();
  }
});
