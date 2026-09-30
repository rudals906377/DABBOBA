import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "notification preferences persist exact consent, replay safely, reject stale writes, and append immutable evidence",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-notification-preferences-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "notification-preferences-integration-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`],
      );
      await acceptRequiredPoliciesForIntegrationTest(pool, user.rows[0]!.id);
      const session = await issueSession(pool, config, {
        userId: user.rows[0]!.id,
        kind: "USER",
        ip: "203.0.113.95",
        userAgent: "Dabboba Notification Preferences Integration/1.0",
      });
      return { id: user.rows[0]!.id, token: session.token };
    };
    const owner = await createActor("preference-owner");
    const stranger = await createActor("preference-stranger");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });

    const missingBackfill = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM users u
       LEFT JOIN notification_preferences p ON p.user_id=u.id
       WHERE u.id=ANY($1::uuid[]) AND u.role='USER' AND p.user_id IS NULL`,
      [[owner.id, stranger.id]],
    );
    assert.equal(missingBackfill.rows[0]!.count, "0");

    const initial = await app.inject({
      method: "GET",
      url: "/v1/account/notification-preferences",
      headers: auth(owner.token),
    });
    assert.equal(initial.statusCode, 200, initial.body);
    const initialBody = initial.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(initialBody).sort(), [
      "exchangeUpdates",
      "marketingEmail",
      "marketingPush",
      "marketingSms",
      "orderUpdates",
      "personalizedRecommendations",
      "requestUpdates",
      "restockUpdates",
      "updatedAt",
      "version",
    ]);
    assert.deepEqual({ ...initialBody, updatedAt: "checked-separately" }, {
      orderUpdates: true,
      exchangeUpdates: true,
      requestUpdates: true,
      restockUpdates: false,
      marketingSms: false,
      marketingEmail: false,
      marketingPush: false,
      personalizedRecommendations: false,
      version: 1,
      updatedAt: "checked-separately",
    });
    assert.equal(typeof initialBody.updatedAt, "string");
    assert.equal(Number.isNaN(Date.parse(String(initialBody.updatedAt))), false);

    const initialEvidence = await pool.query<{ event_type: string; version: number; before_state: unknown; after_state: unknown }>(
      `SELECT event_type,version,before_state,after_state
       FROM notification_preference_events WHERE user_id=$1 ORDER BY version`,
      [owner.id],
    );
    assert.equal(initialEvidence.rowCount, 1);
    assert.equal(initialEvidence.rows[0]!.event_type, "INITIALIZED");
    assert.equal(initialEvidence.rows[0]!.version, 1);
    assert.equal(initialEvidence.rows[0]!.before_state, null);
    assert.deepEqual(initialEvidence.rows[0]!.after_state, {
      orderUpdates: true,
      exchangeUpdates: true,
      requestUpdates: true,
      restockUpdates: false,
      marketingSms: false,
      marketingEmail: false,
      marketingPush: false,
      personalizedRecommendations: false,
      version: 1,
    });

    const payload = {
      exchangeUpdates: false,
      requestUpdates: false,
      restockUpdates: true,
      marketingSms: true,
      marketingEmail: false,
      marketingPush: true,
      personalizedRecommendations: true,
      expectedVersion: 1,
    };
    const idempotencyKey = `notification-preferences-${randomUUID()}`;
    const changed = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": idempotencyKey },
      payload,
    });
    assert.equal(changed.statusCode, 200, changed.body);
    const changedBody = changed.json() as Record<string, unknown>;
    assert.deepEqual({ ...changedBody, updatedAt: "checked-separately" }, {
      orderUpdates: true,
      exchangeUpdates: false,
      requestUpdates: false,
      restockUpdates: true,
      marketingSms: true,
      marketingEmail: false,
      marketingPush: true,
      personalizedRecommendations: true,
      version: 2,
      updatedAt: "checked-separately",
    });

    const replay = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": idempotencyKey },
      payload,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(replay.json(), changed.json());

    const changedPayloadReuse = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": idempotencyKey },
      payload: { ...payload, marketingEmail: true },
    });
    assert.equal(changedPayloadReuse.statusCode, 409, changedPayloadReuse.body);

    const staleKey = `notification-preferences-stale-${randomUUID()}`;
    const stale = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": staleKey },
      payload: { ...payload, marketingEmail: true },
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const requiredOrderMutation = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": `notification-order-${randomUUID()}` },
      payload: { ...payload, expectedVersion: 2, orderUpdates: false },
    });
    assert.equal(requiredOrderMutation.statusCode, 400, requiredOrderMutation.body);
    const { marketingPush: _missing, ...missingPayload } = { ...payload, expectedVersion: 2 };
    const missingPreference = await app.inject({
      method: "PUT",
      url: "/v1/account/notification-preferences",
      headers: { ...auth(owner.token), "idempotency-key": `notification-missing-${randomUUID()}` },
      payload: missingPayload,
    });
    assert.equal(missingPreference.statusCode, 400, missingPreference.body);

    const durableState = await pool.query<{
      version: number;
      event_count: string;
      outbox_count: string;
      completed_idempotency_count: string;
      stale_idempotency_count: string;
    }>(
      `SELECT p.version,
        (SELECT count(*) FROM notification_preference_events e WHERE e.user_id=p.user_id) AS event_count,
        (SELECT count(*) FROM outbox_events o
          WHERE o.aggregate_type='NOTIFICATION_PREFERENCES' AND o.aggregate_id=p.user_id::text
            AND o.event_type='notification.preferences.updated') AS outbox_count,
        (SELECT count(*) FROM idempotency_keys i
          WHERE i.actor_id=p.user_id AND i.scope='ACCOUNT_NOTIFICATION_PREFERENCES_UPDATE'
            AND i.idempotency_key=$2 AND i.state='COMPLETED') AS completed_idempotency_count,
        (SELECT count(*) FROM idempotency_keys i
          WHERE i.actor_id=p.user_id AND i.scope='ACCOUNT_NOTIFICATION_PREFERENCES_UPDATE'
            AND i.idempotency_key=$3) AS stale_idempotency_count
       FROM notification_preferences p WHERE p.user_id=$1`,
      [owner.id, idempotencyKey, staleKey],
    );
    assert.deepEqual(durableState.rows[0], {
      version: 2,
      event_count: "2",
      outbox_count: "1",
      completed_idempotency_count: "1",
      stale_idempotency_count: "0",
    });

    const updateEvidence = await pool.query<{
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
      actor_user_id: string;
      idempotency_key: string;
      request_id: string;
    }>(
      `SELECT before_state,after_state,actor_user_id,idempotency_key,request_id
       FROM notification_preference_events WHERE user_id=$1 AND event_type='UPDATED'`,
      [owner.id],
    );
    assert.equal(updateEvidence.rowCount, 1);
    assert.equal(updateEvidence.rows[0]!.before_state.orderUpdates, true);
    assert.equal(updateEvidence.rows[0]!.before_state.version, 1);
    assert.equal(updateEvidence.rows[0]!.after_state.orderUpdates, true);
    assert.equal(updateEvidence.rows[0]!.after_state.exchangeUpdates, false);
    assert.equal(updateEvidence.rows[0]!.after_state.version, 2);
    assert.equal(updateEvidence.rows[0]!.actor_user_id, owner.id);
    assert.equal(updateEvidence.rows[0]!.idempotency_key, idempotencyKey);
    assert.ok(updateEvidence.rows[0]!.request_id);

    await assert.rejects(
      pool.query(
        "UPDATE notification_preference_events SET after_state='{}'::jsonb WHERE user_id=$1 AND event_type='UPDATED'",
        [owner.id],
      ),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );
    await assert.rejects(
      pool.query("DELETE FROM notification_preference_events WHERE user_id=$1 AND event_type='UPDATED'", [owner.id]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );

    const strangerState = await app.inject({
      method: "GET",
      url: "/v1/account/notification-preferences",
      headers: auth(stranger.token),
    });
    assert.equal(strangerState.statusCode, 200, strangerState.body);
    assert.equal((strangerState.json() as { exchangeUpdates: boolean }).exchangeUpdates, true);
    assert.equal((strangerState.json() as { version: number }).version, 1);
  },
);
