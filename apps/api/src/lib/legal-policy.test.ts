import assert from "node:assert/strict";
import test from "node:test";
import type { Queryable } from "@dabboba/db";
import { loadRequiredPolicyDocuments } from "./legal-policy.js";

test("required policy versions come from the two effective published documents", async () => {
  const queryable = {
    async query() {
      return {
        rowCount: 2,
        rows: [
          { policy_key: "PRIVACY", policy_version: "2026-09-22", content_sha256: "b".repeat(64) },
          { policy_key: "TERMS", policy_version: "2026-09-22", content_sha256: "a".repeat(64) },
        ],
      };
    },
  } as unknown as Queryable;
  assert.deepEqual(await loadRequiredPolicyDocuments(queryable), {
    versions: { terms: "2026-09-22", privacy: "2026-09-22" },
    documents: [
      { key: "TERMS", version: "2026-09-22", contentSha256: "a".repeat(64) },
      { key: "PRIVACY", version: "2026-09-22", contentSha256: "b".repeat(64) },
    ],
  });
});

test("required policy loading fails closed when one current document is absent", async () => {
  const queryable = {
    async query() {
      return {
        rowCount: 1,
        rows: [{ policy_key: "TERMS", policy_version: "2026-09-22", content_sha256: "a".repeat(64) }],
      };
    },
  } as unknown as Queryable;
  await assert.rejects(() => loadRequiredPolicyDocuments(queryable), /Exactly one effective TERMS and PRIVACY/);
});
