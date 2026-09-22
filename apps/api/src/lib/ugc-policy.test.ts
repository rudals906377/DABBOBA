import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient, Queryable } from "@dabboba/db";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import {
  REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
  assertUgcOperationsPolicyAccepted,
  recordUgcOperationsPolicyAcceptance,
  ugcOperationsPolicyAcceptance,
} from "./ugc-policy.js";

const userId = "10000000-0000-4000-8000-000000000001";

test("operations-policy lookup accepts only evidence bound to the current document digest", async () => {
  const captured: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const queryable = {
    query: async (sql: string, values?: unknown[]) => {
      captured.push({ sql, values });
      return { rows: [{ accepted_at: "2026-09-20T02:30:00.000Z" }], rowCount: 1 };
    },
  } as unknown as Queryable;

  assert.deepEqual(await ugcOperationsPolicyAcceptance(queryable, userId), {
    policyVersion: REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
    accepted: true,
    acceptedAt: "2026-09-20T02:30:00.000Z",
  });
  assert.match(captured[0]!.sql, /document\.content_sha256=event\.content_sha256/i);
  assert.deepEqual(captured[0]!.values, [userId, REQUIRED_UGC_OPERATIONS_POLICY_VERSION]);
});

test("UGC creation is rejected until the exact operations policy is accepted", async () => {
  const queryable = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Queryable;

  await assert.rejects(
    () => assertUgcOperationsPolicyAccepted(queryable, userId),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 428
      && error.code === "UGC_POLICY_ACCEPTANCE_REQUIRED"
      && error.details?.requiredPolicyVersion === REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
  );
});

test("operations-policy acceptance writes one append-only digest-bound event", async () => {
  const captured: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      captured.push({ sql, values });
      if (sql.includes("FROM legal_document_versions") && sql.includes("FOR SHARE")) {
        return { rows: [{ content_sha256: "a".repeat(64) }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO user_policy_acceptance_events")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [{ accepted_at: "2026-09-20T03:00:00.000Z" }], rowCount: 1 };
    },
  } as unknown as DatabaseClient;
  const request = {
    id: "request-operations-policy-1",
    actor: { userId },
  } as unknown as FastifyRequest;

  const result = await recordUgcOperationsPolicyAcceptance(
    client,
    request,
    REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
  );

  assert.equal(result.accepted, true);
  const insert = captured.find((entry) => entry.sql.includes("INSERT INTO user_policy_acceptance_events"));
  assert.ok(insert);
  assert.match(insert.sql, /ON CONFLICT \(user_id,policy_key,policy_version\) DO NOTHING/i);
  assert.deepEqual(insert.values, [
    userId,
    REQUIRED_UGC_OPERATIONS_POLICY_VERSION,
    "a".repeat(64),
    "request-operations-policy-1",
  ]);
});
