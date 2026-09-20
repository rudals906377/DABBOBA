import type { Queryable } from "@dabboba/db";
import { AppError } from "./errors.js";

export const FALLBACK_REQUIRED_POLICY_VERSIONS = Object.freeze({
  terms: "2026-09-14",
  privacy: "2026-09-20",
} as const);

export type RequiredPolicyVersions = {
  terms: string;
  privacy: string;
};

export type RequiredPolicyDocument = {
  key: "TERMS" | "PRIVACY";
  version: string;
  contentSha256: string;
};

type LegalDocumentRow = {
  policy_key: RequiredPolicyDocument["key"];
  policy_version: string;
  content_sha256: string;
};

export async function loadRequiredPolicyDocuments(
  queryable: Queryable,
): Promise<{ versions: RequiredPolicyVersions; documents: RequiredPolicyDocument[] }> {
  const result = await queryable.query<LegalDocumentRow>(
    `SELECT policy_key,policy_version,content_sha256
       FROM legal_document_versions
      WHERE policy_key=ANY($1::text[])
        AND superseded_at IS NULL
        AND effective_at<=now()
      ORDER BY policy_key`,
    [["TERMS", "PRIVACY"]],
  );
  const byKey = new Map(result.rows.map((row) => [row.policy_key, row]));
  const terms = byKey.get("TERMS");
  const privacy = byKey.get("PRIVACY");
  if (!terms || !privacy || result.rows.length !== 2) {
    throw new Error("Exactly one effective TERMS and PRIVACY document must be published");
  }
  return {
    versions: { terms: terms.policy_version, privacy: privacy.policy_version },
    documents: [
      { key: "TERMS", version: terms.policy_version, contentSha256: terms.content_sha256 },
      { key: "PRIVACY", version: privacy.policy_version, contentSha256: privacy.content_sha256 },
    ],
  };
}

export async function assertRequiredPolicyAcceptance(
  queryable: Queryable,
  userId: string,
): Promise<RequiredPolicyVersions> {
  const required = await loadRequiredPolicyDocuments(queryable);
  const evidence = await queryable.query<{ accepted_count: string | number }>(
    `SELECT count(*) AS accepted_count
       FROM user_policy_acceptance_events event
       JOIN legal_document_versions document
         ON document.policy_key=event.policy_key
        AND document.policy_version=event.policy_version
        AND document.content_sha256=event.content_sha256
      WHERE event.user_id=$1
        AND document.policy_key=ANY($2::text[])
        AND document.superseded_at IS NULL
        AND document.effective_at<=now()`,
    [userId, ["TERMS", "PRIVACY"]],
  );
  if (Number(evidence.rows[0]?.accepted_count ?? 0) !== required.documents.length) {
    throw new AppError(428, "LEGAL_ACCEPTANCE_REQUIRED", "현재 필수 약관 버전을 다시 확인해 주세요.", {
      requiredPolicyVersions: required.versions,
    });
  }
  return required.versions;
}

export async function recordRequiredPolicyAcceptanceEvents(
  queryable: Queryable,
  input: {
    userId: string;
    documents: readonly RequiredPolicyDocument[];
    correlationId: string;
    source: "MOBILE_LOGIN" | "MOBILE_RECONSENT" | "WEB_ACCOUNT_DELETION";
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  const versions = new Map(input.documents.map((document) => [document.key, document.version]));
  await queryable.query(
    `INSERT INTO user_policy_acceptances
      (user_id,policy_key,policy_version,source,ip_address,user_agent)
     VALUES
      ($1,'TERMS',$2,'MOBILE_LOGIN',$4,$5),
      ($1,'PRIVACY',$3,'MOBILE_LOGIN',$4,$5)
     ON CONFLICT (user_id,policy_key,policy_version) DO NOTHING`,
    [
      input.userId,
      versions.get("TERMS"),
      versions.get("PRIVACY"),
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );
  await queryable.query(
    `INSERT INTO user_policy_acceptance_events
      (user_id,policy_key,policy_version,content_sha256,source,correlation_id)
     SELECT $1,accepted.policy_key,accepted.policy_version,accepted.content_sha256,$2,$3
       FROM jsonb_to_recordset($4::jsonb)
         AS accepted(policy_key text,policy_version text,content_sha256 text)
     ON CONFLICT (user_id,policy_key,policy_version) DO NOTHING`,
    [
      input.userId,
      input.source,
      input.correlationId,
      JSON.stringify(input.documents.map((document) => ({
        policy_key: document.key,
        policy_version: document.version,
        content_sha256: document.contentSha256,
      }))),
    ],
  );
}
