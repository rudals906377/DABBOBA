import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import type { UserRole, UserStatus } from "@dabboba/domain";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "../lib/errors.js";
import { enumInput, objectInput, stringInput } from "../lib/input.js";
import { sealAppleRefreshToken, validateAppleRefreshToken } from "../lib/apple-credential.js";
import {
  FALLBACK_REQUIRED_POLICY_VERSIONS,
  loadRequiredPolicyDocuments,
  recordRequiredPolicyAcceptanceEvents,
  type RequiredPolicyVersions,
} from "../lib/legal-policy.js";
import {
  CUSTOMER_AUTH_PROVIDERS,
  CUSTOMER_SUBJECT_LOOKUP_PROVIDERS,
  verifySupabaseCustomerAccessToken,
  type VerifiedSupabaseCustomer,
} from "../lib/supabase-auth.js";
import { issueSession } from "../plugins/auth.js";
import type { ApiContext } from "../types.js";

const CUSTOMER_LOGIN_METHODS = ["PHONE", "KAKAO", "NAVER", "GOOGLE", "APPLE"] as const;
export const REQUIRED_CUSTOMER_POLICY_VERSIONS = FALLBACK_REQUIRED_POLICY_VERSIONS;

type CustomerUserRow = {
  id: string;
  email: string | null;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  phone_e164: string | null;
};

export type CustomerAuthRouteDependencies = {
  verifyAccessToken?: typeof verifySupabaseCustomerAccessToken;
};

function configuredBroker(context: ApiContext): { supabaseUrl: string; audience: string; publishableKey: string } | null {
  const supabaseUrl = context.config.supabaseUrl || null;
  const publishableKey = context.config.supabasePublishableKey || null;
  if (!supabaseUrl || !publishableKey) return null;
  return {
    supabaseUrl,
    audience: context.config.supabaseJwtAudience || "authenticated",
    publishableKey,
  };
}

export function customerLoginProviderDiscovery(
  supabaseUrl: string | null | undefined,
  publishableKey: string | null | undefined,
  enabledProviders: readonly (typeof CUSTOMER_LOGIN_METHODS)[number][] | undefined = [],
  requiredPolicyVersions: RequiredPolicyVersions = REQUIRED_CUSTOMER_POLICY_VERSIONS,
) {
  const brokerExchangeConfigured = Boolean(supabaseUrl && publishableKey);
  const enabled = new Set(enabledProviders || []);
  return {
    methods: brokerExchangeConfigured
      ? CUSTOMER_LOGIN_METHODS.filter((provider) => enabled.has(provider))
      : [],
    brokerExchangeConfigured,
    requiredPolicyVersions,
  };
}

export function requiredPolicyAcceptance(
  input: Record<string, unknown>,
  required: RequiredPolicyVersions,
) {
  const value = input.acceptedPolicies;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(428, "LEGAL_ACCEPTANCE_REQUIRED", "필수 약관과 개인정보처리방침에 동의해 주세요.", {
      requiredPolicyVersions: required,
    });
  }
  const accepted = value as Record<string, unknown>;
  if (
    Object.keys(accepted).length !== 2
    || accepted.terms !== required.terms
    || accepted.privacy !== required.privacy
  ) {
    throw new AppError(428, "LEGAL_ACCEPTANCE_REQUIRED", "현재 필수 약관 버전을 다시 확인해 주세요.", {
      requiredPolicyVersions: required,
    });
  }
  return required;
}

function userAgent(value: string | string[] | undefined): string | undefined {
  const normalized = Array.isArray(value) ? value.join(" ") : value;
  return normalized?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 500) || undefined;
}

async function lockAccountMutation(client: DatabaseClient, userId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
    [`account-mutation:${userId}`],
  );
}

async function applyVerifiedContactClaims(
  client: DatabaseClient,
  user: CustomerUserRow,
  claims: VerifiedSupabaseCustomer,
): Promise<void> {
  if (claims.email) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [`customer-auth-email:${claims.email}`],
    );
    const usedEmail = await client.query(
      "SELECT 1 FROM users WHERE email=$1 AND id<>$2 LIMIT 1",
      [claims.email, user.id],
    );
    if (!usedEmail.rowCount) {
      await client.query("UPDATE users SET email=$2 WHERE id=$1", [user.id, claims.email]);
    }
  }
  if (claims.phone) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [`customer-auth-phone:${claims.phone}`],
    );
    const usedPhone = await client.query(
      "SELECT 1 FROM users WHERE phone_e164=$1 AND id<>$2 LIMIT 1",
      [claims.phone, user.id],
    );
    if (usedPhone.rowCount) {
      throw conflict("인증된 휴대폰 번호가 다른 계정에 연결되어 있습니다. 고객센터에 문의해 주세요.");
    }
    await client.query("UPDATE users SET phone_e164=$2 WHERE id=$1", [user.id, claims.phone]);
  }
}

async function storeAppleRefreshCredential(
  client: DatabaseClient,
  context: ApiContext,
  userId: string,
  refreshToken: string,
): Promise<void> {
  const encryption = context.config.appleCredentialEncryption;
  if (!encryption) {
    throw new AppError(503, "APPLE_AUTH_UNAVAILABLE", "Apple 로그인 삭제 보호 설정이 준비되지 않았습니다.");
  }
  const sealed = sealAppleRefreshToken({
    token: refreshToken,
    userId,
    encodedKey: encryption.key,
    keyVersion: encryption.keyVersion,
  });
  await client.query(
    `INSERT INTO apple_auth_credentials
      (user_id,credential_kind,ciphertext,nonce,auth_tag,key_version,captured_at)
     VALUES($1,'REFRESH_TOKEN',$2,$3,$4,$5,now())
     ON CONFLICT (user_id) DO UPDATE
       SET credential_kind=EXCLUDED.credential_kind,ciphertext=EXCLUDED.ciphertext,
           nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,key_version=EXCLUDED.key_version,
           captured_at=now(),updated_at=now()`,
    [userId, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.keyVersion],
  );
}

async function existingBrokeredCustomerForDeletion(
  client: DatabaseClient,
  claims: VerifiedSupabaseCustomer,
  loginProvider: (typeof CUSTOMER_LOGIN_METHODS)[number],
): Promise<CustomerUserRow> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
    [`customer-auth-subject:${claims.canonicalSubject}`],
  );
  const linked = await client.query<{ user_id: string }>(
    `SELECT user_id
       FROM auth_identities
      WHERE provider=$1 AND provider_subject=$2
      ORDER BY user_id`,
    [loginProvider, claims.canonicalSubject],
  );
  const linkedUserIds = [...new Set(linked.rows.map((row) => row.user_id))];
  if (linkedUserIds.length !== 1) {
    throw unauthorized("기존 로그인 계정으로 본인 확인을 완료하지 못했습니다.");
  }

  const userId = linkedUserIds[0]!;
  await lockAccountMutation(client, userId);
  const existing = await client.query<CustomerUserRow>(
    `SELECT id,email::text,nickname,role,status,phone_e164
       FROM users WHERE id=$1 FOR UPDATE`,
    [userId],
  );
  const user = existing.rows[0];
  if (!user || user.role !== "USER") {
    throw unauthorized("기존 로그인 계정으로 본인 확인을 완료하지 못했습니다.");
  }
  const activeDeletion = await client.query(
    `SELECT 1 FROM account_deletion_requests
      WHERE user_id=$1 AND status IN ('PROCESSING','APPROVED')
      LIMIT 1`,
    [user.id],
  );
  if (activeDeletion.rowCount || user.status === "DELETED") {
    throw forbidden("탈퇴 처리가 시작된 계정은 다시 로그인할 수 없습니다.");
  }
  if (user.status === "BANNED" || user.status === "SUSPENDED") {
    throw forbidden("현재 사용할 수 없는 계정입니다.");
  }
  await applyVerifiedContactClaims(client, user, claims);
  const refreshed = await client.query<CustomerUserRow>(
    `SELECT id,email::text,nickname,role,status,phone_e164
       FROM users WHERE id=$1`,
    [user.id],
  );
  return refreshed.rows[0]!;
}

async function upsertBrokeredCustomer(
  client: DatabaseClient,
  claims: VerifiedSupabaseCustomer,
): Promise<CustomerUserRow> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
    [`customer-auth-subject:${claims.canonicalSubject}`],
  );
  const linked = await client.query<{ user_id: string }>(
    `SELECT ai.user_id
     FROM auth_identities ai
     WHERE ai.provider_subject=$1 AND ai.provider=ANY($2::text[])
     ORDER BY ai.user_id,ai.provider`,
    [claims.canonicalSubject, [...CUSTOMER_SUBJECT_LOOKUP_PROVIDERS]],
  );
  const linkedUserIds = [...new Set(linked.rows.map((row) => row.user_id))];
  if (linkedUserIds.length > 1) {
    throw conflict("로그인 연결 정보가 여러 계정에 연결되어 있습니다.");
  }

  let user: CustomerUserRow;
  if (linkedUserIds.length === 1) {
    const userId = linkedUserIds[0]!;
    await lockAccountMutation(client, userId);
    const existing = await client.query<CustomerUserRow>(
      `SELECT id,email::text,nickname,role,status,phone_e164
       FROM users WHERE id=$1 FOR UPDATE`,
      [userId],
    );
    if (!existing.rowCount) throw conflict("로그인 계정을 찾을 수 없습니다.");
    user = existing.rows[0]!;
  } else {
    const created = await client.query<CustomerUserRow>(
      `INSERT INTO users(email,nickname,phone_e164)
       VALUES(NULL,'다뽀바 회원',NULL)
       RETURNING id,email::text,nickname,role,status,phone_e164`,
    );
    user = created.rows[0]!;
    await lockAccountMutation(client, user.id);
  }

  if (user.role !== "USER") {
    throw forbidden("사용자 계정으로 로그인해 주세요.");
  }

  const activeDeletion = await client.query(
    `SELECT 1 FROM account_deletion_requests
     WHERE user_id=$1 AND status IN ('PROCESSING','APPROVED')
     LIMIT 1`,
    [user.id],
  );
  if (activeDeletion.rowCount || user.status === "DELETED") {
    throw forbidden("탈퇴 처리가 시작된 계정은 다시 로그인할 수 없습니다.");
  }
  if (user.status === "BANNED" || user.status === "SUSPENDED") {
    throw forbidden("현재 사용할 수 없는 계정입니다.");
  }

  await applyVerifiedContactClaims(client, user, claims);
  const identities = await client.query<{ provider: string }>(
    `INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at)
     SELECT $1,p.provider,$3,now()
     FROM unnest($2::text[]) AS p(provider)
     ON CONFLICT (provider,provider_subject) DO UPDATE
       SET verified_at=GREATEST(auth_identities.verified_at,EXCLUDED.verified_at)
       WHERE auth_identities.user_id=EXCLUDED.user_id
     RETURNING provider`,
    [user.id, claims.providers, claims.canonicalSubject],
  );
  if (identities.rowCount !== claims.providers.length) {
    throw conflict("로그인 연결 정보가 다른 계정에서 사용 중입니다.");
  }

  const refreshed = await client.query<CustomerUserRow>(
    `SELECT id,email::text,nickname,role,status,phone_e164
     FROM users WHERE id=$1`,
    [user.id],
  );
  return refreshed.rows[0]!;
}

export async function registerCustomerAuthRoutes(
  app: FastifyInstance,
  context: ApiContext,
  dependencies: CustomerAuthRouteDependencies = {},
) {
  app.get("/v1/auth/providers", async (_request, reply) => {
    const policy = await loadRequiredPolicyDocuments(context.pool);
    return reply.header("cache-control", "no-store").send(
      customerLoginProviderDiscovery(
        context.config.supabaseUrl,
        context.config.supabasePublishableKey,
        context.config.customerLoginProviders,
        policy.versions,
      ),
    );
  });

  app.post(
    "/v1/auth/exchange",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const broker = configuredBroker(context);
      if (!broker) {
        throw new AppError(503, "AUTH_BROKER_UNAVAILABLE", "로그인 연결이 아직 준비되지 않았습니다.");
      }
      const input = objectInput(request.body);
      if (Object.keys(input).some((key) => !["accessToken", "acceptedPolicies", "loginProvider", "appleRefreshToken"].includes(key))) {
        throw badRequest("지원하지 않는 로그인 교환 값이 포함되어 있습니다.");
      }
      const policy = await loadRequiredPolicyDocuments(context.pool);
      const acceptedPolicies = requiredPolicyAcceptance(input, policy.versions);
      const accessToken = stringInput(input, "accessToken", { min: 64, max: 16_384, trim: false })!;
      const loginProvider = enumInput(input, "loginProvider", CUSTOMER_LOGIN_METHODS)!;
      if (!context.config.customerLoginProviders?.includes(loginProvider)) {
        throw new AppError(503, "CUSTOMER_LOGIN_PROVIDER_UNAVAILABLE", "현재 선택한 로그인 방식을 사용할 수 없습니다.");
      }
      const appleRefreshToken = loginProvider === "APPLE"
        ? validateAppleRefreshToken(stringInput(input, "appleRefreshToken", { min: 32, max: 16_384, trim: false }))
        : null;
      if (loginProvider !== "APPLE" && input.appleRefreshToken !== undefined) {
        throw badRequest("Apple 삭제 자격 증명은 Apple 로그인에서만 전송할 수 있습니다.");
      }
      const verifyAccessToken = dependencies.verifyAccessToken || verifySupabaseCustomerAccessToken;
      const claims = await verifyAccessToken(accessToken, broker);
      if (!claims.providers.includes(loginProvider)) {
        throw forbidden("로그인 제공자 정보를 확인하지 못했습니다.");
      }
      if (loginProvider === "PHONE" && !claims.phone) {
        throw forbidden("인증된 휴대폰 번호를 확인하지 못했습니다.");
      }
      if (loginProvider === "APPLE" && !context.config.appleCredentialEncryption) {
        throw new AppError(503, "APPLE_AUTH_UNAVAILABLE", "Apple 로그인 삭제 보호 설정이 준비되지 않았습니다.");
      }
      const requestUserAgent = userAgent(request.headers["user-agent"]);
      const { user, session } = await withTransaction(context.pool, async (client) => {
        const user = await upsertBrokeredCustomer(client, claims);
        if (loginProvider === "APPLE") {
          await storeAppleRefreshCredential(client, context, user.id, appleRefreshToken!);
        }
        await recordRequiredPolicyAcceptanceEvents(client, {
          userId: user.id,
          documents: policy.documents,
          correlationId: request.id,
          source: "MOBILE_LOGIN",
          ipAddress: request.ip,
          ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
        });
        const session = await issueSession(client, context.config, {
          userId: user.id,
          kind: "USER",
          ip: request.ip,
          ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
        });
        return { user, session };
      });
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send({
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          actor: {
            userId: user.id,
            email: user.email,
            nickname: user.nickname,
            role: user.role,
            status: user.status,
            sessionId: session.sessionId,
            permissions: [],
          },
        });
    },
  );

  app.post(
    "/v1/auth/account-deletion-exchange",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const broker = configuredBroker(context);
      if (!broker) {
        throw new AppError(503, "AUTH_BROKER_UNAVAILABLE", "로그인 연결이 아직 준비되지 않았습니다.");
      }
      const input = objectInput(request.body);
      if (Object.keys(input).some((key) => ![
        "accessToken",
        "acceptedPolicies",
        "loginProvider",
        "appleRefreshToken",
      ].includes(key))) {
        throw badRequest("지원하지 않는 계정 삭제 인증 값이 포함되어 있습니다.");
      }
      const policy = await loadRequiredPolicyDocuments(context.pool);
      requiredPolicyAcceptance(input, policy.versions);
      const accessToken = stringInput(input, "accessToken", { min: 64, max: 16_384, trim: false })!;
      const loginProvider = enumInput(input, "loginProvider", CUSTOMER_LOGIN_METHODS)!;
      const rawAppleRefreshToken = input.appleRefreshToken === undefined
        ? null
        : validateAppleRefreshToken(stringInput(input, "appleRefreshToken", { min: 32, max: 16_384, trim: false }));
      if (loginProvider !== "APPLE" && rawAppleRefreshToken) {
        throw badRequest("Apple 삭제 자격 증명은 Apple 로그인에서만 전송할 수 있습니다.");
      }
      const verifyAccessToken = dependencies.verifyAccessToken || verifySupabaseCustomerAccessToken;
      const claims = await verifyAccessToken(accessToken, broker);
      if (!claims.providers.includes(loginProvider)) {
        throw forbidden("로그인 제공자 정보를 확인하지 못했습니다.");
      }
      if (loginProvider === "PHONE" && !claims.phone) {
        throw forbidden("인증된 휴대폰 번호를 확인하지 못했습니다.");
      }
      const requestUserAgent = userAgent(request.headers["user-agent"]);
      const { user, session } = await withTransaction(context.pool, async (client) => {
        const user = await existingBrokeredCustomerForDeletion(client, claims, loginProvider);
        if (loginProvider === "APPLE") {
          if (rawAppleRefreshToken) {
            await storeAppleRefreshCredential(client, context, user.id, rawAppleRefreshToken);
          } else {
            const credential = await client.query(
              "SELECT 1 FROM apple_auth_credentials WHERE user_id=$1 LIMIT 1",
              [user.id],
            );
            if (!credential.rowCount) {
              throw new AppError(
                409,
                "APPLE_REAUTHORIZATION_REQUIRED",
                "Apple 계정 연결 해제를 위해 Apple 로그인을 다시 완료해 주세요.",
              );
            }
          }
        }
        await recordRequiredPolicyAcceptanceEvents(client, {
          userId: user.id,
          documents: policy.documents,
          correlationId: request.id,
          source: "WEB_ACCOUNT_DELETION",
          ipAddress: request.ip,
          ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
        });
        const session = await issueSession(client, context.config, {
          userId: user.id,
          kind: "USER",
          ip: request.ip,
          expiresInMs: 15 * 60_000,
          ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
        });
        return { user, session };
      });
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send({
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          actor: {
            userId: user.id,
            email: user.email,
            nickname: user.nickname,
            role: user.role,
            status: user.status,
            sessionId: session.sessionId,
            permissions: [],
          },
        });
    },
  );
}
