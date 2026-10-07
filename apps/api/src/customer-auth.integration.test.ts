import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
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
  // Four distinct phone numbers per run: a shared random base plus a fixed slot,
  // so no two fixtures can collapse onto the same zero-padded number.
  const phoneBase = randomInt(0, 25_000_000);
  const testPhone = (slot: 0 | 1 | 2 | 3) => `+8210${String(phoneBase * 4 + slot).padStart(8, "0")}`;
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
    customerLoginProviders: ["PHONE", "KAKAO", "NAVER", "GOOGLE", "APPLE"],
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
      acceptedPolicies: { terms: "2026-10-07", privacy: "2026-10-07" },
    },
    });
  };
  const webDeletionExchange = (
    accessToken: string,
    loginProvider: CustomerAuthProvider,
    appleRefreshToken?: string,
  ) => app.inject({
    method: "POST",
    url: "/v1/auth/account-deletion-exchange",
    payload: {
      accessToken,
      loginProvider,
      ...(appleRefreshToken ? { appleRefreshToken } : {}),
      acceptedPolicies: { terms: "2026-10-07", privacy: "2026-10-07" },
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
  const legacyPhone = testPhone(0);
  const legacy = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status,phone_e164) VALUES(NULL,$1,'USER','ACTIVE',$2) RETURNING id",
    ["legacy phone fixture", legacyPhone],
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

  const phoneSubject = `phone-otp-${suffix}`;
  const phoneNumber = testPhone(1);
  const phoneClaims = { ...claims(phoneSubject, ["PHONE"], null), phone: phoneNumber };
  const phoneLogin = await exchange(token("phone-otp", phoneClaims));
  assert.equal(phoneLogin.statusCode, 201, phoneLogin.body);
  const phoneUserId = (phoneLogin.json() as { actor: { userId: string } }).actor.userId;
  createdUserIds.add(phoneUserId);
  const phoneRow = await ownerPool.query<{ phone_e164: string; provider: string }>(
    `SELECT u.phone_e164,ai.provider FROM users u
       JOIN auth_identities ai ON ai.user_id=u.id
      WHERE u.id=$1 AND ai.provider='PHONE'`,
    [phoneUserId],
  );
  assert.deepEqual(phoneRow.rows, [{ phone_e164: phoneNumber, provider: "PHONE" }]);
  const phoneReauth = await webDeletionExchange(token("phone-deletion-verify", phoneClaims), "PHONE");
  assert.equal(phoneReauth.statusCode, 201, phoneReauth.body);
  assert.equal((phoneReauth.json() as { actor: { userId: string } }).actor.userId, phoneUserId);

  // User decision 2026-09-30: a verified phone OTP for a number that already
  // belongs to one account signs in to and links that account.
  const samePhoneSubject = `phone-same-${suffix}`;
  const samePhone = await exchange(token("phone-same", {
    ...claims(samePhoneSubject, ["PHONE"], null),
    phone: legacyPhone,
  }));
  assert.equal(samePhone.statusCode, 201, samePhone.body);
  assert.equal((samePhone.json() as { actor: { userId: string } }).actor.userId, legacyId);
  const samePhoneIdentity = await ownerPool.query<{ user_id: string }>(
    "SELECT user_id FROM auth_identities WHERE provider='PHONE' AND provider_subject=$1",
    [`${issuer}#${samePhoneSubject}`],
  );
  assert.deepEqual(samePhoneIdentity.rows, [{ user_id: legacyId }]);

  // A login already linked to another account is never merged with the phone's owner.
  const linkedElsewhere = await exchange(token("phone-linked-elsewhere", {
    ...claims(phoneSubject, ["PHONE"], null),
    phone: legacyPhone,
  }));
  assert.equal(linkedElsewhere.statusCode, 409, linkedElsewhere.body);
  assert.equal((linkedElsewhere.json() as { code: string }).code, "PHONE_ACCOUNT_CONFLICT");

  // A pre-broker PHONE identity stored the E.164 number as its subject. A new
  // verified phone OTP for that number signs in to the same account, links the
  // broker subject and keeps the legacy identity; account deletion finds it too.
  const e164LegacyPhone = testPhone(2);
  const e164Legacy = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status,phone_e164) VALUES(NULL,$1,'USER','ACTIVE',NULL) RETURNING id",
    ["legacy e164 phone fixture"],
  );
  const e164LegacyId = e164Legacy.rows[0]!.id;
  createdUserIds.add(e164LegacyId);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'PHONE',$2,now())",
    [e164LegacyId, e164LegacyPhone],
  );
  const recoverySubject = `phone-recovery-${suffix}`;
  const recoveryClaims = { ...claims(recoverySubject, ["PHONE"], null), phone: e164LegacyPhone };
  const legacyPhoneLogin = await exchange(token("phone-recovery", recoveryClaims));
  assert.equal(legacyPhoneLogin.statusCode, 201, legacyPhoneLogin.body);
  assert.equal((legacyPhoneLogin.json() as { actor: { userId: string } }).actor.userId, e164LegacyId);
  const recoveredIdentities = await ownerPool.query<{ provider_subject: string }>(
    "SELECT provider_subject FROM auth_identities WHERE user_id=$1 AND provider='PHONE' ORDER BY provider_subject",
    [e164LegacyId],
  );
  assert.deepEqual(
    recoveredIdentities.rows.map((row) => row.provider_subject).sort(),
    [e164LegacyPhone, `${issuer}#${recoverySubject}`].sort(),
  );
  const recoveredPhone = await ownerPool.query<{ phone_e164: string }>("SELECT phone_e164 FROM users WHERE id=$1", [e164LegacyId]);
  assert.equal(recoveredPhone.rows[0]!.phone_e164, e164LegacyPhone);
  const legacyDeletionSubject = `phone-recovery-deletion-${suffix}`;
  const legacyPhoneDeletion = await webDeletionExchange(
    token("phone-recovery-deletion", { ...claims(legacyDeletionSubject, ["PHONE"], null), phone: e164LegacyPhone }),
    "PHONE",
  );
  assert.equal(legacyPhoneDeletion.statusCode, 201, legacyPhoneDeletion.body);
  assert.equal((legacyPhoneDeletion.json() as { actor: { userId: string } }).actor.userId, e164LegacyId);

  // Two different existing owners of one number are refused, never merged.
  const splitPhone = testPhone(3);
  const splitOwners = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status,phone_e164) VALUES(NULL,'split phone a','USER','ACTIVE',$1),(NULL,'split phone b','USER','ACTIVE',NULL) RETURNING id",
    [splitPhone],
  );
  for (const row of splitOwners.rows) createdUserIds.add(row.id);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'PHONE',$2,now())",
    [splitOwners.rows[1]!.id, splitPhone],
  );
  const splitSubject = `phone-split-${suffix}`;
  const splitLogin = await exchange(token("phone-split", { ...claims(splitSubject, ["PHONE"], null), phone: splitPhone }));
  assert.equal(splitLogin.statusCode, 409, splitLogin.body);
  assert.equal((splitLogin.json() as { code: string }).code, "PHONE_ACCOUNT_CONFLICT");
  const splitIdentity = await ownerPool.query(
    "SELECT 1 FROM auth_identities WHERE provider_subject=$1",
    [`${issuer}#${splitSubject}`],
  );
  assert.equal(splitIdentity.rowCount, 0, "the refused phone exchange leaves no temporary identity");

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
  const webDeletionSession = await ownerPool.query<{ expires_at: Date; scope: string }>(
    "SELECT expires_at,scope FROM sessions WHERE id=$1 AND user_id=$2",
    [socialDeletionBody.actor.sessionId, socialOnlyUserId],
  );
  assert.equal(webDeletionSession.rowCount, 1);
  assert.equal(webDeletionSession.rows[0]!.scope, "ACCOUNT_DELETION");
  const ordinarySession = await ownerPool.query<{ scope: string }>(
    "SELECT scope FROM sessions WHERE id=$1",
    [(socialOnlyLogin.json() as { actor: { sessionId: string } }).actor.sessionId],
  );
  assert.equal(ordinarySession.rows[0]!.scope, "FULL");
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

  // Disabling a provider closes it for new deletion re-authentication, but an
  // identity that is already linked keeps a path to delete its account.
  const enabledProviders = config.customerLoginProviders!;
  config.customerLoginProviders = ["PHONE", "NAVER", "GOOGLE", "APPLE"];
  try {
    const disabledUnknown = await webDeletionExchange(
      token("web-deletion-disabled-unknown", claims(`disabled-unknown-${suffix}`, ["KAKAO"], null)),
      "KAKAO",
    );
    assert.equal(disabledUnknown.statusCode, 503, disabledUnknown.body);
    assert.equal((disabledUnknown.json() as { code: string }).code, "CUSTOMER_LOGIN_PROVIDER_UNAVAILABLE");
    const disabledLogin = await exchange(token("web-deletion-disabled-login", socialOnlyClaims));
    assert.equal(disabledLogin.statusCode, 503, disabledLogin.body);
    const disabledLegacy = await webDeletionExchange(
      token("web-deletion-disabled-legacy", socialOnlyClaims),
      "KAKAO",
    );
    assert.equal(disabledLegacy.statusCode, 201, disabledLegacy.body);
    assert.equal((disabledLegacy.json() as { actor: { userId: string } }).actor.userId, socialOnlyUserId);
  } finally {
    config.customerLoginProviders = enabledProviders;
  }

  // A customer whose only identity is a legacy verified EMAIL link can still
  // prove ownership to delete the account, but EMAIL never becomes a login.
  const emailOnlySubject = `legacy-email-${suffix}`;
  const emailOnlyUser = await ownerPool.query<{ id: string }>(
    "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
    [`legacy-email-${suffix}@example.test`, "legacy email fixture"],
  );
  const emailOnlyUserId = emailOnlyUser.rows[0]!.id;
  createdUserIds.add(emailOnlyUserId);
  await ownerPool.query(
    "INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'EMAIL',$2,now())",
    [emailOnlyUserId, `${issuer}#${emailOnlySubject}`],
  );
  const emailOnlyClaims = claims(emailOnlySubject, ["EMAIL"], `legacy-email-${suffix}@example.test`);
  const emailLogin = await exchange(token("legacy-email-login", emailOnlyClaims));
  assert.equal(emailLogin.statusCode, 400, emailLogin.body);
  const emailDeletion = await webDeletionExchange(token("legacy-email-deletion", emailOnlyClaims), "EMAIL");
  assert.equal(emailDeletion.statusCode, 201, emailDeletion.body);
  const emailDeletionBody = emailDeletion.json() as { actor: { userId: string; sessionId: string } };
  assert.equal(emailDeletionBody.actor.userId, emailOnlyUserId);
  const emailDeletionSession = await ownerPool.query<{ scope: string }>(
    "SELECT scope FROM sessions WHERE id=$1",
    [emailDeletionBody.actor.sessionId],
  );
  assert.equal(emailDeletionSession.rows[0]!.scope, "ACCOUNT_DELETION");
  const unknownEmailDeletion = await webDeletionExchange(
    token("unknown-email-deletion", claims(`unknown-email-${suffix}`, ["EMAIL"], `unknown-email-${suffix}@example.test`)),
    "EMAIL",
  );
  assert.equal(unknownEmailDeletion.statusCode, 503, unknownEmailDeletion.body);
  const unknownEmailLocal = await ownerPool.query(
    "SELECT 1 FROM auth_identities WHERE provider_subject=$1",
    [`${issuer}#unknown-email-${suffix}`],
  );
  assert.equal(unknownEmailLocal.rowCount, 0);

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
