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

test("review form records only approval or rejection and exposes no destructive completion control", async () => {
  const [actions, detailPage] = await Promise.all([
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/account-deletions/[requestId]/page.tsx"), "utf8"),
  ]);
  assert.match(actions, /ACCOUNT_DELETION_DECISIONS = \["APPROVED", "REJECTED"\]/);
  assert.match(actions, /\/v1\/admin\/account-deletions\/\$\{id\(form, "requestId"\)\}\/decision/);
  assert.match(detailPage, /실제 삭제나 익명화는 별도 보존 정책과 수동 절차가 마련되기 전까지 제공되지 않습니다/);
  assert.doesNotMatch(actions, /hard.?delete|anonym|COMPLETED/i);
  assert.doesNotMatch(detailPage, /계정 삭제 실행|완료 처리|hard.?delete/i);
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
