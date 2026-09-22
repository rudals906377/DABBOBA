import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { assertDatabaseUrlForTier, type ApiConfig } from "@dabboba/config";
import { createDatabasePool, createMigrationDatabasePool } from "@dabboba/db";
import type { CustomerAuthProvider, VerifiedSupabaseCustomer } from "./lib/supabase-auth.js";
import { registerCustomerAuthRoutes } from "./modules/customer-auth.js";
import type { ApiContext } from "./types.js";

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeDatabaseUrl = process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL;

test("customer broker reuses one Supabase subject without merging email peers and preserves legacy phone data", {
  skip: !migrationDatabaseUrl || !runtimeDatabaseUrl,
  timeout: 60_000,
}, async (t) => {
  assertDatabaseUrlForTier(migrationDatabaseUrl!, "DATABASE_MIGRATION_URL", "TEST");
  assertDatabaseUrlForTier(runtimeDatabaseUrl!, "DABBOBA_RUNTIME_TEST_DATABASE_URL", "TEST");
  const ownerPool = createMigrationDatabasePool(migrationDatabaseUrl!, "customer-auth-fixtures");
  const runtimePool = createDatabasePool(runtimeDatabaseUrl!, "customer-auth-runtime", { runtimeEnvironment: "test" });
  const suffix = randomUUID();
  const createdUserIds = new Set<string>();
  const config: ApiConfig = {
    environment: "test",
    surface: "customer",
    host: "127.0.0.1",
    port: 8788,
    databaseUrl: runtimeDatabaseUrl!,
    redisUrl: null,
    webOrigins: ["http://127.0.0.1:4174"],
    adminOrigins: [],
    sessionTokenPepper: `customer-auth-${suffix}`,
    adminProxyIdentitySecret: null,
    supabaseUrl: "https://project.supabase.co",
    supabaseJwtAudience: "authenticated",
    supabasePublishableKey: "sb_publishable_customer_auth_fixture",
    appleCredentialEncryption: {
      key: Buffer.alloc(32, 6).toString("base64url"),
      keyVersion: 1,
    },
    sessionTtlDays: 1,
    paymentProvider: "UNCONFIGURED",
    paymentWebhookSecret: null,
    gcsBucket: null,
    gcsProjectId: null,
    logLevel: "silent",
  };
  const app = Fastify({ logger: false });
  const tokenClaims = new Map<string, VerifiedSupabaseCustomer>();
  await registerCustomerAuthRoutes(app, {
    config,
    pool: runtimePool,
    redis: null,
    mediaRuntime: null as never,
    auth: null as never,
  } satisfies ApiContext, {
    verifyAccessToken: async (token) => {
      const claims = tokenClaims.get(token);
      if (!claims) throw new Error("unexpected integration token");
      return claims;
    },
  });
  await app.ready();

  t.after(async () => {
    try {
      await app.close();
      if (createdUserIds.size) {
        const ids = [...createdUserIds];
        const cleanup = await ownerPool.connect();
        try {
          await cleanup.query("BEGIN");
          // This integration test is restricted to a loopback TEST database.
          // Temporarily bypass immutable audit triggers only inside this rollback-safe
          // transaction so the exact synthetic user graph does not persist.
          await cleanup.query("SET LOCAL session_replication_role = replica");
          await cleanup.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM apple_auth_credentials WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM auth_identities WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM user_policy_acceptance_events WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM user_policy_acceptances WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM account_deletion_requests WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM notification_preference_events WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM notification_preferences WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM point_accounts WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM user_profiles WHERE user_id=ANY($1::uuid[])", [ids]);
          await cleanup.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
          await cleanup.query("COMMIT");
        } catch (error) {
          await cleanup.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          cleanup.release();
        }
      }
    } finally {
      await Promise.allSettled([runtimePool.end(), ownerPool.end()]);
    }
  });

  const issuer = "https://project.supabase.co/auth/v1";
  const claims = (subject: string, providers: CustomerAuthProvider[], email: string | null): VerifiedSupabaseCustomer => ({
    issuer,
    subject,
    canonicalSubject: `${issuer}#${subject}`,
    providers,
    email,
  });
  const token = (label: string, value: VerifiedSupabaseCustomer) => {
    const accessToken = `${label}-${"x".repeat(80)}`;
    tokenClaims.set(accessToken, value);
    return accessToken;
  };
  const exchange = (accessToken: string) => {
    const verified = tokenClaims.get(accessToken)!;
    const loginProvider = verified.providers[0]!;
    return app.inject({
    method: "POST",
    url: "/v1/auth/exchange",
    payload: {
      accessToken,
      loginProvider,
      ...(loginProvider === "APPLE" ? { appleRefreshToken: `apple-refresh-${"x".repeat(64)}` } : {}),
      acceptedPolicies: { terms: "2026-09-22", privacy: "2026-09-22" },
    },
    });
  };
  const webDeletionExchange = (
    accessToken: string,
    loginProvider: Exclude<CustomerAuthProvider, "EMAIL">,
    appleRefreshToken?: string,
  ) => app.inject({
    method: "POST",
    url: "/v1/auth/account-deletion-exchange",
    payload: {
      accessToken,
      loginProvider,
      ...(appleRefreshToken ? { appleRefreshToken } : {}),
      acceptedPolicies: { terms: "2026-09-22", privacy: "2026-09-22" },
    },
  });

  const sharedSubject = `same-subject-${suffix}`;
  const sharedClaims = claims(sharedSubject, ["KAKAO", "GOOGLE", "EMAIL"], `same-${suffix}@example.test`);
  const concurrent = await Promise.all([
    exchange(token("same-a", sharedClaims)),
    exchange(token("same-b", sharedClaims)),
  ]);
  assert.deepEqual(
    concurrent.map((response) => response.statusCode),
    [201, 201],
    concurrent.map((response) => response.body).join("\n"),
  );
  const sharedIds = concurrent.map((response) => (response.json() as { actor: { userId: string } }).actor.userId);
  assert.equal(sharedIds[0], sharedIds[1]);
  createdUserIds.add(sharedIds[0]!);
  const sharedProviders = await ownerPool.query<{ provider: string }>(
    "SELECT provider FROM auth_identities WHERE user_id=$1 ORDER BY provider",
    [sharedIds[0]],
  );
  assert.deepEqual(sharedProviders.rows.map((row) => row.provider), ["EMAIL", "GOOGLE", "KAKAO"]);

  const growingSubject = `growing-subject-${suffix}`;
  const initialGrowing = await exchange(token("growing-initial", claims(growingSubject, ["KAKAO"], null)));
  assert.equal(initialGrowing.statusCode, 201, initialGrowing.body);
  const growingUserId = (initialGrowing.json() as { actor: { userId: string } }).actor.userId;
  createdUserIds.add(growingUserId);
  await ownerPool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,1250)", [growingUserId]);
  const linkedGrowing = await exchange(token(
    "growing-linked",
    claims(growingSubject, ["KAKAO", "GOOGLE", "EMAIL"], `growing-${suffix}@example.test`),
  ));
  assert.equal(linkedGrowing.statusCode, 201, linkedGrowing.body);
  assert.equal((linkedGrowing.json() as { actor: { userId: string } }).actor.userId, growingUserId);
  const growingState = await ownerPool.query<{ balance: number; providers: string[] }>(
    `SELECT pa.balance,
            ARRAY(SELECT ai.provider FROM auth_identities ai WHERE ai.user_id=u.id ORDER BY ai.provider) AS providers
       FROM users u JOIN point_accounts pa ON pa.user_id=u.id WHERE u.id=$1`,
    [growingUserId],
  );
  assert.deepEqual(growingState.rows[0], { balance: 1250, providers: ["EMAIL", "GOOGLE", "KAKAO"] });

  const duplicateEmail = `separate-${suffix}@example.test`;
  const firstSeparate = await exchange(token("separate-a", claims(`separate-a-${suffix}`, ["NAVER"], duplicateEmail)));
  const secondSeparate = await exchange(token("separate-b", claims(`separate-b-${suffix}`, ["APPLE"], duplicateEmail)));
  assert.equal(firstSeparate.statusCode, 201, firstSeparate.body);
  assert.equal(secondSeparate.statusCode, 201, secondSeparate.body);
  const firstSeparateId = (firstSeparate.json() as { actor: { userId: string } }).actor.userId;
  const secondSeparateId = (secondSeparate.json() as { actor: { userId: string } }).actor.userId;
  createdUserIds.add(firstSeparateId);
  createdUserIds.add(secondSeparateId);
  assert.notEqual(firstSeparateId, secondSeparateId);

  const legacySubject = `legacy-phone-${suffix}`;
  const legacy = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status,phone_e164) VALUES(NULL,$1,'USER','ACTIVE',$2) RETURNING id",
    ["legacy phone fixture", `+8210${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`],
  );
  const legacyId = legacy.rows[0]!.id;
  createdUserIds.add(legacyId);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'PHONE',$2,now())",
    [legacyId, `${issuer}#${legacySubject}`],
  );
  const legacyExchange = await exchange(token("legacy", claims(legacySubject, ["APPLE"], null)));
  assert.equal(legacyExchange.statusCode, 201, legacyExchange.body);
  assert.equal((legacyExchange.json() as { actor: { userId: string } }).actor.userId, legacyId);
  const legacyProviders = await ownerPool.query<{ provider: string }>(
    "SELECT provider FROM auth_identities WHERE user_id=$1 ORDER BY provider",
    [legacyId],
  );
  assert.deepEqual(legacyProviders.rows.map((row) => row.provider), ["APPLE", "PHONE"]);

  const socialOnlySubject = `web-deletion-social-${suffix}`;
  const socialOnlyClaims = claims(socialOnlySubject, ["KAKAO"], null);
  const socialOnlyLogin = await exchange(token("web-deletion-social-login", socialOnlyClaims));
  assert.equal(socialOnlyLogin.statusCode, 201, socialOnlyLogin.body);
  const socialOnlyUserId = (socialOnlyLogin.json() as { actor: { userId: string } }).actor.userId;
  createdUserIds.add(socialOnlyUserId);
  const socialDeletion = await webDeletionExchange(
    token("web-deletion-social-verify", socialOnlyClaims),
    "KAKAO",
  );
  assert.equal(socialDeletion.statusCode, 201, socialDeletion.body);
  const socialDeletionBody = socialDeletion.json() as {
    expiresAt: string;
    actor: { userId: string; sessionId: string };
  };
  assert.equal(socialDeletionBody.actor.userId, socialOnlyUserId);
  const webDeletionSession = await ownerPool.query<{ expires_at: Date }>(
    "SELECT expires_at FROM sessions WHERE id=$1 AND user_id=$2",
    [socialDeletionBody.actor.sessionId, socialOnlyUserId],
  );
  assert.equal(webDeletionSession.rowCount, 1);
  const remainingMs = webDeletionSession.rows[0]!.expires_at.getTime() - Date.now();
  assert.ok(remainingMs > 14 * 60_000 && remainingMs <= 15 * 60_000);
  assert.equal(
    new Date(socialDeletionBody.expiresAt).getTime(),
    webDeletionSession.rows[0]!.expires_at.getTime(),
  );

  const unknownDeletion = await webDeletionExchange(
    token("web-deletion-unknown", claims(`unknown-${suffix}`, ["GOOGLE"], null)),
    "GOOGLE",
  );
  assert.equal(unknownDeletion.statusCode, 401, unknownDeletion.body);
  const unknownLocal = await ownerPool.query(
    "SELECT 1 FROM auth_identities WHERE provider_subject=$1",
    [`${issuer}#unknown-${suffix}`],
  );
  assert.equal(unknownLocal.rowCount, 0);

  const appleDeletion = await webDeletionExchange(
    token("web-deletion-apple", claims(legacySubject, ["APPLE"], null)),
    "APPLE",
  );
  assert.equal(appleDeletion.statusCode, 201, appleDeletion.body);
  assert.equal((appleDeletion.json() as { actor: { userId: string } }).actor.userId, legacyId);

  const adminSubject = `admin-${suffix}`;
  const admin = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'ADMIN','ACTIVE') RETURNING id",
    [`admin-${suffix}@example.test`, "admin fixture"],
  );
  const adminId = admin.rows[0]!.id;
  createdUserIds.add(adminId);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'GOOGLE',$2,now())",
    [adminId, `${issuer}#${adminSubject}`],
  );
  const adminExchange = await exchange(token("admin", claims(adminSubject, ["GOOGLE"], `admin-${suffix}@example.test`)));
  assert.equal(adminExchange.statusCode, 403, adminExchange.body);
  const adminSessions = await ownerPool.query("SELECT 1 FROM sessions WHERE user_id=$1", [adminId]);
  assert.equal(adminSessions.rowCount, 0);

  for (const [label, status] of [
    ["suspended", "SUSPENDED"],
    ["banned", "BANNED"],
    ["deleted", "DELETED"],
  ] as const) {
    const subject = `${label}-${suffix}`;
    const blocked = await ownerPool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status,deleted_at)
       VALUES($1,$2,'USER',$3,CASE WHEN $3='DELETED' THEN now() ELSE NULL END)
       RETURNING id`,
      [`${label}-${suffix}@example.test`, `${label} fixture`, status],
    );
    const blockedId = blocked.rows[0]!.id;
    createdUserIds.add(blockedId);
    await ownerPool.query(
      "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'KAKAO',$2,now())",
      [blockedId, `${issuer}#${subject}`],
    );
    const response = await exchange(token(label, claims(subject, ["KAKAO"], `${label}-${suffix}@example.test`)));
    assert.equal(response.statusCode, 403, response.body);
  }

  const deletionSubject = `approved-deletion-${suffix}`;
  const deletionUser = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
    [`approved-deletion-${suffix}@example.test`, "approved deletion fixture"],
  );
  const deletionUserId = deletionUser.rows[0]!.id;
  createdUserIds.add(deletionUserId);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'NAVER',$2,now())",
    [deletionUserId, `${issuer}#${deletionSubject}`],
  );
  await ownerPool.query(
    `INSERT INTO account_deletion_requests(
       user_id,status,decided_at,decided_by_admin_id,decision_reason
     ) VALUES($1,'APPROVED',now(),$2,'customer auth blocked-account fixture')`,
    [deletionUserId, adminId],
  );
  const deletionExchange = await exchange(token(
    "approved-deletion",
    claims(deletionSubject, ["NAVER"], `approved-deletion-${suffix}@example.test`),
  ));
  assert.equal(deletionExchange.statusCode, 403, deletionExchange.body);
});
