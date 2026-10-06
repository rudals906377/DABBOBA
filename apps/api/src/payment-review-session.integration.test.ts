import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PAYMENT_REVIEW_PROJECT_REF, type ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "./app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "./integration-test-fixtures.js";
import { issueSession } from "./plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;
const reviewSubject = "00000000-0000-4000-8000-0000000000aa";

test(
  "payment-review sessions stay capped to the stored review deadline and end once review login is disabled",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-payment-review-session-integration");
    const deadline = new Date(Date.now() + 2 * 3_600_000);
    const base: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "payment-review-session-pepper-value",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 30,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    // The review boundary is evaluated from configuration only; requests still
    // run against the disposable integration database through `pool`.
    const reviewConfig: ApiConfig = {
      ...base,
      environmentTier: "STAGING",
      databaseUrl: `postgres://runtime.${PAYMENT_REVIEW_PROJECT_REF}:synthetic@aws-0-ap-northeast-2.pooler.supabase.com/postgres`,
      supabaseUrl: `https://${PAYMENT_REVIEW_PROJECT_REF}.supabase.co`,
      portOne: {
        apiSecret: "synthetic", merchantId: "merchant", storeId: "store",
        channelKey: "channel-key-synthetic", channelEnvironment: "TEST", webhookSecret: "synthetic",
      },
      paymentReviewLogin: { email: "review@example.test", subject: reviewSubject, expiresAt: deadline.toISOString() },
    };
    const enabled = await buildApp({ config: reviewConfig, pool, redis: null });
    const disabled = await buildApp({ config: { ...reviewConfig, paymentReviewLogin: null }, pool, redis: null });
    t.after(async () => {
      await enabled.app.close();
      await disabled.app.close();
      await pool.end();
    });

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createUser = async (label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname) VALUES($1,'심사 세션 테스트') RETURNING id",
        [`${label}-${suffix}@example.test`],
      );
      await acceptRequiredPoliciesForIntegrationTest(pool, user.rows[0]!.id);
      return user.rows[0]!.id;
    };
    const refresh = (app: typeof enabled.app, token: string) => app.inject({
      method: "POST", url: "/v1/auth/refresh", headers: { authorization: `Bearer ${token}` },
    });
    const sessionRow = async (id: string) => (await pool.query<{
      expires_at: Date; review_access_expires_at: Date | null; revoked_at: Date | null; revoke_reason: string | null;
    }>("SELECT expires_at,review_access_expires_at,revoked_at,revoke_reason FROM sessions WHERE id=$1", [id])).rows[0]!;

    // A review session is clamped once against the absolute deadline.
    const reviewerId = await createUser("reviewer");
    const nearDeadline = new Date(Date.now() + 90_000);
    const clamped = await issueSession(pool, reviewConfig, {
      userId: reviewerId, kind: "USER", expiresInMs: 86_400_000, reviewAccessExpiresAt: nearDeadline,
    });
    assert.equal(clamped.expiresAt.getTime(), nearDeadline.getTime());
    assert.equal((await sessionRow(clamped.sessionId)).review_access_expires_at?.getTime(), nearDeadline.getTime());

    const issued = await issueSession(pool, reviewConfig, {
      userId: reviewerId, kind: "USER", expiresInMs: 86_400_000, reviewAccessExpiresAt: deadline,
    });
    assert.ok(issued.expiresAt.getTime() <= deadline.getTime());

    const rotated = await refresh(enabled.app, issued.token);
    assert.equal(rotated.statusCode, 201, rotated.body);
    const rotatedBody = rotated.json() as { token: string; session: { id: string } };
    const rotatedRow = await sessionRow(rotatedBody.session.id);
    assert.equal(rotatedRow.review_access_expires_at?.getTime(), deadline.getTime());
    assert.ok(rotatedRow.expires_at.getTime() <= deadline.getTime());

    // Disabling the review login ends the session instead of minting an
    // ordinary 30-day customer session.
    const ended = await refresh(disabled.app, rotatedBody.token);
    assert.equal(ended.statusCode, 401, ended.body);
    const endedRow = await sessionRow(rotatedBody.session.id);
    assert.ok(endedRow.revoked_at);
    assert.equal(endedRow.revoke_reason, "REVIEW_ACCESS_ENDED");
    const children = await pool.query("SELECT 1 FROM sessions WHERE rotated_from_session_id=$1", [rotatedBody.session.id]);
    assert.equal(children.rowCount, 0);

    // A pre-column review session is still recognized by its configured identity.
    const legacyId = await createUser("legacy-reviewer");
    await pool.query(
      "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'EMAIL',$2,now())",
      [legacyId, `${reviewConfig.supabaseUrl}/auth/v1#${reviewSubject}`],
    );
    const legacy = await issueSession(pool, reviewConfig, { userId: legacyId, kind: "USER", expiresInMs: 3_600_000 });
    const legacyRotated = await refresh(enabled.app, legacy.token);
    assert.equal(legacyRotated.statusCode, 201, legacyRotated.body);
    const legacyRow = await sessionRow((legacyRotated.json() as { session: { id: string } }).session.id);
    assert.equal(legacyRow.review_access_expires_at?.getTime(), deadline.getTime());

    // Ordinary customers keep the normal lifetime and no review deadline.
    const customerId = await createUser("customer");
    const customer = await issueSession(pool, base, { userId: customerId, kind: "USER" });
    const customerRotated = await refresh(disabled.app, customer.token);
    assert.equal(customerRotated.statusCode, 201, customerRotated.body);
    const customerRow = await sessionRow((customerRotated.json() as { session: { id: string } }).session.id);
    assert.equal(customerRow.review_access_expires_at, null);
    assert.ok(customerRow.expires_at.getTime() > Date.now() + 29 * 86_400_000);

    // The database rejects a review deadline shorter than the session itself.
    await assert.rejects(
      pool.query(
        `INSERT INTO sessions(user_id,session_kind,token_digest,expires_at,review_access_expires_at)
         VALUES($1,'USER',$2,now()+interval '2 days',now()+interval '1 day')`,
        [customerId, `invalid-review-${suffix}`],
      ),
      /sessions_review_access_check/,
    );
  },
);
