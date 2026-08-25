import type { DatabaseClient } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import type { Actor } from "../plugins/auth.js";
import { badRequest, forbidden } from "./errors.js";

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim();
}

export function adminMutationHeaders(request: FastifyRequest, bodyReason?: string | null) {
  const reason = headerValue(request, "x-admin-reason");
  if (!reason || reason.length < 2 || reason.length > 1_000) {
    throw badRequest("X-Admin-Reason 헤더에 2~1000자의 처리 사유가 필요합니다.");
  }
  if (bodyReason !== undefined && bodyReason !== null && bodyReason.trim() !== reason) {
    throw badRequest("본문과 X-Admin-Reason의 처리 사유가 일치해야 합니다.");
  }
  const idempotencyKey = headerValue(request, "idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw badRequest("16자 이상의 올바른 Idempotency-Key 헤더가 필요합니다.");
  }
  return { reason, idempotencyKey };
}

export async function writeAdminAudit(
  client: DatabaseClient,
  request: FastifyRequest,
  actor: Actor,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  const mutation = adminMutationHeaders(request, input.reason);
  const identity = await client.query<{ ip_address: string | null; user_agent: string | null }>(
    `SELECT host(ip_address) AS ip_address,user_agent FROM sessions
     WHERE id=$1 AND user_id=$2 AND session_kind='ADMIN'
     FOR SHARE`,
    [actor.sessionId, actor.userId],
  );
  if (!identity.rowCount) throw forbidden("유효한 관리자 세션의 감사 식별 정보를 확인할 수 없습니다.");
  await client.query(
    `INSERT INTO admin_audit_logs
      (admin_id, action, target_type, target_id, reason, request_id, idempotency_key, before_state, after_state, metadata, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      actor.userId,
      input.action,
      input.targetType,
      input.targetId,
      mutation.reason,
      request.id,
      mutation.idempotencyKey,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      JSON.stringify(input.metadata || {}),
      identity.rows[0]!.ip_address,
      identity.rows[0]!.user_agent,
    ],
  );
}

export async function writeOutbox(
  client: DatabaseClient,
  requestId: string,
  input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; availableAt?: Date },
) {
  await client.query(
    `INSERT INTO outbox_events
      (aggregate_type, aggregate_id, event_type, payload, correlation_id, available_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      JSON.stringify(input.payload),
      requestId,
      input.availableAt || new Date(),
    ],
  );
}
