import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("account deletion queue is permission-gated and reachable from admin navigation", async () => {
  const [capabilities, navigation, listPage, detailPage] = await Promise.all([
    readFile(join(adminRoot, "lib/capabilities.ts"), "utf8"),
    readFile(join(adminRoot, "lib/navigation.ts"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/account-deletions/page.tsx"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/account-deletions/[requestId]/page.tsx"), "utf8"),
  ]);
  assert.match(capabilities, /accountDeletions\.manage["']:\s*\["account_deletions\.read", "account_deletions\.review"\]/);
  assert.match(navigation, /href: "\/account-deletions"/);
  assert.match(listPage, /requireCapability\("accountDeletions\.manage"\)/);
  assert.match(detailPage, /requireCapability\("accountDeletions\.manage"\)/);
});

test("account deletion is monitored as an automatic worker flow without manual approval or completion controls", async () => {
  const [actions, detailPage, listPage] = await Promise.all([
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/account-deletions/[requestId]/page.tsx"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/account-deletions/page.tsx"), "utf8"),
  ]);
  assert.match(actions, /ACCOUNT_DELETION_DECISIONS = \["APPROVED", "REJECTED"\]/);
  assert.match(actions, /\/v1\/admin\/account-deletions\/\$\{id\(form, "requestId"\)\}\/decision/);
  assert.match(actions, /export async function completeAccountDeletion/);
  assert.match(actions, /\/v1\/admin\/account-deletions\/\$\{id\(form, "requestId"\)\}\/completion/);
  assert.match(detailPage, /자동 삭제 worker 처리 중/);
  assert.match(detailPage, /detail\.deletionJob/);
  assert.match(detailPage, /name="decision" value="REJECTED"/);
  assert.doesNotMatch(detailPage, /completeAccountDeletion/);
  assert.doesNotMatch(detailPage, /개인정보 제거 후 탈퇴 완료/);
  assert.doesNotMatch(detailPage, /value="APPROVED"/);
  assert.match(detailPage, /detail\.authDeletionStatus/);
  assert.match(listPage, /"PROCESSING"/);
  assert.match(listPage, /관리자 승인 없이 진행되는/);
});

test("generic user status controls cannot submit account deletion", async () => {
  const [actions, userDetailPage] = await Promise.all([
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/users/[userId]/page.tsx"), "utf8"),
  ]);
  const actionStart = actions.indexOf("export async function changeUserStatus");
  const actionEnd = actions.indexOf("export async function decideAccountDeletion", actionStart);
  const genericStatusAction = actions.slice(actionStart, actionEnd);

  assert.match(actions, /USER_MANAGEABLE_STATUSES = \["ACTIVE", "SUSPENDED", "BANNED"\]/);
  assert.match(userDetailPage, /SUPER_ADMIN" \? \["ACTIVE", "SUSPENDED", "BANNED"\] : \["ACTIVE", "SUSPENDED"\]/);
  assert.match(userDetailPage, /const isDeleted = user\.status === "DELETED"/);
  assert.match(userDetailPage, /isDeleted \? <p className="muted">[\s\S]*?href=\{`\/account-deletions\?q=\$\{encodeURIComponent\(user\.id\)\}`\}/);
  assert.match(userDetailPage, /: <form className="stack-form" action=\{changeUserStatus\}>/);
  assert.doesNotMatch(genericStatusAction, /DELETED/);
  assert.doesNotMatch(userDetailPage, /\["ACTIVE", "SUSPENDED", "BANNED", "DELETED"\]/);
});
