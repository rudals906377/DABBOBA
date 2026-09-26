import { createHmac, randomBytes } from "node:crypto";
import { normalizeIP } from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { withTransaction } from "@dabboba/db";
import { isAdminRole, type UserRole, type UserStatus } from "@dabboba/domain";
import { createAdminClientIdentityResolver } from "../lib/admin-client-identity.js";
import {
  developmentSessionEnabled,
  mobileTestFixturesEnabled,
  MOBILE_TEST_EMAIL,
  provisionMobileTestAccount,
} from "../lib/development-fixtures.js";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { objectInput, stringInput } from "../lib/input.js";
import { verifyPassword, type PasswordRecord } from "../lib/password.js";
import { issueSession, tokenDigest } from "../plugins/auth.js";
import type { ApiContext } from "../types.js";

const DUMMY_PASSWORD: PasswordRecord = {
  hash: Buffer.alloc(64).toString("base64url"),
  salt: "dabboba-admin-enumeration-guard",
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
};

const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1_000;

export function nextAdminLoginFailureState(input: {
  failedAttempts: number;
  lockedUntil: Date | null;
  now: Date;
}): { failedAttempts: number; lockedUntil: Date | null } {
  const startsNewFailureWindow = Boolean(
    input.failedAttempts >= ADMIN_LOGIN_MAX_FAILURES
    && input.lockedUntil
    && input.lockedUntil <= input.now,
  );
  const failedAttempts = startsNewFailureWindow ? 1 : input.failedAttempts + 1;
  return {
    failedAttempts,
    lockedUntil: failedAttempts >= ADMIN_LOGIN_MAX_FAILURES
      ? new Date(input.now.getTime() + ADMIN_LOGIN_LOCK_MS)
      : null,
  };
}

function actorResponse(input: {
  userId: string;
  email: string | null;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
}) {
  return input;
}

function userAgent(value: string | string[] | undefined): string | undefined {
  const normalized = Array.isArray(value) ? value.join(" ") : value;
  return normalized?.slice(0, 500);
}

type CurrentSessionRow = {
  id: string;
  session_kind: "USER";
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
};

function currentUserResponse(
  actor: {
    userId: string;
    email: string | null;
    nickname: string;
    role: UserRole;
    status: UserStatus;
  },
  session: CurrentSessionRow,
) {
  return {
    actor,
    session: {
      id: session.id,
      kind: session.session_kind,
      createdAt: session.created_at.toISOString(),
      lastSeenAt: session.last_seen_at.toISOString(),
      expiresAt: session.expires_at.toISOString(),
    },
  };
}

export async function registerAuthRoutes(app: FastifyInstance, context: ApiContext) {
  const resolveAdminClientIdentity = createAdminClientIdentityResolver(context.config);

  app.post("/v1/auth/dev-session", async (request, reply) => {
    if (!developmentSessionEnabled({
      environment: context.config.environment,
      explicitFlag: process.env.DABBOBA_ENABLE_DEV_SESSION,
    })) throw notFound();
    const input = objectInput(request.body);
    const email = stringInput(input, "email", { max: 254 })!.toLocaleLowerCase("en-US");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("이메일 형식을 확인해 주세요.");
    const nickname = email.endsWith("@dabboba.local")
      ? "모찌수집가"
      : email.split("@")[0]!.slice(0, 20) || "다뽀바 회원";
    const result = await withTransaction(context.pool, async (client) => {
      const user = await client.query<{ id: string; email: string; nickname: string; role: UserRole; status: UserStatus }>(
        `INSERT INTO users (email, nickname)
         VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id, email::text, nickname, role, status`,
        [email, nickname],
      );
      const row = user.rows[0]!;
      const activeDeletion = await client.query(
        `SELECT 1 FROM account_deletion_requests
       WHERE user_id=$1 AND status IN ('PROCESSING','APPROVED')
         LIMIT 1`,
        [row.id],
      );
      if (activeDeletion.rowCount) {
        throw forbidden("탈퇴 처리가 시작된 계정은 다시 로그인할 수 없습니다.");
      }
      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, verified_at)
         VALUES ($1,'DEV',$2,now()) ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [row.id, email],
      );
      if (email === MOBILE_TEST_EMAIL && mobileTestFixturesEnabled({
        environment: context.config.environment,
        databaseUrl: context.config.databaseUrl,
        explicitFlag: process.env.DABBOBA_ENABLE_MOBILE_TEST_FIXTURES,
        expectedProjectRef: process.env.DABBOBA_MOBILE_TEST_FIXTURE_PROJECT_REF,
      })) {
        await provisionMobileTestAccount(client, { userId: row.id, email });
      }
      return row;
    });
    const requestUserAgent = userAgent(request.headers["user-agent"]);
    const session = await issueSession(context.pool, context.config, {
      userId: result.id,
      kind: "USER",
      ip: request.ip,
      ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
    });
    return reply.code(201).send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      actor: actorResponse({ ...result, userId: result.id, sessionId: session.sessionId }),
    });
  });

  app.get("/v1/auth/me", { preHandler: context.auth.requireUser }, async (request) => {
    const actor = request.actor!;
    const result = await context.pool.query<CurrentSessionRow>(
      `SELECT id,session_kind,created_at,last_seen_at,expires_at
       FROM sessions
       WHERE id=$1 AND user_id=$2 AND session_kind='USER'
         AND revoked_at IS NULL AND expires_at>now()`,
      [actor.sessionId, actor.userId],
    );
    const session = result.rows[0];
    if (!session) throw unauthorized("세션이 만료되었거나 유효하지 않습니다.");
    return currentUserResponse({
      userId: actor.userId,
      email: actor.email,
      nickname: actor.nickname,
      role: actor.role,
      status: actor.status,
    }, session);
  });

  app.post("/v1/auth/refresh", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const actor = request.actor!;
    const rotated = await withTransaction(context.pool, async (client) => {
      const current = await client.query<CurrentSessionRow>(
        `SELECT id,session_kind,created_at,last_seen_at,expires_at
         FROM sessions
         WHERE id=$1 AND user_id=$2 AND session_kind='USER'
           AND revoked_at IS NULL AND expires_at>now()
         FOR UPDATE`,
        [actor.sessionId, actor.userId],
      );
      if (!current.rowCount) throw unauthorized("세션이 만료되었거나 이미 갱신되었습니다.");

      const revoked = await client.query(
        `UPDATE sessions
         SET revoked_at=now(),revoke_reason='ROTATED'
         WHERE id=$1 AND user_id=$2 AND session_kind='USER' AND revoked_at IS NULL`,
        [actor.sessionId, actor.userId],
      );
      if (revoked.rowCount !== 1) throw unauthorized("세션이 만료되었거나 이미 갱신되었습니다.");

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + context.config.sessionTtlDays * 86_400_000);
      const requestUserAgent = userAgent(request.headers["user-agent"]);
      const created = await client.query<CurrentSessionRow>(
        `INSERT INTO sessions
          (user_id,session_kind,token_digest,ip_address,user_agent,expires_at,rotated_from_session_id)
         VALUES($1,'USER',$2,$3,$4,$5,$6)
         RETURNING id,session_kind,created_at,last_seen_at,expires_at`,
        [
          actor.userId,
          tokenDigest(token, context.config.sessionTokenPepper),
          request.ip,
          requestUserAgent || null,
          expiresAt,
          actor.sessionId,
        ],
      );
      return { token, session: created.rows[0]! };
    });

    return reply.code(201).send({
      token: rotated.token,
      expiresAt: rotated.session.expires_at.toISOString(),
      rotatedFromSessionId: actor.sessionId,
      ...currentUserResponse({
        userId: actor.userId,
        email: actor.email,
        nickname: actor.nickname,
        role: actor.role,
        status: actor.status,
      }, rotated.session),
    });
  });

  app.post("/v1/auth/logout", { preHandler: context.auth.requireUserWithoutPolicy }, async (request, reply) => {
    const actor = request.actor!;
    await withTransaction(context.pool, async (client) => {
      const revoked = await client.query(
        `UPDATE sessions SET revoked_at=now(),revoke_reason='LOGOUT'
         WHERE id=$1 AND user_id=$2 AND session_kind='USER' AND revoked_at IS NULL`,
        [actor.sessionId, actor.userId],
      );
      if (revoked.rowCount !== 1) throw unauthorized("세션이 만료되었거나 이미 로그아웃되었습니다.");
      await client.query(
        `UPDATE push_device_tokens
            SET disabled_at=COALESCE(disabled_at,now()),
                disabled_reason=COALESCE(disabled_reason,'LOGOUT')
          WHERE user_id=$1 AND session_id=$2`,
        [actor.userId, actor.sessionId],
      );
    });
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout-others", { preHandler: context.auth.requireUserWithoutPolicy }, async (request, reply) => {
    const actor = request.actor!;
    await withTransaction(context.pool, async (client) => {
      await client.query(
        `UPDATE sessions
            SET revoked_at=now(),revoke_reason='LOGOUT_OTHER_DEVICES'
          WHERE user_id=$1
            AND session_kind='USER'
            AND id<>$2
            AND revoked_at IS NULL`,
        [actor.userId, actor.sessionId],
      );
      await client.query(
        `UPDATE push_device_tokens
            SET disabled_at=COALESCE(disabled_at,now()),
                disabled_reason=COALESCE(disabled_reason,'LOGOUT_OTHER_DEVICES')
          WHERE user_id=$1 AND session_id<>$2`,
        [actor.userId, actor.sessionId],
      );
    });
    return reply.code(204).send();
  });

  app.post(
    "/v1/admin/auth/login",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "15 minutes",
          keyGenerator: (request) => normalizeIP(resolveAdminClientIdentity(request).ipAddress, 64),
        },
      },
    },
    async (request, reply) => {
      const clientIdentity = resolveAdminClientIdentity(request);
      const input = objectInput(request.body);
      const email = stringInput(input, "email", { max: 254 })!.toLocaleLowerCase("en-US");
      const password = stringInput(input, "password", { min: 12, max: 256, trim: false })!;
      const emailHash = createHmac("sha256", context.config.sessionTokenPepper).update(email).digest("hex");
      const loginResult = await withTransaction(context.pool, async (client) => {
        const result = await client.query<{
          id: string;
          email: string;
          nickname: string;
          role: UserRole;
          status: UserStatus;
          suspended_until: Date | null;
          password_hash: string;
          password_salt: string;
          scrypt_cost: number;
          scrypt_block_size: number;
          scrypt_parallelization: number;
          failed_attempts: number;
          locked_until: Date | null;
        }>(
          `SELECT u.id, u.email::text, u.nickname, u.role, u.status, u.suspended_until,
                  c.password_hash, c.password_salt, c.scrypt_cost, c.scrypt_block_size,
                  c.scrypt_parallelization, c.failed_attempts, c.locked_until
           FROM users u JOIN admin_credentials c ON c.user_id = u.id
           WHERE u.email = $1
           FOR UPDATE OF u, c`,
          [email],
        );
        const row = result.rows[0];
        const attemptedAt = new Date();
        const locked = Boolean(row?.locked_until && row.locked_until > attemptedAt);
        const passwordMatches = await verifyPassword(password, row ? {
          hash: row.password_hash,
          salt: row.password_salt,
          cost: row.scrypt_cost,
          blockSize: row.scrypt_block_size,
          parallelization: row.scrypt_parallelization,
        } : DUMMY_PASSWORD);
        const activeAdmin = Boolean(
          row && isAdminRole(row.role) && row.status === "ACTIVE" && !locked && passwordMatches,
        );

        if (row) {
          if (activeAdmin) {
            await client.query("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [row.id]);
          } else if (!locked) {
            const nextFailureState = nextAdminLoginFailureState({
              failedAttempts: row.failed_attempts,
              lockedUntil: row.locked_until,
              now: attemptedAt,
            });
            await client.query(
              `UPDATE admin_credentials
               SET failed_attempts = $2, locked_until = $3
               WHERE user_id = $1`,
              [row.id, nextFailureState.failedAttempts, nextFailureState.lockedUntil],
            );
          }
        }
        await client.query(
          `INSERT INTO admin_login_events
            (user_id, attempted_email_hash, succeeded, failure_code, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [row?.id || null, emailHash, activeAdmin, activeAdmin ? null : locked ? "LOCKED" : "INVALID_CREDENTIALS", clientIdentity.ipAddress, clientIdentity.userAgent],
        );
        return { row, activeAdmin };
      });

      if (!loginResult.activeAdmin || !loginResult.row) throw unauthorized("관리자 이메일 또는 비밀번호를 확인해 주세요.");
      const row = loginResult.row;
      const session = await issueSession(context.pool, context.config, {
        userId: row.id,
        kind: "ADMIN",
        ip: clientIdentity.ipAddress,
        ...(clientIdentity.userAgent ? { userAgent: clientIdentity.userAgent } : {}),
      });
      return reply.code(201).send({
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        actor: actorResponse({
          userId: row.id,
          email: row.email,
          nickname: row.nickname,
          role: row.role,
          status: row.status,
          sessionId: session.sessionId,
        }),
      });
    },
  );

  app.get("/v1/admin/me", { preHandler: context.auth.requireAdmin }, async (request) => {
    const actor = request.actor!;
    const permissions = await context.pool.query<{ permission_code: string }>(
      "SELECT permission_code FROM admin_role_permissions WHERE role = $1 ORDER BY permission_code",
      [actor.role],
    );
    return {
      userId: actor.userId,
      email: actor.email,
      nickname: actor.nickname,
      role: actor.role,
      status: actor.status,
      sessionId: actor.sessionId,
      permissions: permissions.rows.map((row) => row.permission_code),
    };
  });

  app.post("/v1/admin/auth/logout", { preHandler: context.auth.requireAdmin }, async (request, reply) => {
    await context.pool.query(
      "UPDATE sessions SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1 AND revoked_at IS NULL",
      [request.actor!.sessionId],
    );
    return reply.code(204).send();
  });

  app.post("/v1/admin/auth/keepalive", { preHandler: context.auth.requireAdmin }, async (request) => {
    const actor = request.actor!;
    const result = await context.pool.query<{ expires_at: Date }>(
      `UPDATE sessions
          SET expires_at = GREATEST(expires_at, now() + ($3::integer * interval '1 day')),
              last_seen_at = now()
        WHERE id = $1 AND user_id = $2 AND session_kind = 'ADMIN'
          AND revoked_at IS NULL AND expires_at > now()
        RETURNING expires_at`,
      [actor.sessionId, actor.userId, context.config.sessionTtlDays],
    );
    const session = result.rows[0];
    if (!session) throw unauthorized("세션이 만료되었거나 유효하지 않습니다.");
    return { expiresAt: session.expires_at.toISOString() };
  });
}
