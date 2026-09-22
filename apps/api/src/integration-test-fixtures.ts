import { randomUUID } from "node:crypto";
import type { Queryable } from "@dabboba/db";
import {
  loadRequiredPolicyDocuments,
  recordRequiredPolicyAcceptanceEvents,
} from "./lib/legal-policy.js";
import { REQUIRED_UGC_OPERATIONS_POLICY_VERSION } from "./lib/ugc-policy.js";

export async function acceptRequiredPoliciesForIntegrationTest(
  queryable: Queryable,
  userId: string,
): Promise<void> {
  const { documents } = await loadRequiredPolicyDocuments(queryable);
  await recordRequiredPolicyAcceptanceEvents(queryable, {
    userId,
    documents,
    correlationId: `integration-test-${randomUUID()}`,
    source: "MOBILE_LOGIN",
    ipAddress: "127.0.0.1",
    userAgent: "DABBOBA API integration test",
  });
}

export async function acceptUgcOperationsPolicyForIntegrationTest(
  queryable: Queryable,
  userId: string,
): Promise<void> {
  await queryable.query(
    `INSERT INTO user_policy_acceptance_events
      (user_id,policy_key,policy_version,content_sha256,source,correlation_id)
     SELECT $1,document.policy_key,document.policy_version,document.content_sha256,
            'UGC_OPERATION',$3
       FROM legal_document_versions document
      WHERE document.policy_key='OPERATIONS'
        AND document.policy_version=$2
        AND document.superseded_at IS NULL
     ON CONFLICT (user_id,policy_key,policy_version) DO NOTHING`,
    [userId, REQUIRED_UGC_OPERATIONS_POLICY_VERSION, `integration-test-${randomUUID()}`],
  );
}
