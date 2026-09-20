import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { ADMIN_PROXY_IDENTITY_HEADERS, signAdminProxyIdentity, type ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "./app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "./integration-test-fixtures.js";
import { hashPassword } from "./lib/password.js";
import { tokenDigest } from "./plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "admin login lockout and signed proxy identity preserve client-scoped security controls",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-auth-integration");
    const proxyIdentitySecret = "auth-integration-admin-proxy-identity-secret";
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "auth-integration-session-pepper-value",
      adminProxyIdentitySecret: proxyIdentitySecret,
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

    const suffix = randomUUID();
    const email = `lockout-${suffix}@example.test`;
    const password = `Admin-Lockout-${suffix}`;
    const credential = await hashPassword(password);
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status)
       VALUES($1,'잠금 통합 테스트','ADMIN','ACTIVE') RETURNING id`,
      [email],
    );
    const userId = user.rows[0]!.id;
    await pool.query(
      `INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at)
       VALUES($1,'LOCAL_ADMIN',$2,now())`,
      [userId, email],
    );
    await pool.query(
      `INSERT INTO admin_credentials
        (user_id,password_hash,password_salt,scrypt_cost,scrypt_block_size,scrypt_parallelization)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        userId,
        credential.hash,
        credential.salt,
        credential.cost,
        credential.blockSize,
        credential.parallelization,
      ],
    );

    const failures = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email, password: `${password}-wrong` },
      })),
    );
    assert.deepEqual(failures.map((response) => response.statusCode), [401, 401, 401, 401, 401]);

    const lockedCredential = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      "SELECT failed_attempts, locked_until FROM admin_credentials WHERE user_id = $1",
      [userId],
    );
    assert.equal(lockedCredential.rows[0]!.failed_attempts, 5);
    assert.ok(lockedCredential.rows[0]!.locked_until);
    assert.ok(lockedCredential.rows[0]!.locked_until!.getTime() > Date.now());

    const rejectedWhileLocked = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email, password },
    });
    assert.equal(rejectedWhileLocked.statusCode, 401, rejectedWhileLocked.body);

    await pool.query(
      "UPDATE admin_credentials SET locked_until = now() - interval '1 second' WHERE user_id = $1",
      [userId],
    );
    const signedClientHeaders = signAdminProxyIdentity({
      secret: proxyIdentitySecret,
      ipAddress: "2001:0DB8:0:0:0:0:0:7",
      userAgent: "Dabboba Signed Admin/1.0",
    });
    const firstFailureAfterExpiry = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: signedClientHeaders,
      payload: { email, password: `${password}-wrong` },
    });
    assert.equal(firstFailureAfterExpiry.statusCode, 401, firstFailureAfterExpiry.body);

    const freshWindow = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      "SELECT failed_attempts, locked_until FROM admin_credentials WHERE user_id = $1",
      [userId],
    );
    assert.equal(freshWindow.rows[0]!.failed_attempts, 1);
    assert.equal(freshWindow.rows[0]!.locked_until, null);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: signedClientHeaders,
        payload: { email, password: `${password}-wrong` },
      });
      assert.equal(response.statusCode, 401, response.body);
    }
    const relockedCredential = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      "SELECT failed_attempts, locked_until FROM admin_credentials WHERE user_id = $1",
      [userId],
    );
    assert.equal(relockedCredential.rows[0]!.failed_attempts, 5);
    assert.ok(relockedCredential.rows[0]!.locked_until);
    assert.ok(relockedCredential.rows[0]!.locked_until!.getTime() > Date.now());

    await pool.query(
      "UPDATE admin_credentials SET locked_until = now() - interval '1 second' WHERE user_id = $1",
      [userId],
    );
    const successfulAfterExpiry = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: signedClientHeaders,
      payload: { email, password },
    });
    assert.equal(successfulAfterExpiry.statusCode, 201, successfulAfterExpiry.body);

    const resetCredential = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      "SELECT failed_attempts, locked_until FROM admin_credentials WHERE user_id = $1",
      [userId],
    );
    assert.equal(resetCredential.rows[0]!.failed_attempts, 0);
    assert.equal(resetCredential.rows[0]!.locked_until, null);

    const loginEvents = await pool.query<{ succeeded: boolean; failure_code: string | null; ip_address: string | null; user_agent: string | null }>(
      `SELECT succeeded, failure_code, host(ip_address) AS ip_address, user_agent
       FROM admin_login_events
       WHERE user_id = $1
       ORDER BY created_at, id`,
      [userId],
    );
    assert.equal(loginEvents.rows.length, 12);
    assert.deepEqual(
      loginEvents.rows.map((event) => event.succeeded),
      [false, false, false, false, false, false, false, false, false, false, false, true],
    );
    assert.equal(loginEvents.rows[5]!.failure_code, "LOCKED");
    assert.equal(loginEvents.rows[11]!.ip_address, "2001:db8::7");
    assert.equal(loginEvents.rows[11]!.user_agent, "Dabboba Signed Admin/1.0");

    const issuedSession = await pool.query<{ ip_address: string | null; user_agent: string | null }>(
      `SELECT host(ip_address) AS ip_address, user_agent FROM sessions
       WHERE user_id = $1 AND session_kind = 'ADMIN'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    assert.equal(issuedSession.rows[0]!.ip_address, "2001:db8::7");
    assert.equal(issuedSession.rows[0]!.user_agent, "Dabboba Signed Admin/1.0");

    const spoofedEmail = `xff-spoof-${suffix}@example.test`;
    const arbitraryForwardedFor = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: { "x-forwarded-for": "198.51.100.44", "user-agent": "Direct Test Agent" },
      payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
    });
    assert.equal(arbitraryForwardedFor.statusCode, 401, arbitraryForwardedFor.body);
    const spoofedEmailHash = createHmac("sha256", config.sessionTokenPepper).update(spoofedEmail).digest("hex");
    const directEvent = await pool.query<{ ip_address: string | null }>(
      `SELECT host(ip_address) AS ip_address FROM admin_login_events
       WHERE attempted_email_hash = $1
       ORDER BY created_at DESC LIMIT 1`,
      [spoofedEmailHash],
    );
    assert.notEqual(directEvent.rows[0]!.ip_address, "198.51.100.44");

    // Production defaults to the customer-only Cloud Run surface. This branch
    // exercises production admin identity controls, so opt into the separately
    // deployed admin surface explicitly.
    const productionConfig: ApiConfig = { ...config, environment: "production", surface: "admin" };
    const { app: productionApp } = await buildApp({ config: productionConfig, pool, redis: null });
    t.after(async () => productionApp.close());

    const disabledDevSession = await productionApp.inject({
      method: "POST",
      url: "/v1/auth/dev-session",
      payload: { email: `disabled-dev-${suffix}@example.test` },
    });
    assert.equal(disabledDevSession.statusCode, 404, disabledDevSession.body);

    const unsigned = await productionApp.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
    });
    assert.equal(unsigned.statusCode, 401, unsigned.body);

    const invalidHeaders = signAdminProxyIdentity({
      secret: proxyIdentitySecret,
      ipAddress: "203.0.113.10",
      userAgent: "Tampered Admin Client",
    });
    invalidHeaders[ADMIN_PROXY_IDENTITY_HEADERS.signature] = `${invalidHeaders[ADMIN_PROXY_IDENTITY_HEADERS.signature]}x`;
    const invalidSignature = await productionApp.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: invalidHeaders,
      payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
    });
    assert.equal(invalidSignature.statusCode, 401, invalidSignature.body);

    const limitedClientHeaders = signAdminProxyIdentity({
      secret: proxyIdentitySecret,
      ipAddress: "203.0.113.20",
      userAgent: "Rate Limited Admin Client",
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await productionApp.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: limitedClientHeaders,
        payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
      });
      assert.equal(response.statusCode, 401, response.body);
    }
    const limited = await productionApp.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: limitedClientHeaders,
      payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
    });
    assert.equal(limited.statusCode, 429, limited.body);

    const independentClient = await productionApp.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: signAdminProxyIdentity({
        secret: proxyIdentitySecret,
        ipAddress: "203.0.113.21",
        userAgent: "Independent Admin Client",
      }),
      payload: { email: spoofedEmail, password: "Nonexistent-Admin-Password" },
    });
    assert.equal(independentClient.statusCode, 401, independentClient.body);
  },
);

test(
  "customer session rotation, logout, and durable deletion requests fail closed",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-customer-lifecycle-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "customer-lifecycle-session-pepper-value",
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
    const createDevSession = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as { token: string; actor: { userId: string; sessionId: string } };
    };
    const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
    const customerEmail = `customer-lifecycle-${suffix}@example.test`;

    const unauthenticatedMe = await app.inject({ method: "GET", url: "/v1/auth/me" });
    assert.equal(unauthenticatedMe.statusCode, 401, unauthenticatedMe.body);

    const adminToken = `customer-lifecycle-admin-${randomUUID()}`;
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status)
       VALUES($1,'고객 생명주기 권한 테스트','ADMIN','ACTIVE') RETURNING id`,
      [`customer-lifecycle-admin-${suffix}@example.test`],
    );
    await pool.query(
      `INSERT INTO sessions(user_id,session_kind,token_digest,expires_at)
       VALUES($1,'ADMIN',$2,now()+interval '1 day')`,
      [admin.rows[0]!.id, tokenDigest(adminToken, config.sessionTokenPepper)],
    );
    const adminRejected = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(adminToken),
    });
    assert.equal(adminRejected.statusCode, 403, adminRejected.body);

    const first = await createDevSession(customerEmail);
    const second = await createDevSession(customerEmail);
    assert.equal(first.actor.userId, second.actor.userId);
    await acceptRequiredPoliciesForIntegrationTest(pool, first.actor.userId);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(first.token),
    });
    assert.equal(me.statusCode, 200, me.body);
    const meBody = me.json() as {
      actor: { userId: string };
      session: { id: string; kind: string; createdAt: string; lastSeenAt: string; expiresAt: string };
    };
    assert.equal(meBody.actor.userId, first.actor.userId);
    assert.equal(meBody.session.id, first.actor.sessionId);
    assert.equal(meBody.session.kind, "USER");
    assert.ok(Number.isFinite(Date.parse(meBody.session.createdAt)));
    assert.ok(Number.isFinite(Date.parse(meBody.session.lastSeenAt)));
    assert.ok(Date.parse(meBody.session.expiresAt) > Date.now());

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { ...authorization(first.token), "user-agent": "Dabboba Customer Integration/1.0" },
    });
    assert.equal(refreshed.statusCode, 201, refreshed.body);
    const refreshedBody = refreshed.json() as {
      token: string;
      rotatedFromSessionId: string;
      session: { id: string };
    };
    assert.notEqual(refreshedBody.token, first.token);
    assert.ok(refreshedBody.token.length >= 32);
    assert.equal(refreshedBody.rotatedFromSessionId, first.actor.sessionId);

    const oldRejected = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(first.token),
    });
    assert.equal(oldRejected.statusCode, 401, oldRejected.body);
    const refreshedAccepted = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(refreshedAccepted.statusCode, 200, refreshedAccepted.body);
    const rotation = await pool.query<{ revoke_reason: string; rotated_from_session_id: string }>(
      `SELECT predecessor.revoke_reason,successor.rotated_from_session_id
       FROM sessions predecessor JOIN sessions successor ON successor.rotated_from_session_id=predecessor.id
       WHERE predecessor.id=$1 AND successor.id=$2`,
      [first.actor.sessionId, refreshedBody.session.id],
    );
    assert.deepEqual(rotation.rows[0], {
      revoke_reason: "ROTATED",
      rotated_from_session_id: first.actor.sessionId,
    });

    const loggedOutOthers = await app.inject({
      method: "POST",
      url: "/v1/auth/logout-others",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(loggedOutOthers.statusCode, 204, loggedOutOthers.body);
    const otherSessionRejected = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(second.token),
    });
    assert.equal(otherSessionRejected.statusCode, 401, otherSessionRejected.body);
    const currentSessionPreserved = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(currentSessionPreserved.statusCode, 200, currentSessionPreserved.body);

    const repeatedLogoutOthers = await app.inject({
      method: "POST",
      url: "/v1/auth/logout-others",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(repeatedLogoutOthers.statusCode, 204, repeatedLogoutOthers.body);

    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(loggedOut.statusCode, 204, loggedOut.body);
    const loggedOutRejected = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(refreshedBody.token),
    });
    assert.equal(loggedOutRejected.statusCode, 401, loggedOutRejected.body);
    const race = await createDevSession(customerEmail);
    const raceResults = await Promise.all([
      app.inject({ method: "POST", url: "/v1/auth/refresh", headers: authorization(race.token) }),
      app.inject({ method: "POST", url: "/v1/auth/refresh", headers: authorization(race.token) }),
    ]);
    assert.deepEqual(raceResults.map((response) => response.statusCode).sort(), [201, 401]);
    const raceSuccess = raceResults.find((response) => response.statusCode === 201)!;
    const raceToken = (raceSuccess.json() as { token: string }).token;

    const noRequestYet = await app.inject({
      method: "GET",
      url: "/v1/account/deletion-request",
      headers: authorization(raceToken),
    });
    assert.equal(noRequestYet.statusCode, 404, noRequestYet.body);

    const ipId = `lifecycle-ip-${suffix}`;
    const productId = `lifecycle-product-${suffix}`;
    await pool.query(
      "INSERT INTO catalog_ips(id,slug,name_ko,name_en) VALUES($1,$2,$3,$4)",
      [ipId, ipId, `계정 생명주기 ${suffix}`, `Lifecycle ${suffix}`],
    );
    await pool.query(
      `INSERT INTO catalog_products(id,sku,ip_id,category,name,price)
       VALUES($1,$2,$3,'figure',$4,10000)`,
      [productId, `LIFECYCLE-${suffix.toUpperCase()}`, ipId, `계정 생명주기 상품 ${suffix}`],
    );
    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,1250)", [first.actor.userId]);
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders(user_id,status,subtotal,total)
       VALUES($1,'PENDING_PAYMENT',10000,10000) RETURNING id`,
      [first.actor.userId],
    );
    await pool.query(
      `INSERT INTO payments(order_id,provider,status,amount)
       VALUES($1,'TEST_PG','PENDING',10000)`,
      [order.rows[0]!.id],
    );
    const inventory = await pool.query<{ id: string }>(
      `INSERT INTO inventory_units(owner_id,product_id,source_type,status)
       VALUES($1,$2,'ADMIN_ADJUSTMENT','EXCHANGE_LISTED') RETURNING id`,
      [first.actor.userId, productId],
    );
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO exchange_listings(author_id,offered_inventory_unit_id,title,details)
       VALUES($1,$2,'탈퇴 차단 교환','진행 중 교환은 먼저 정리해야 합니다.') RETURNING id`,
      [first.actor.userId, inventory.rows[0]!.id],
    );

    const missingIdempotencyKey = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: authorization(raceToken),
      payload: {},
    });
    assert.equal(missingIdempotencyKey.statusCode, 409, missingIdempotencyKey.body);
    const unsupportedDeletionInput = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: { ...authorization(raceToken), "idempotency-key": `delete-invalid-${randomUUID()}` },
      payload: { hardDelete: true },
    });
    assert.equal(unsupportedDeletionInput.statusCode, 400, unsupportedDeletionInput.body);
    const stillActiveAfterRejectedRequests = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(raceToken),
    });
    assert.equal(stillActiveAfterRejectedRequests.statusCode, 200, stillActiveAfterRejectedRequests.body);

    const deletionKey = `delete-${randomUUID()}`;
    const deletion = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: { ...authorization(raceToken), "idempotency-key": deletionKey },
      payload: {},
    });
    assert.equal(deletion.statusCode, 202, deletion.body);
    const deletionBody = deletion.json() as {
      id: string;
      status: string;
      blockers: Record<string, number>;
      requestCount: number;
      hardDeletePerformed: boolean;
      policy: string;
    };
    assert.equal(deletionBody.status, "BLOCKED");
    assert.equal(deletionBody.blockers.pointBalance, 1250);
    assert.equal(deletionBody.blockers.activeOrderCount, 1);
    assert.equal(deletionBody.blockers.activePaymentCount, 1);
    assert.equal(deletionBody.blockers.activeInventoryCount, 1);
    assert.equal(deletionBody.blockers.activeExchangeListingCount, 1);
    assert.equal(deletionBody.requestCount, 1);
    assert.equal(deletionBody.hardDeletePerformed, false);
    assert.equal(deletionBody.policy, "AUTOMATED_SERVER_DELETION");

    const previouslyLoggedOut = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(second.token),
    });
    assert.equal(previouslyLoggedOut.statusCode, 401, previouslyLoggedOut.body);
    const blockedRequestSession = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(raceToken),
    });
    assert.equal(blockedRequestSession.statusCode, 200, blockedRequestSession.body);
    const firstEvent = await pool.query<{
      revoked_session_count: number;
      event_type: string;
      status: string;
    }>(
      `SELECT revoked_session_count,event_type,status
       FROM account_deletion_request_events WHERE deletion_request_id=$1`,
      [deletionBody.id],
    );
    assert.deepEqual(firstEvent.rows, [{ revoked_session_count: 0, event_type: "CREATED", status: "BLOCKED" }]);

    const replaySession = await createDevSession(customerEmail);
    const visibleRequest = await app.inject({
      method: "GET",
      url: "/v1/account/deletion-request",
      headers: authorization(replaySession.token),
    });
    assert.equal(visibleRequest.statusCode, 200, visibleRequest.body);
    assert.equal((visibleRequest.json() as { id: string }).id, deletionBody.id);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: { ...authorization(replaySession.token), "idempotency-key": deletionKey },
      payload: {},
    });
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(replay.json(), deletionBody);
    const replaySessionPreserved = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: authorization(replaySession.token),
    });
    assert.equal(replaySessionPreserved.statusCode, 200, replaySessionPreserved.body);

    await pool.query("UPDATE point_accounts SET balance=0 WHERE user_id=$1", [first.actor.userId]);
    await pool.query(
      "UPDATE payments SET status='CANCELLED' WHERE order_id=$1",
      [order.rows[0]!.id],
    );
    await pool.query(
      "UPDATE orders SET status='CANCELLED',cancelled_at=now() WHERE id=$1",
      [order.rows[0]!.id],
    );
    await pool.query(
      `UPDATE exchange_listings
       SET status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancel_reason='계정 탈퇴 요청 전 사용자 정리'
       WHERE id=$1`,
      [listing.rows[0]!.id, first.actor.userId],
    );
    await pool.query("UPDATE inventory_units SET status='REFUNDED' WHERE id=$1", [inventory.rows[0]!.id]);

    const reassessmentSession = await createDevSession(customerEmail);
    const reassessed = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: {
        ...authorization(reassessmentSession.token),
        "idempotency-key": `delete-reassess-${randomUUID()}`,
      },
      payload: {},
    });
    assert.equal(reassessed.statusCode, 202, reassessed.body);
    const reassessedBody = reassessed.json() as { id: string; status: string; requestCount: number };
    assert.equal(reassessedBody.id, deletionBody.id);
    assert.equal(reassessedBody.status, "PROCESSING");
    assert.equal(reassessedBody.requestCount, 2);

    const durableState = await pool.query<{
      status: string;
      request_count: number;
      user_status: string;
      event_count: string;
    }>(
      `SELECT d.status,d.request_count,u.status AS user_status,
        (SELECT count(*) FROM account_deletion_request_events e WHERE e.deletion_request_id=d.id) AS event_count
       FROM account_deletion_requests d JOIN users u ON u.id=d.user_id
       WHERE d.id=$1`,
      [deletionBody.id],
    );
    assert.deepEqual(durableState.rows[0], {
      status: "PROCESSING",
      request_count: 2,
      user_status: "ACTIVE",
      event_count: "2",
    });
    await assert.rejects(
      pool.query(
        "UPDATE account_deletion_request_events SET metadata='{}'::jsonb WHERE deletion_request_id=$1",
        [deletionBody.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "55000",
    );
  },
);
