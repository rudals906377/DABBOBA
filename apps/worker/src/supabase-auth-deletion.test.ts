import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv } from "node:crypto";
import type { DatabasePool } from "@dabboba/db";
import type { WorkerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { MediaStore } from "./media.js";
import {
  cleanupSupabaseAuthUsers,
  HttpAppleTokenRevocationClient,
  HttpSupabaseAuthDeletionClient,
} from "./supabase-auth-deletion.js";

const userId = "7aa68a27-b48f-4ad9-bfac-5cf8b1ae8077";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
const emptyMediaStore: MediaStore = {
  async deleteObject() { return "deleted"; },
};

test("Supabase Auth deletion uses only the server Admin endpoint and treats an absent user as complete", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new HttpSupabaseAuthDeletionClient(
    "https://project.supabase.co",
    "server-only-secret-value",
    async (input, init) => {
      calls.push({ url: String(input), init: init! });
      return new Response(null, { status: 404 });
    },
  );
  await client.deleteUser(userId);
  assert.equal(calls[0]?.url, `https://project.supabase.co/auth/v1/admin/users/${userId}`);
  assert.equal(calls[0]?.init.method, "DELETE");
  assert.equal((calls[0]?.init.headers as Record<string, string>).apikey, "server-only-secret-value");
  await assert.rejects(() => client.deleteUser("not-a-uuid"), /user ID is invalid/);
});

test("targeted cleanup can claim only one exact request and rejects an invalid selector", async () => {
  const targetId = "ff738498-3f08-4caf-bb0a-1436bfb403b4";
  const claims: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      claims.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabasePool;
  const config = { outboxBatchSize: 20, jobBackoffMs: 1_000 } as WorkerConfig;
  await assert.rejects(
    () => cleanupSupabaseAuthUsers(pool, config, logger, () => true, null, null, null, "not-a-uuid"),
    /request ID is invalid/,
  );
  assert.equal(claims.length, 0);

  const result = await cleanupSupabaseAuthUsers(
    pool, config, logger, () => true, null, null, null, targetId,
  );
  assert.deepEqual(result, { completed: 0, deferred: 0 });
  assert.equal(claims.length, 1);
  assert.match(claims[0]!.sql, /AND deletion_request_id=\$1::uuid/);
  assert.deepEqual(claims[0]!.params, [targetId]);
});

test("Apple token revocation posts the refresh token only to Apple's fixed endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new HttpAppleTokenRevocationClient(
    "com.dabboba.app",
    "signed-client-secret-value-that-is-long-enough",
    async (input, init) => {
      calls.push({ url: String(input), init: init! });
      return new Response(null, { status: 200 });
    },
  );
  await client.revokeRefreshToken("r".repeat(64));
  assert.equal(calls[0]?.url, "https://appleid.apple.com/auth/revoke");
  assert.equal(calls[0]?.init.method, "POST");
  const body = new URLSearchParams(String(calls[0]?.init.body));
  assert.equal(body.get("client_id"), "com.dabboba.app");
  assert.equal(body.get("token"), "r".repeat(64));
  assert.equal(body.get("token_type_hint"), "refresh_token");
});

test("Apple revocation is confirmed before Supabase deletion and is not stored in logs", async () => {
  const localUserId = "local-user-apple";
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const refreshToken = "apple-refresh-" + "x".repeat(64);
  const nonce = Buffer.alloc(12, 9);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "base64url"), nonce);
  cipher.setAAD(Buffer.from(`dabboba:apple-refresh-token:${localUserId}:v1`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const order: string[] = [];
  let claimed = false;
  const pool = {
    async query(sql: string) {
      if (sql.includes("WITH candidate") && !claimed) {
        claimed = true;
        return { rowCount: 1, rows: [{
          id: "job-apple",
          deletion_request_id: "request-apple",
          user_id: localUserId,
          supabase_user_id: userId,
          external_deleted_at: null,
          apple_revoked_at: null,
          has_apple_identity: true,
          attempts: 1,
        }] };
      }
      if (sql.includes("WITH candidate")) return { rowCount: 0, rows: [] };
      if (sql.includes("COALESCE((SELECT balance")) return { rowCount: 1, rows: [{ point_balance: 0 }] };
      if (sql.includes("FROM apple_auth_credentials")) {
        return { rowCount: 1, rows: [{ ciphertext, nonce, auth_tag: authTag, key_version: 1 }] };
      }
      if (sql.includes("SET apple_revoked_at=now()")) { order.push("apple-marker"); return { rowCount: 1, rows: [] }; }
      if (sql.includes("SET external_deleted_at=now()")) { order.push("supabase-marker"); return { rowCount: 1, rows: [] }; }
      if (sql.includes("FROM media_assets")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql: string) {
          if (sql.includes("SELECT status FROM account_deletion_requests")) {
            return { rowCount: 1, rows: [{ status: "PROCESSING" }] };
          }
          if (sql.includes("SELECT id AS media_id")) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  } as unknown as DatabasePool;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    {
      outboxBatchSize: 1,
      jobBackoffMs: 1_000,
      appleRevocation: {
        clientId: "com.dabboba.app",
        clientSecret: "signed-client-secret-value-that-is-long-enough",
        encryptionKey,
        keyVersion: 1,
      },
    } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser() { order.push("supabase-delete"); } },
    emptyMediaStore,
    { async revokeRefreshToken(token) { assert.equal(token, refreshToken); order.push("apple-revoke"); } },
  );
  assert.deepEqual(result, { completed: 1, deferred: 0 });
  assert.deepEqual(order, ["apple-revoke", "apple-marker", "supabase-delete", "supabase-marker"]);
});

test("an Apple identity without revocation configuration stays retryable and never reaches Supabase deletion", async () => {
  const retryUpdates: unknown[][] = [];
  let claimed = false;
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH candidate") && !claimed) {
        claimed = true;
        return { rowCount: 1, rows: [{
          id: "job-apple-unconfigured",
          deletion_request_id: "request-apple-unconfigured",
          user_id: "local-user-apple-unconfigured",
          supabase_user_id: userId,
          external_deleted_at: null,
          apple_revoked_at: null,
          has_apple_identity: true,
          attempts: 1,
        }] };
      }
      if (sql.includes("COALESCE((SELECT balance")) return { rowCount: 1, rows: [{ point_balance: 0 }] };
      if (sql.includes("SET status='PENDING'")) {
        retryUpdates.push(params);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  } as unknown as DatabasePool;
  let supabaseDeletes = 0;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 1_000, appleRevocation: null } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser() { supabaseDeletes += 1; } },
    emptyMediaStore,
  );
  assert.deepEqual(result, { completed: 0, deferred: 1 });
  assert.equal(supabaseDeletes, 0);
  assert.equal(retryUpdates.length, 1);
  assert.equal(retryUpdates[0]?.[2], "Error");
});

test("successful Auth deletion completes the request and removes the transient identifier job", async () => {
  const queries: string[] = [];
  const transactionQueries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("WITH candidate")) {
        return {
          rowCount: 1,
          rows: [{
            id: "job-1",
            deletion_request_id: "request-1",
            user_id: "local-user-1",
            supabase_user_id: userId,
            external_deleted_at: null,
            attempts: 1,
          }],
        };
      }
      if (sql.includes("COALESCE((SELECT balance")) {
        return {
          rowCount: 1,
          rows: [{
            point_balance: 0,
            active_order_count: 0,
            active_payment_count: 0,
            available_draw_entitlement_count: 0,
            active_inventory_count: 0,
            active_shipping_request_count: 0,
            active_exchange_listing_count: 0,
            active_exchange_offer_count: 0,
          }],
        };
      }
      if (sql.includes("SET external_deleted_at=now()")) return { rowCount: 1, rows: [] };
      if (sql.includes("FROM media_assets")) {
        return {
          rowCount: 1,
          rows: [{
            id: "5cd96a59-d04a-4a92-8c34-22d172201670",
            owner_id: "local-user-1",
            object_key: "media/5cd96a59-d04a-4a92-8c34-22d172201670/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
            status: "READY",
            metadata: {},
          }],
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql: string) {
          if (sql !== "BEGIN" && sql !== "COMMIT") transactionQueries.push(sql);
          if (sql.includes("SELECT status FROM account_deletion_requests")) {
            return { rowCount: 1, rows: [{ status: "PROCESSING" }] };
          }
          if (sql.includes("SELECT id AS media_id")) {
            return {
              rowCount: 1,
              rows: [{ media_id: "5cd96a59-d04a-4a92-8c34-22d172201670" }],
            };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  } as unknown as DatabasePool;
  let deletions = 0;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 1_000 } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser(id) { assert.equal(id, userId); deletions += 1; } },
    emptyMediaStore,
  );
  assert.deepEqual(result, { completed: 1, deferred: 0 });
  assert.equal(deletions, 1);
  assert.equal(queries.findIndex((sql) => sql.includes("SET external_deleted_at=now()")) > 0, true);
  assert.equal(transactionQueries.some((sql) => sql.includes("SET status='COMPLETED'")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("DELETE FROM auth_identities")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("DELETE FROM inquiry_message_media")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("UPDATE inquiry_messages")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("UPDATE inquiries SET title")), true);
  const catalogCleanup = transactionQueries.find((sql) => sql.includes("UPDATE catalog_requests"));
  assert.ok(catalogCleanup);
  assert.match(catalogCleanup, /SET name='[^']+',reference_url=NULL,description=NULL,media_id=NULL/);
  assert.match(catalogCleanup, /WHERE user_id=\$1/);
  assert.doesNotMatch(catalogCleanup, /\bstatus\s*=/i);
  assert.doesNotMatch(catalogCleanup, /\bdecision_reason\s*=/i);
  const listingCleanup = transactionQueries.find((sql) => sql.includes("UPDATE exchange_listings"));
  assert.ok(listingCleanup);
  assert.match(listingCleanup, /SET title='[^']+',details='[^']+'/);
  assert.match(listingCleanup, /WHERE author_id=\$1/);
  assert.doesNotMatch(listingCleanup, /\bstatus\s*=/i);
  assert.doesNotMatch(listingCleanup, /\baccepted_offer_id\s*=/i);
  assert.doesNotMatch(listingCleanup, /\bcancel_reason\s*=/i);
  const offerCleanup = transactionQueries.find((sql) => sql.includes("UPDATE exchange_offers"));
  assert.ok(offerCleanup);
  assert.match(offerCleanup, /SET message='[^']+'/);
  assert.match(offerCleanup, /WHERE proposer_id=\$1/);
  assert.doesNotMatch(offerCleanup, /\bstatus\s*=/i);
  assert.doesNotMatch(offerCleanup, /\bdecided_at\s*=/i);
  assert.equal(transactionQueries.some((sql) => sql.includes("DELETE FROM account_auth_deletion_jobs")), true);
});

test("failed Auth deletion releases the lease and retains only a bounded error identity", async () => {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  let claimed = false;
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH candidate") && !claimed) {
        claimed = true;
        return {
          rowCount: 1,
          rows: [{
            id: "job-2",
            deletion_request_id: "request-2",
            user_id: "local-user-2",
            supabase_user_id: userId,
            external_deleted_at: null,
            attempts: 2,
          }],
        };
      }
      if (sql.includes("UPDATE account_auth_deletion_jobs")) {
        updates.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabasePool;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 1_000 } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser() { throw new Error("secret response body"); } },
    emptyMediaStore,
  );
  assert.deepEqual(result, { completed: 0, deferred: 1 });
  assert.match(updates[0]!.sql, /status='PENDING'/);
  assert.equal(updates[0]!.params[2], "Error");
  assert.notEqual(updates[0]!.params[2], "secret response body");
});

test("a blocker discovered immediately before provider deletion returns the request to BLOCKED without deleting Auth", async () => {
  const transactionQueries: string[] = [];
  const pool = {
    async query(sql: string) {
      if (sql.includes("WITH candidate")) {
        return {
          rowCount: 1,
          rows: [{
            id: "job-blocked",
            deletion_request_id: "request-blocked",
            user_id: "local-user-blocked",
            supabase_user_id: userId,
            external_deleted_at: null,
            attempts: 1,
          }],
        };
      }
      if (sql.includes("COALESCE((SELECT balance")) {
        return { rowCount: 1, rows: [{ point_balance: 100 }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql: string) {
          if (sql !== "BEGIN" && sql !== "COMMIT") transactionQueries.push(sql);
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  } as unknown as DatabasePool;
  let providerDeletes = 0;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 1_000 } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser() { providerDeletes += 1; } },
    emptyMediaStore,
  );
  assert.deepEqual(result, { completed: 0, deferred: 1 });
  assert.equal(providerDeletes, 0);
  assert.equal(transactionQueries.some((sql) => sql.includes("SET status='BLOCKED'")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("DELETE FROM account_auth_deletion_jobs")), true);
  assert.equal(transactionQueries.some((sql) => sql.includes("DELETE FROM auth_identities")), false);
});

test("local finalization retries after provider deletion without calling the provider twice", async () => {
  let externalDeleted = false;
  let claims = 0;
  let failLocalOnce = true;
  const retryUpdates: unknown[][] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH candidate")) {
        claims += 1;
        return {
          rowCount: 1,
          rows: [{
            id: "job-retry",
            deletion_request_id: "request-retry",
            user_id: "local-user-retry",
            supabase_user_id: userId,
            external_deleted_at: externalDeleted ? new Date() : null,
            attempts: claims,
          }],
        };
      }
      if (sql.includes("COALESCE((SELECT balance")) {
        return { rowCount: 1, rows: [{ point_balance: 0 }] };
      }
      if (sql.includes("SET external_deleted_at=now()")) {
        externalDeleted = true;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM media_assets")) return { rowCount: 0, rows: [] };
      if (sql.includes("SET status='PENDING'")) {
        retryUpdates.push(params);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql: string) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 1, rows: [] };
          if (sql.includes("SELECT status FROM account_deletion_requests")) {
            return { rowCount: 1, rows: [{ status: "PROCESSING" }] };
          }
          if (sql.includes("SELECT id AS media_id")) return { rowCount: 0, rows: [] };
          if (failLocalOnce && sql.includes("DELETE FROM auth_identities")) {
            failLocalOnce = false;
            throw new Error("transient local database failure");
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  } as unknown as DatabasePool;
  let providerDeletes = 0;
  const client = { async deleteUser() { providerDeletes += 1; } };
  const first = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 100 } as WorkerConfig,
    logger,
    () => true,
    client,
    emptyMediaStore,
  );
  const second = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 100 } as WorkerConfig,
    logger,
    () => true,
    client,
    emptyMediaStore,
  );
  assert.deepEqual(first, { completed: 0, deferred: 1 });
  assert.deepEqual(second, { completed: 1, deferred: 0 });
  assert.equal(providerDeletes, 1);
  assert.equal(retryUpdates.length, 1);
});

test("authored Storage objects must be deleted before local identity and PII finalization", async () => {
  const observed: string[] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("WITH candidate")) {
        return {
          rowCount: 1,
          rows: [{
            id: "job-media",
            deletion_request_id: "request-media",
            user_id: "local-user-media",
            supabase_user_id: userId,
            external_deleted_at: new Date(),
            attempts: 1,
          }],
        };
      }
      if (sql.includes("FROM media_assets")) {
        return {
          rowCount: 1,
          rows: [{
            id: "5cd96a59-d04a-4a92-8c34-22d172201670",
            owner_id: "local-user-media",
            object_key: "media/5cd96a59-d04a-4a92-8c34-22d172201670/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
            status: "READY",
            metadata: {},
          }],
        };
      }
      if (sql.includes("SET status='PENDING'")) {
        observed.push("retry");
        assert.equal(params[2], "Error");
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      observed.push("local-finalization");
      throw new Error("local finalization must not start before Storage deletion succeeds");
    },
  } as unknown as DatabasePool;
  const result = await cleanupSupabaseAuthUsers(
    pool,
    { outboxBatchSize: 1, jobBackoffMs: 1_000 } as WorkerConfig,
    logger,
    () => true,
    { async deleteUser() { throw new Error("provider must not be called twice"); } },
    {
      async deleteObject(objectKey) {
        observed.push(`storage:${objectKey}`);
        return "skipped";
      },
    },
  );
  assert.deepEqual(result, { completed: 0, deferred: 1 });
  assert.deepEqual(observed.map((value) => value.startsWith("storage:") ? "storage" : value), ["storage", "retry"]);
});
