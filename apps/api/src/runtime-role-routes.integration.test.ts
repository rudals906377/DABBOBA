import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import {
  createDatabasePool,
  createMigrationDatabasePool,
  RUNTIME_DATABASE_ROLE,
} from "@dabboba/db";
import { buildApp } from "./app.js";
import { issueSession } from "./plugins/auth.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL;

test(
  "customer API routes run as the dedicated runtime database role",
  { skip: !migrationDatabaseUrl || !runtimeDatabaseUrl, timeout: 60_000 },
  async (t) => {
    const ownerPool = createMigrationDatabasePool(
      migrationDatabaseUrl!,
      "dabboba-runtime-route-fixtures",
    );
    const runtimePool = createDatabasePool(
      runtimeDatabaseUrl!,
      "dabboba-runtime-route-integration",
    );
    const config: ApiConfig = {
      environment: "test",
      surface: "customer",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: runtimeDatabaseUrl!,
      redisUrl: null,
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "runtime-route-integration-pepper",
      adminProxyIdentitySecret: null,
      supabaseUrl: null,
      supabaseJwtAudience: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool: runtimePool, redis: null });
    t.after(async () => {
      await app.close();
      await runtimePool.end();
      await ownerPool.end();
    });

    const identity = await runtimePool.query<{ current_user: string }>("SELECT current_user");
    assert.equal(identity.rows[0]?.current_user, RUNTIME_DATABASE_ROLE);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = await ownerPool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status)
       VALUES($1,$2,'USER','ACTIVE') RETURNING id`,
      [`runtime-route-${suffix}@example.test`, `runtime route ${suffix}`],
    );
    const userId = user.rows[0]!.id;
    const session = await issueSession(runtimePool, config, {
      userId,
      kind: "USER",
      ip: "203.0.113.96",
      userAgent: "Dabboba Runtime Route Integration/1.0",
    });
    const authorization = `Bearer ${session.token}`;

    const catalog = await app.inject({
      method: "GET",
      url: "/v1/catalog/products?limit=1",
    });
    assert.equal(catalog.statusCode, 200, catalog.body);

    const initial = await app.inject({
      method: "GET",
      url: "/v1/account/notification-preferences",
      headers: { authorization },
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal((initial.json() as { version: number }).version, 1);

    const idempotencyKey = `runtime-route-${randomUUID()}`;
    const changed = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { authorization, "idempotency-key": idempotencyKey },
      payload: {
        exchangeUpdates: false,
        requestUpdates: true,
        restockUpdates: true,
        marketingSms: false,
        marketingEmail: true,
        marketingPush: true,
        personalizedRecommendations: true,
        expectedVersion: 1,
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((changed.json() as { version: number }).version, 2);

    const adminRoute = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization },
    });
    assert.equal(adminRoute.statusCode, 404, adminRoute.body);

    const durableState = await ownerPool.query<{
      event_count: string;
      outbox_count: string;
      completed_idempotency_count: string;
    }>(
      `SELECT
        (SELECT count(*) FROM notification_preference_events WHERE user_id=$1) AS event_count,
        (SELECT count(*) FROM outbox_events
          WHERE aggregate_type='NOTIFICATION_PREFERENCES'
            AND aggregate_id=$1::text
            AND event_type='notification.preferences.updated') AS outbox_count,
        (SELECT count(*) FROM idempotency_keys
          WHERE actor_id=$1
            AND scope='ACCOUNT_NOTIFICATION_PREFERENCES_UPDATE'
            AND idempotency_key=$2
            AND state='COMPLETED') AS completed_idempotency_count`,
      [userId, idempotencyKey],
    );
    assert.deepEqual(durableState.rows[0], {
      event_count: "2",
      outbox_count: "1",
      completed_idempotency_count: "1",
    });
  },
);
