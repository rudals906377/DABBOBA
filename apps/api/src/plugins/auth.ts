import { createHmac, randomBytes } from "node:crypto";
import {
  DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
  DEFAULT_ADMIN_SESSION_MAX_HOURS,
  type ApiConfig,
} from "@dabboba/config";
import type { DatabasePool, Queryable } from "@dabboba/db";
import { isAdminRole, type UserRole, type UserStatus } from "@dabboba/domain";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import { assertRequiredPolicyAcceptance } from "../lib/legal-policy.js";

/**
 * FULL is an ordinary customer or administrator session. ACCOUNT_DELETION is
 * the short-lived session issued by the public account-deletion
 * re-authentication and only unlocks routes that opt in with
 * `config.allowAccountDeletionScope`.
 */
export type SessionScope = "FULL" | "ACCOUNT_DELETION";

export type Actor = {
  userId: string;
  email: string | null;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
  sessionKind: "USER" | "ADMIN";
  sessionScope: SessionScope;
};

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyContextConfig {
    /** Route opt-in for ACCOUNT_DELETION-scoped sessions; every other route rejects them. */
    allowAccountDeletionScope?: boolean;
  }
}

export function tokenDigest(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export function adminSessionLimits(config: ApiConfig): { maxHours: number; idleMinutes: number } {
  return {
    maxHours: config.adminSessionMaxHours ?? DEFAULT_ADMIN_SESSION_MAX_HOURS,
    idleMinutes: config.adminSessionIdleMinutes ?? DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
  };
}

export async function issueSession(
  pool: Queryable,
  config: ApiConfig,
  input: {
    userId: string;
    kind: "USER" | "ADMIN";
    scope?: SessionScope;
    ip?: string;
    userAgent?: string;
    expiresInMs?: number;
    /** Absolute payment-review deadline; the session never outlives it and refresh keeps it. */
    reviewAccessExpiresAt?: Date;
  },
) {
  const token = randomBytes(32).toString("base64url");
  const scope: SessionScope = input.scope ?? "FULL";
  if (scope === "ACCOUNT_DELETION" && input.kind !== "USER") {
    throw new Error("Account-deletion scope applies only to customer sessions");
  }
  const admin = adminSessionLimits(config);
  // Administrator sessions start with the idle window and are capped by the
  // absolute lifetime from login; customer sessions keep the long TTL.
  const configuredTtlMs = input.kind === "ADMIN"
    ? Math.min(admin.idleMinutes * 60_000, admin.maxHours * 3_600_000)
    : config.sessionTtlDays * 86_400_000;
  if (
    input.expiresInMs !== undefined
    && (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs < 60_000)
  ) {
    throw new Error("Session expiry override must be at least one minute");
  }
  const now = Date.now();
  let expiresAtMs = now + Math.min(input.expiresInMs ?? configuredTtlMs, configuredTtlMs);
  const reviewDeadline = input.reviewAccessExpiresAt?.getTime();
  if (reviewDeadline !== undefined) {
    if (input.kind !== "USER" || scope !== "FULL") {
      throw new Error("Review access applies only to full customer sessions");
    }
    if (!Number.isFinite(reviewDeadline) || reviewDeadline <= now) throw new Error("Review access has already expired");
    // Clamp once against the absolute deadline: deriving a relative TTL before
    // the surrounding transaction would let the session outlive it.
    expiresAtMs = Math.min(expiresAtMs, reviewDeadline);
  }
  const expiresAt = new Date(expiresAtMs);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (user_id, session_kind, scope, token_digest, ip_address, user_agent, expires_at, review_access_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.userId,
      input.kind,
      scope,
      tokenDigest(token, config.sessionTokenPepper),
      input.ip || null,
      input.userAgent || null,
      expiresAt,
      reviewDeadline === undefined ? null : new Date(reviewDeadline),
    ],
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
  const admin = adminSessionLimits(config);
  const loadActor = async (request: FastifyRequest): Promise<Actor> => {
    if (request.actor) return request.actor;
    const token = bearerToken(request);
    if (!token) throw unauthorized();
    const result = await pool.query<{
      session_id: string;
      session_kind: "USER" | "ADMIN";
      scope: SessionScope;
      user_id: string;
      email: string | null;
      nickname: string;
      role: UserRole;
      status: UserStatus;
      suspended_until: Date | null;
    }>(
      `WITH active_session AS MATERIALIZED (
         SELECT s.id AS session_id, s.session_kind, s.scope, u.id AS user_id,
                u.email::text, u.nickname, u.role, u.status, u.suspended_until
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_digest = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND (
              s.session_kind <> 'ADMIN'
              OR s.created_at + ($2::integer * interval '1 hour') > now()
            )
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
      [tokenDigest(token, config.sessionTokenPepper), admin.maxHours],
    );
    const row = result.rows[0];
    if (!row) throw unauthorized("세션이 만료되었거나 유효하지 않습니다.");
    if (row.status === "SUSPENDED" && (!row.suspended_until || row.suspended_until > new Date())) {
      throw forbidden("이용이 정지된 계정입니다.");
    }
    if (row.status !== "ACTIVE" && row.status !== "SUSPENDED") throw forbidden("사용할 수 없는 계정입니다.");
    // A deletion-scoped session proves ownership for the public deletion flow
    // only. Fail closed on any route that has not opted in, including the
    // optional-viewer helpers that would otherwise treat it as a customer.
    if (row.scope !== "FULL") {
      const allowed = row.scope === "ACCOUNT_DELETION"
        && request.routeOptions?.config?.allowAccountDeletionScope === true;
      if (!allowed) {
        throw new AppError(
          403,
          "SESSION_SCOPE_FORBIDDEN",
          "계정 삭제 확인용 세션으로는 이 기능을 사용할 수 없습니다.",
        );
      }
    }
    const actor: Actor = {
      userId: row.user_id,
      email: row.email,
      nickname: row.nickname,
      role: row.role,
      status: row.status,
      sessionId: row.session_id,
      sessionKind: row.session_kind,
      sessionScope: row.scope,
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
