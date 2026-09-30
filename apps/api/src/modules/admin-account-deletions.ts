import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction } from "@dabboba/db";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, requestHash } from "../lib/idempotency.js";
import { enumInput, objectInput, queryString, stringInput, uuidInput, likeContainsPattern } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, maskEmail, nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";
import { loadDeletionBlockers, type AccountDeletionBlockers } from "./account.js";

const ACCOUNT_DELETION_STATUSES = [
  "PENDING_REVIEW",
  "BLOCKED",
  "PROCESSING",
  "APPROVED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
const ACCOUNT_DELETION_QUEUE_FILTERS = ["OPEN", ...ACCOUNT_DELETION_STATUSES] as const;
const ACCOUNT_DELETION_DECISIONS = ["APPROVED", "REJECTED"] as const;

type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];
type AccountDeletionDecision = (typeof ACCOUNT_DELETION_DECISIONS)[number];

type AccountDeletionRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  nickname: string;
  status: AccountDeletionStatus;
  blocker_snapshot: unknown;
  request_count: number | string;
  requested_at: Date;
  last_requested_at: Date;
  decided_at: Date | null;
  decision_reason: string | null;
  decided_by_admin_id: string | null;
  decided_by_admin_nickname: string | null;
  version: number;
  auth_deletion_status: "NOT_REQUIRED" | "PENDING" | "COMPLETED";
  auth_deleted_at: Date | null;
  processing_started_at: Date | null;
  completed_at: Date | null;
  job_status: "PENDING" | "PROCESSING" | null;
  job_attempts: number | string | null;
  job_available_at: Date | null;
  job_lease_expires_at: Date | null;
  job_last_error: string | null;
  job_external_deleted_at: Date | null;
  record_created_at: Date;
  updated_at: Date;
  created_at: Date;
};

type AccountDeletionEventRow = {
  id: string;
  event_type: "CREATED" | "REASSESSED" | "STATUS_CHANGED";
  status: AccountDeletionStatus;
  blocker_snapshot: unknown;
  revoked_session_count: number | string;
  correlation_id: string;
  metadata: Record<string, unknown>;
  admin_actor_id: string | null;
  admin_nickname: string | null;
  reason: string | null;
  created_at: Date;
};

const blockerKeys = [
  "pointBalance",
  "activeOrderCount",
  "activePaymentCount",
  "availableDrawEntitlementCount",
  "activeInventoryCount",
  "activeShippingRequestCount",
  "activeExchangeListingCount",
  "activeExchangeOfferCount",
] as const satisfies readonly (keyof AccountDeletionBlockers)[];

function queryOf(request: FastifyRequest) {
  return (request.query || {}) as Record<string, unknown>;
}

function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw badRequest(`지원하지 않는 입력 항목입니다: ${unknown}`);
}

function normalizeBlockers(value: unknown): AccountDeletionBlockers {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(blockerKeys.map((key) => {
    const raw = Number(source[key] ?? 0);
    return [key, Number.isFinite(raw) && raw >= 0 ? raw : 0];
  })) as AccountDeletionBlockers;
}

export function hasAccountDeletionBlockers(blockers: AccountDeletionBlockers) {
  return blockerKeys.some((key) => blockers[key] > 0);
}

export function allowedAccountDeletionDecision(from: AccountDeletionStatus, to: AccountDeletionDecision) {
  return (from === "PENDING_REVIEW" || from === "BLOCKED")
    && to === "REJECTED";
}

export function accountDeletionCompletionAvailable(_status: AccountDeletionStatus) {
  return false;
}

function deletionSummary(row: AccountDeletionRow) {
  return {
    id: row.id,
    user: { id: row.user_id, emailMasked: maskEmail(row.user_email), nickname: row.nickname },
    status: row.status,
    blockers: normalizeBlockers(row.blocker_snapshot),
    requestCount: numberValue(row.request_count),
    version: row.version,
    requestedAt: iso(row.requested_at),
    lastRequestedAt: iso(row.last_requested_at),
    decidedAt: nullableIso(row.decided_at),
    decisionReason: row.decision_reason,
    decidedBy: row.decided_by_admin_id ? {
      id: row.decided_by_admin_id,
      nickname: row.decided_by_admin_nickname || "관리자",
    } : null,
    createdAt: iso(row.record_created_at),
    updatedAt: iso(row.updated_at),
    hardDeletePerformed: false as const,
    completionAvailable: accountDeletionCompletionAvailable(row.status),
    completionPolicy: row.status === "COMPLETED"
      ? "COMPLETED_ANONYMIZATION" as const
      : row.status === "PROCESSING"
        ? "AUTOMATED_WORKER" as const
        : "ADMIN_REVIEW_FALLBACK" as const,
    authDeletionStatus: row.auth_deletion_status,
    authDeletedAt: nullableIso(row.auth_deleted_at),
    processingStartedAt: nullableIso(row.processing_started_at),
    completedAt: nullableIso(row.completed_at),
    deletionJob: row.job_status ? {
      status: row.job_status,
      attempts: numberValue(row.job_attempts),
      availableAt: nullableIso(row.job_available_at),
      leaseExpiresAt: nullableIso(row.job_lease_expires_at),
      lastError: row.job_last_error,
      externalDeletedAt: nullableIso(row.job_external_deleted_at),
    } : null,
  };
}

function deletionEvent(row: AccountDeletionEventRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    blockers: normalizeBlockers(row.blocker_snapshot),
    revokedSessionCount: numberValue(row.revoked_session_count),
    correlationId: row.correlation_id,
    metadata: row.metadata,
    admin: row.admin_actor_id ? {
      id: row.admin_actor_id,
      nickname: row.admin_nickname || "관리자",
    } : null,
    reason: row.reason,
    createdAt: iso(row.created_at),
  };
}

async function sendMutation(
  reply: FastifyReply,
  result: { replay: boolean; statusCode: number; body: unknown },
) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(result.statusCode).send(result.body);
}

const deletionSelect = `
  SELECT d.id,d.user_id,u.email::text AS user_email,u.nickname,d.status,d.blocker_snapshot,
    d.request_count,d.requested_at,d.last_requested_at,d.decided_at,d.decision_reason,
    d.decided_by_admin_id,decider.nickname AS decided_by_admin_nickname,d.version,
    d.auth_deletion_status,d.auth_deleted_at,d.processing_started_at,d.completed_at,
    deletion_job.status AS job_status,deletion_job.attempts AS job_attempts,
    deletion_job.available_at AS job_available_at,deletion_job.lease_expires_at AS job_lease_expires_at,
    deletion_job.last_error AS job_last_error,deletion_job.external_deleted_at AS job_external_deleted_at,
    d.created_at AS record_created_at,d.updated_at,d.last_requested_at AS created_at
  FROM account_deletion_requests d
  JOIN users u ON u.id=d.user_id
  LEFT JOIN users decider ON decider.id=d.decided_by_admin_id
  LEFT JOIN account_auth_deletion_jobs deletion_job ON deletion_job.deletion_request_id=d.id`;

export async function registerAdminAccountDeletionRoutes(app: FastifyInstance, context: ApiContext) {
  app.get(
    "/v1/admin/account-deletions",
    { preHandler: context.auth.requirePermission("account_deletions.read") },
    async (request) => {
      const query = queryOf(request);
      const { limit, cursor } = pagination(query, "uuid");
      const status = query.status === undefined || query.status === ""
        ? "OPEN"
        : enumInput(query, "status", ACCOUNT_DELETION_QUEUE_FILTERS)!;
      const search = queryString(query.q, 200);
      const values: unknown[] = [limit + 1];
      const filters: string[] = [];
      if (status === "OPEN") filters.push("d.status IN ('PENDING_REVIEW','BLOCKED','PROCESSING')");
      else { values.push(status); filters.push(`d.status=$${values.length}`); }
      if (search) {
        values.push(likeContainsPattern(search));
        filters.push(`(d.id::text ILIKE $${values.length} ESCAPE '\\' OR d.user_id::text ILIKE $${values.length} ESCAPE '\\' OR u.nickname ILIKE $${values.length} ESCAPE '\\' OR u.email::text ILIKE $${values.length} ESCAPE '\\')`);
      }
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        filters.push(`(d.last_requested_at,d.id)<($${values.length - 1},$${values.length})`);
      }
      const result = await context.pool.query<AccountDeletionRow>(`
        ${deletionSelect}
        WHERE ${filters.join(" AND ")}
        ORDER BY d.last_requested_at DESC,d.id DESC
        LIMIT $1`, values);
      return cursorPage(result.rows, limit, deletionSummary);
    },
  );

  app.get(
    "/v1/admin/account-deletions/:requestId",
    { preHandler: context.auth.requirePermission("account_deletions.read") },
    async (request) => {
      const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
      const result = await context.pool.query<AccountDeletionRow>(`${deletionSelect} WHERE d.id=$1`, [requestId]);
      if (!result.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
      const row = result.rows[0]!;
      const currentBlockers = await loadDeletionBlockers(context.pool, row.user_id);
      const events = await context.pool.query<AccountDeletionEventRow>(`
        SELECT e.id,e.event_type,e.status,e.blocker_snapshot,e.revoked_session_count,
          e.correlation_id,e.metadata,e.admin_actor_id,a.nickname AS admin_nickname,e.reason,e.created_at
        FROM account_deletion_request_events e
        LEFT JOIN users a ON a.id=e.admin_actor_id
        WHERE e.deletion_request_id=$1
        ORDER BY e.created_at DESC,e.id DESC`, [requestId]);
      return {
        ...deletionSummary(row),
        currentBlockers,
        approvalEligible: false,
        rejectionAvailable: allowedAccountDeletionDecision(row.status, "REJECTED"),
        events: events.rows.map(deletionEvent),
      };
    },
  );

  app.post(
    "/v1/admin/account-deletions/:requestId/decision",
    { preHandler: context.auth.requirePermission("account_deletions.review") },
    async (request, reply) => {
      const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
      const input = objectInput(request.body);
      assertOnlyKeys(input, ["decision", "reason"]);
      const decision = enumInput(input, "decision", ACCOUNT_DELETION_DECISIONS)!;
      const reason = stringInput(input, "reason", { min: 2, max: 1_000 })!;
      const mutation = adminMutationHeaders(request, reason);
      const actor = request.actor!;

      if (decision === "APPROVED") {
        throw conflict("회원탈퇴는 고객 요청 직후 서버의 자동 삭제 작업에서 처리됩니다.");
      }

      const result = await withTransaction(context.pool, async (client) => {
        const started = await beginIdempotency(client, {
          actorId: actor.userId,
          scope: "ADMIN_ACCOUNT_DELETION_DECISION",
          key: mutation.idempotencyKey,
          hash: requestHash({ requestId, decision, reason }),
        });
        if (!started.fresh) {
          return { replay: true, statusCode: started.statusCode, body: started.body };
        }

        const target = await client.query<{ user_id: string }>(
          "SELECT user_id FROM account_deletion_requests WHERE id=$1",
          [requestId],
        );
        if (!target.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
          [`account-mutation:${target.rows[0]!.user_id}`],
        );
        const lockedUser = await client.query(
          "SELECT id FROM users WHERE id=$1 AND role='USER' FOR UPDATE",
          [target.rows[0]!.user_id],
        );
        if (!lockedUser.rowCount) throw notFound("사용자 계정을 찾을 수 없습니다.");

        const before = await client.query<AccountDeletionRow>(`${deletionSelect} WHERE d.id=$1 FOR UPDATE OF d`, [requestId]);
        if (!before.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (!allowedAccountDeletionDecision(current.status, decision)) {
          throw conflict("대기 또는 차단 상태의 탈퇴 요청만 반려할 수 있습니다.");
        }

        const blockers = await loadDeletionBlockers(client, current.user_id);

        const updated = await client.query<AccountDeletionRow>(`
          UPDATE account_deletion_requests d
          SET status=$2,blocker_snapshot=$3,decided_at=now(),decision_reason=$4,
            decided_by_admin_id=$5,version=version+1
          FROM users u
          LEFT JOIN users decider ON decider.id=$5
          WHERE d.id=$1 AND u.id=d.user_id
          RETURNING d.id,d.user_id,u.email::text AS user_email,u.nickname,d.status,d.blocker_snapshot,
            d.request_count,d.requested_at,d.last_requested_at,d.decided_at,d.decision_reason,
            d.decided_by_admin_id,decider.nickname AS decided_by_admin_nickname,d.version,
            d.auth_deletion_status,d.auth_deleted_at,
            d.created_at AS record_created_at,d.updated_at,d.last_requested_at AS created_at`,
          [requestId, decision, JSON.stringify(blockers), reason, actor.userId],
        );
        const after = updated.rows[0]!;

        const revoked = { rowCount: 0 };

        await client.query(
          `INSERT INTO account_deletion_request_events
            (deletion_request_id,user_id,event_type,status,blocker_snapshot,revoked_session_count,
             correlation_id,idempotency_key,metadata,admin_actor_id,reason)
           VALUES($1,$2,'STATUS_CHANGED',$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            requestId,
            current.user_id,
            decision,
            JSON.stringify(blockers),
            revoked.rowCount || 0,
            request.id,
            mutation.idempotencyKey,
            JSON.stringify({
              fromStatus: current.status,
              hardDeletePerformed: false,
              completionAvailable: false,
              completionPolicy: "EXTERNAL_RETENTION_POLICY_REQUIRED",
            }),
            actor.userId,
            reason,
          ],
        );
        await writeAdminAudit(client, request, actor, {
          action: "ACCOUNT_DELETION_DECIDED",
          targetType: "ACCOUNT_DELETION_REQUEST",
          targetId: requestId,
          reason,
          before: { status: current.status, blockers: normalizeBlockers(current.blocker_snapshot) },
          after: { status: decision, blockers, hardDeletePerformed: false },
          metadata: { userId: current.user_id, completionAvailable: false },
        });
        await writeOutbox(client, request.id, {
          aggregateType: "ACCOUNT_DELETION_REQUEST",
          aggregateId: requestId,
          eventType: "account.deletion_decided",
          payload: {
            requestId,
            userId: current.user_id,
            decision,
            adminId: actor.userId,
            hardDeletePerformed: false,
          },
        });

        const body = {
          ...deletionSummary(after),
          currentBlockers: blockers,
          approvalEligible: false,
          rejectionAvailable: false,
        };
        await completeIdempotency(client, started.id, {
          statusCode: 200,
          body,
          resourceType: "ACCOUNT_DELETION_REQUEST",
          resourceId: requestId,
        });
        return { replay: false, statusCode: 200, body };
      });

      return sendMutation(reply, result);
    },
  );

  app.post(
    "/v1/admin/account-deletions/:requestId/completion",
    { preHandler: context.auth.requirePermission("account_deletions.review") },
    async (request) => {
      uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
      const input = objectInput(request.body);
      assertOnlyKeys(input, ["reason"]);
      stringInput(input, "reason", { min: 2, max: 1_000 });
      throw conflict("회원탈퇴 완료는 서버의 자동 삭제 작업에서 처리됩니다.");
    },
  );
}
