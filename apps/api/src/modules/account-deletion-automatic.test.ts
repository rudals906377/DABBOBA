import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Resolve through src so the same source-boundary assertion works both under
// tsx and after tests are compiled into dist/modules.
const accountSource = readFile(new URL("../../src/modules/account.ts", import.meta.url), "utf8");
const workerSource = readFile(
  new URL("../../../worker/src/supabase-auth-deletion.ts", import.meta.url),
  "utf8",
);

test("customer deletion exposes preview, queues processing, and returns a hashed receipt status token", async () => {
  const source = await accountSource;
  assert.match(source, /\/v1\/account\/deletion-preview/);
  assert.match(source, /\/v1\/account\/deletion-requests\/:requestId\/status/);
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(source, /createHash\("sha256"\)\.update\(token\)\.digest\("hex"\)/);
  assert.match(source, /function accountDeletionStatus[\s\S]{0,220}\? "BLOCKED" : "PROCESSING"/);
  assert.match(source, /assessedStatus[^\n]*accountDeletionStatus\(blockers\)/);
  assert.match(source, /INSERT INTO account_auth_deletion_jobs/);
  assert.doesNotMatch(source, /DELETE FROM auth_identities/);
  assert.doesNotMatch(source, /SET email=NULL,phone_e164=NULL/);
});

test("account legal status stays scoped to login policies when other immutable policies are published", async () => {
  const source = await accountSource;
  assert.match(source, /document\.policy_key=ANY\(\$2::text\[\]\)/);
  assert.match(source, /\[request\.actor!\.userId, \["TERMS", "PRIVACY"\]\]/);
  assert.match(source, /post\("\/v1\/account\/policy-acceptances"[\s\S]{0,120}requireUserWithoutPolicy/);
  assert.match(source, /source: "MOBILE_RECONSENT"/);
});

test("worker verifies blockers and external deletion before local anonymization", async () => {
  const source = await workerSource;
  const blockers = source.indexOf("await deletionHasBlockers");
  const appleRevoke = source.indexOf("await appleClient.revokeRefreshToken");
  const appleMarker = source.indexOf("SET apple_revoked_at=now()");
  const externalDelete = source.indexOf("await client.deleteUser");
  const externalMarker = source.indexOf("SET external_deleted_at=now()");
  const storageCleanup = source.indexOf("await deleteAuthoredMediaObjects");
  const localFinalize = source.indexOf("await finalizeLocalAccountDeletion");
  assert.ok(blockers >= 0 && blockers < externalDelete);
  assert.ok(blockers < appleRevoke && appleRevoke < appleMarker && appleMarker < externalDelete);
  assert.ok(externalDelete < externalMarker && externalMarker < storageCleanup && storageCleanup < localFinalize);
  assert.match(source, /response\.ok \|\| response\.status === 404/);
  assert.match(source, /DELETE FROM auth_identities WHERE user_id=\$1/);
  assert.match(source, /"PROFILE",[\s\S]*"INQUIRY",[\s\S]*"EXCHANGE",[\s\S]*"CATALOG_REQUEST",[\s\S]*"WANTED_REQUEST"/);
  assert.match(source, /UPDATE inquiry_messages[\s\S]{0,180}SET content='삭제된 문의 내용'/);
  assert.match(source, /UPDATE inquiries SET title='삭제된 문의'/);
  assert.match(source, /SET status='COMPLETED'/);
});
