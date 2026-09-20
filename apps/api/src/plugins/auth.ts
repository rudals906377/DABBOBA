import { createHmac, randomBytes } from "node:crypto";
import type { ApiConfig } from "@dabboba/config";
import type { DatabasePool, Queryable } from "@dabboba/db";
import { isAdminRole, type UserRole, type UserStatus } from "@dabboba/domain";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { forbidden, unauthorized } from "../lib/errors.js";
import { assertRequiredPolicyAcceptance } from "../lib/legal-policy.js";

export type Actor = {
  userId: string;
  email: string | null;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
  sessionKind: "USER" | "ADMIN";
};

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export function tokenDigest(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export async function issueSession(
  pool: Queryable,
  config: ApiConfig,
  input: {
    userId: string;
    kind: "USER" | "ADMIN";
    ip?: string;
    userAgent?: string;
    expiresInMs?: number;
  },
) {
  const token = randomBytes(32).toString("base64url");
  const configuredTtlMs = config.sessionTtlDays * 86_400_000;
  if (
    input.expiresInMs !== undefined
    && (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs < 60_000)
  ) {
    throw new Error("Session expiry override must be at least one minute");
  }
  const expiresAt = new Date(Date.now() + Math.min(input.expiresInMs ?? configuredTtlMs, configuredTtlMs));
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (user_id, session_kind, token_digest, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.userId, input.kind, tokenDigest(token, config.sessionTokenPepper), input.ip || null, input.userAgent || null, expiresAt],
  );
  return { token, sessionId: result.rows[0]!.id, expiresAt };
}

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 32 && token.length <= 200 ? token : null;
}

export function createAuthHooks(pool: DatabasePool, config: ApiConfig) {
  const loadActor = async (request: FastifyRequest): Promise<Actor> => {
    if (request.actor) return request.actor;
    const token = bearerToken(request);
    if (!token) throw unauthorized();
    const result = await pool.query<{
      session_id: string;
      session_kind: "USER" | "ADMIN";
      user_id: string;
      email: string | null;
      nickname: string;
      role: UserRole;
      status: UserStatus;
      suspended_until: Date | null;
    }>(
      `WITH active_session AS MATERIALIZED (
         SELECT s.id AS session_id, s.session_kind, u.id AS user_id,
                u.email::text, u.nickname, u.role, u.status, u.suspended_until
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_digest = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
          LIMIT 1
       ), touch_target AS MATERIALIZED (
         SELECT s.id
           FROM sessions s
           JOIN active_session active ON active.session_id = s.id
          WHERE s.last_seen_at < now() - interval '5 minutes'
          FOR UPDATE OF s SKIP LOCKED
       ), touch AS (
         UPDATE sessions s
            SET last_seen_at = now()
           FROM touch_target target
          WHERE s.id = target.id
          RETURNING s.id
       )
       SELECT active.*, EXISTS(SELECT 1 FROM touch) AS last_seen_touched
         FROM active_session active`,
      [tokenDigest(token, config.sessionTokenPepper)],
    );
    const row = result.rows[0];
    if (!row) throw unauthorized("세션이 만료되었거나 유효하지 않습니다.");
    if (row.status === "SUSPENDED" && (!row.suspended_until || row.suspended_until > new Date())) {
      throw forbidden("이용이 정지된 계정입니다.");
    }
    if (row.status !== "ACTIVE" && row.status !== "SUSPENDED") throw forbidden("사용할 수 없는 계정입니다.");
    const actor: Actor = {
      userId: row.user_id,
      email: row.email,
      nickname: row.nickname,
      role: row.role,
      status: row.status,
      sessionId: row.session_id,
      sessionKind: row.session_kind,
    };
    request.actor = actor;
    return actor;
  };

  const requireUserIdentity = async (request: FastifyRequest): Promise<void> => {
    const actor = await loadActor(request);
    if (actor.sessionKind !== "USER" || actor.role !== "USER") {
      throw forbidden("사용자 세션이 필요합니다.");
    }
    const activeDeletion = await pool.query(
      `SELECT 1 FROM account_deletion_requests
       WHERE user_id=$1 AND status IN ('PROCESSING','APPROVED')
       LIMIT 1`,
      [actor.userId],
    );
    if (activeDeletion.rowCount) {
      throw forbidden("탈퇴 처리가 시작된 계정은 더 이상 사용할 수 없습니다.");
    }
  };

  const requireUserWithoutPolicy: preHandlerHookHandler = async (request) => {
    await requireUserIdentity(request);
  };

  const requireUser: preHandlerHookHandler = async (request) => {
    await requireUserIdentity(request);
    await assertRequiredPolicyAcceptance(pool, request.actor!.userId);
  };

  const requireAdmin: preHandlerHookHandler = async (request) => {
    const actor = await loadActor(request);
    if (actor.sessionKind !== "ADMIN" || !isAdminRole(actor.role)) throw forbidden();
  };

  const requireSuperAdmin: preHandlerHookHandler = async (request) => {
    const actor = await loadActor(request);
    if (actor.sessionKind !== "ADMIN" || actor.role !== "SUPER_ADMIN") throw forbidden("최고 관리자 권한이 필요합니다.");
  };

  const requirePermission = (permission: string): preHandlerHookHandler => async (request) => {
    const actor = await loadActor(request);
    if (actor.sessionKind !== "ADMIN" || !isAdminRole(actor.role)) throw forbidden();
    const allowed = await pool.query(
      "SELECT 1 FROM admin_role_permissions WHERE role = $1 AND permission_code = $2",
      [actor.role, permission],
    );
    if (!allowed.rowCount) throw forbidden();
  };

  return { loadActor, requireUser, requireUserWithoutPolicy, requireAdmin, requireSuperAdmin, requirePermission };
}
