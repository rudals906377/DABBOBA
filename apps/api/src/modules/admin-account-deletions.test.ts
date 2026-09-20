import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  accountDeletionCompletionAvailable,
  allowedAccountDeletionDecision,
  hasAccountDeletionBlockers,
} from "./admin-account-deletions.js";

const clearBlockers = {
  pointBalance: 0,
  activeOrderCount: 0,
  activePaymentCount: 0,
  availableDrawEntitlementCount: 0,
  activeInventoryCount: 0,
  activeShippingRequestCount: 0,
  activeExchangeListingCount: 0,
  activeExchangeOfferCount: 0,
};

test("account deletion decisions allow only rejection fallback from open review states", () => {
  assert.equal(allowedAccountDeletionDecision("PENDING_REVIEW", "APPROVED"), false);
  assert.equal(allowedAccountDeletionDecision("PENDING_REVIEW", "REJECTED"), true);
  assert.equal(allowedAccountDeletionDecision("BLOCKED", "APPROVED"), false);
  assert.equal(allowedAccountDeletionDecision("BLOCKED", "REJECTED"), true);
  assert.equal(allowedAccountDeletionDecision("APPROVED", "REJECTED"), false);
  assert.equal(allowedAccountDeletionDecision("REJECTED", "APPROVED"), false);
  assert.equal(allowedAccountDeletionDecision("COMPLETED", "REJECTED"), false);
});

test("approval blocker detection covers every durable asset and workflow count", () => {
  assert.equal(hasAccountDeletionBlockers(clearBlockers), false);
  for (const key of Object.keys(clearBlockers) as Array<keyof typeof clearBlockers>) {
    assert.equal(hasAccountDeletionBlockers({ ...clearBlockers, [key]: 1 }), true, key);
  }
});

test("admin routes cannot enter the personal-data completion step", () => {
  assert.equal(accountDeletionCompletionAvailable("APPROVED"), false);
  assert.equal(accountDeletionCompletionAvailable("PENDING_REVIEW"), false);
  assert.equal(accountDeletionCompletionAvailable("BLOCKED"), false);
  assert.equal(accountDeletionCompletionAvailable("COMPLETED"), false);
  assert.equal(accountDeletionCompletionAvailable("REJECTED"), false);
});

test("admin completion is disabled before the legacy transaction can run", async () => {
  const source = await readFile(new URL("../../src/modules/admin-account-deletions.ts", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('"/v1/admin/account-deletions/:requestId/completion"'));
  assert.match(route, /throw conflict\("회원탈퇴 완료는 서버의 자동 삭제 작업에서 처리됩니다\."\)/);
  assert.doesNotMatch(route, /withTransaction|DELETE FROM auth_identities|UPDATE users/);
});

test("admin account deletion migration keeps decisions reviewed, attributed, and non-destructive", async () => {
  const migration = await readFile(
    new URL("../../../../packages/db/migrations/0012_admin_account_deletion_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /account_deletions\.read/);
  assert.match(migration, /account_deletions\.review/);
  assert.match(migration, /decided_by_admin_id uuid REFERENCES users/);
  assert.match(migration, /account_deletion_request_events_admin_decision_check/);
  assert.match(migration, /account_deletion_requests_transition_guard/);
  assert.match(migration, /OLD\.status = 'APPROVED' AND NEW\.status = 'COMPLETED'/);
  assert.doesNotMatch(migration, /DELETE FROM users|UPDATE users SET status='DELETED'|anonym/i);
});

test("approved deletion serializes and rejects later customer mutations", async () => {
  const migration = await readFile(
    new URL("../../../../packages/db/migrations/0014_account_deletion_mutation_gate.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /account-mutation:/);
  assert.match(migration, /status = 'APPROVED'/);
  assert.match(migration, /BEFORE INSERT ON idempotency_keys/);
  assert.match(migration, /account_deletion_approved_mutation_guard/);
});
