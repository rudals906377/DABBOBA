import type { DatabaseClient, Queryable } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import { AppError, badRequest } from "./errors.js";

export const REQUIRED_UGC_OPERATIONS_POLICY_VERSION = "2026-09-20" as const;

type UgcPolicyAcceptanceRow = {
  accepted_at: Date | string;
};

export async function ugcOperationsPolicyAcceptance(
  queryable: Queryable,
  userId: string,
) {
  const result = await queryable.query<UgcPolicyAcceptanceRow>(
    `SELECT event.accepted_at
       FROM user_policy_acceptance_events event
       JOIN legal_document_versions document
         ON document.policy_key=event.policy_key
        AND document.policy_version=event.policy_version
        AND document.content_sha256=event.content_sha256
      WHERE event.user_id=$1
        AND event.policy_key='OPERATIONS'
        AND event.policy_version=$2
        AND document.superseded_at IS NULL
      ORDER BY event.accepted_at DESC,event.id DESC
      LIMIT 1`,
    [userId, REQUIRED_UGC_OPERATIONS_POLICY_VERSION],
  );
  const acceptedAt = result.rows[0]?.accepted_at;
  return {
    policyVersion: REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
    accepted: Boolean(acceptedAt),
    acceptedAt: acceptedAt ? new Date(acceptedAt).toISOString() : null,
  };
}

export async function assertUgcOperationsPolicyAccepted(
  queryable: Queryable,
  userId: string,
): Promise<void> {
  const acceptance = await ugcOperationsPolicyAcceptance(queryable, userId);
  if (acceptance.accepted) return;
  throw new AppError(
    428,
    "UGC_POLICY_ACCEPTANCE_REQUIRED",
    "교환방·신청방·덕룸 운영정책에 동의한 뒤 작성할 수 있습니다.",
    { requiredPolicyVersion: REQUIRED_UGC_OPERATIONS_POLICY_VERSION },
  );
}

export async function recordUgcOperationsPolicyAcceptance(
  client: DatabaseClient,
  request: FastifyRequest,
  policyVersion: string,
) {
  if (policyVersion !== REQUIRED_UGC_OPERATIONS_POLICY_VERSION) {
    throw badRequest("현재 교환방·신청방·덕룸 운영정책을 다시 확인해 주세요.", {
      requiredPolicyVersion: REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
    });
  }
  const document = await client.query<{ content_sha256: string }>(
    `SELECT content_sha256
       FROM legal_document_versions
      WHERE policy_key='OPERATIONS' AND policy_version=$1 AND superseded_at IS NULL
      FOR SHARE`,
    [policyVersion],
  );
  if (!document.rowCount) {
    throw new AppError(
      503,
      "UGC_POLICY_UNAVAILABLE",
      "현재 운영정책을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
  await client.query(
    `INSERT INTO user_policy_acceptance_events
      (user_id,policy_key,policy_version,content_sha256,source,correlation_id)
     VALUES($1,'OPERATIONS',$2,$3,'UGC_OPERATION',$4)
     ON CONFLICT (user_id,policy_key,policy_version) DO NOTHING`,
    [request.actor!.userId, policyVersion, document.rows[0]!.content_sha256, request.id],
  );
  return ugcOperationsPolicyAcceptance(client, request.actor!.userId);
}
