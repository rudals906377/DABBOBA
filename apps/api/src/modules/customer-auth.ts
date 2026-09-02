import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import type { UserRole, UserStatus } from "@dabboba/domain";
import { AppError, badRequest, conflict, forbidden } from "../lib/errors.js";
import { objectInput, stringInput } from "../lib/input.js";
import {
  CUSTOMER_AUTH_PROVIDERS,
  verifySupabaseAccessToken,
  type SupabaseCustomerClaims,
} from "../lib/supabase-auth.js";
import { issueSession } from "../plugins/auth.js";
import type { ApiContext } from "../types.js";

const CUSTOMER_LOGIN_METHODS = ["KAKAO", "NAVER", "PHONE"] as const;

type CustomerUserRow = {
  id: string;
  email: string | null;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  phone_e164: string | null;
};

function configuredBroker(context: ApiContext): { supabaseUrl: string; audience: string } | null {
  const supabaseUrl = context.config.supabaseUrl || null;
  if (!supabaseUrl) return null;
  return {
    supabaseUrl,
    audience: context.config.supabaseJwtAudience || "authenticated",
  };
}

export function customerLoginProviderDiscovery(supabaseUrl: string | null | undefined) {
  return {
    methods: [...CUSTOMER_LOGIN_METHODS],
    brokerExchangeConfigured: Boolean(supabaseUrl),
  };
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
  claims: SupabaseCustomerClaims,
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

  if (claims.phoneE164) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [`customer-auth-phone:${claims.phoneE164}`],
    );
    const usedPhone = await client.query(
      "SELECT 1 FROM users WHERE phone_e164=$1 AND id<>$2 LIMIT 1",
      [claims.phoneE164, user.id],
    );
    if (usedPhone.rowCount) {
      throw conflict("이미 다른 계정에 등록된 휴대폰 번호입니다.");
    }
    await client.query("UPDATE users SET phone_e164=$2 WHERE id=$1", [user.id, claims.phoneE164]);
  }
}

async function upsertBrokeredCustomer(
  client: DatabaseClient,
  claims: SupabaseCustomerClaims,
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
    [claims.canonicalSubject, [...CUSTOMER_AUTH_PROVIDERS]],
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

  const approvedDeletion = await client.query(
    `SELECT 1 FROM account_deletion_requests
     WHERE user_id=$1 AND status='APPROVED'
     LIMIT 1`,
    [user.id],
  );
  if (approvedDeletion.rowCount || user.status === "DELETED") {
    throw forbidden("탈퇴가 승인된 계정은 다시 로그인할 수 없습니다.");
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

export async function registerCustomerAuthRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/auth/providers", async (_request, reply) => {
    return reply.header("cache-control", "no-store").send(
      customerLoginProviderDiscovery(context.config.supabaseUrl),
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
      if (Object.keys(input).some((key) => key !== "accessToken")) {
        throw badRequest("지원하지 않는 로그인 교환 값이 포함되어 있습니다.");
      }
      const accessToken = stringInput(input, "accessToken", { min: 64, max: 16_384, trim: false })!;
      const claims = await verifySupabaseAccessToken(accessToken, broker);
      const requestUserAgent = userAgent(request.headers["user-agent"]);
      const { user, session } = await withTransaction(context.pool, async (client) => {
        const user = await upsertBrokeredCustomer(client, claims);
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
}
