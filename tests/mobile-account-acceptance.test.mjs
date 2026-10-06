import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("customer-authored and policy titles keep dynamic text on the readable face", () => {
  const wanted = read("apps/mobile/src/features/profile/WantedRequestDetailScreen.tsx");
  const policy = read("apps/mobile/src/features/profile/ProfilePolicyDetailScreen.tsx");

  assert.match(wanted, /<ReadablePageTitle[^>]*style=\{styles\.title\}[^>]*>\{request\.desiredItem\}<\/ReadablePageTitle>/);
  assert.doesNotMatch(wanted, /<KoreanPixelTitle[^>]*>\{request\.desiredItem\}<\/KoreanPixelTitle>/);
  assert.match(policy, /<ReadablePageTitle[^>]*numberOfLines=\{2\}[^>]*>\{policy\.title\}<\/ReadablePageTitle>/);
  assert.doesNotMatch(policy, /<KoreanPixelTitle[^>]*>\{policy\.title\}<\/KoreanPixelTitle>/);
});

test("exchange detail keeps its fixed heading pixel-styled and its proposal count readable", () => {
  const detail = read("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx");

  assert.match(detail, /<KoreanPixelTitle[^>]*>들어온 제안<\/KoreanPixelTitle>/);
  assert.match(detail, /<Text style=\{styles\.proposalCount\}>\{detail\.proposals\.length\}개<\/Text>/);
  assert.doesNotMatch(detail, /<KoreanPixelTitle[^>]*>들어온 제안 \{detail\.proposals\.length\}개<\/KoreanPixelTitle>/);
});

test("account status, role, and notification switches are customer-readable and accessible", () => {
  const member = read("apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx");

  for (const [raw, label] of [
    ["ACTIVE", "정상 이용 중"],
    ["SUSPENDED", "일시 이용 정지"],
    ["BANNED", "이용 제한"],
    ["DELETED", "탈퇴 처리됨"],
    ["USER", "일반 회원"],
    ["ADMIN", "관리자"],
    ["SUPER_ADMIN", "최고 관리자"],
  ]) {
    assert.match(member, new RegExp(`${raw}: "${label}"`));
  }
  assert.match(member, /value=\{accountStatusLabel\(snapshot\.actor\?\.status\)\}/);
  assert.match(member, /value=\{accountRoleLabel\(snapshot\.actor\?\.role\)\}/);
  assert.match(member, /style=\{styles\.switchTouchTarget\}/);
  assert.match(member, /hitSlop=\{SWITCH_HIT_SLOP\}/);
  assert.match(member, /switchTouchTarget:\s*\{[^}]*height:\s*seed\.size\.touchTarget/);
});

test("storage uses the approved three visible customer tab labels", () => {
  const storage = read("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");

  assert.match(storage, /<StorageModeTab label="보관 중"/);
  assert.match(storage, /<StorageModeTab label="교환 또는 배송 중인 상품"/);
  assert.match(storage, /<StorageModeTab label="포인트 환급"/);
  assert.doesNotMatch(storage, /<StorageModeTab label="교환·배송 중"/);
});

test("account deletion previews blockers, preserves blocked sessions, and stores a receipt before logout", () => {
  const member = read("apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx");
  const api = read("apps/mobile/src/features/profile/account-detail-api.ts");

  assert.match(member, /await fetchAccountDeletionPreview/);
  assert.match(member, /if \(!preview\.canDeleteNow\)/);
  // Points never block alone: the customer explicitly forfeits the exact balance.
  assert.match(member, /if \(preview\.canDeleteWithPointForfeiture\) \{\s*forfeitPointBalance = preview\.blockers\.pointBalance;/);
  assert.match(member, /탈퇴와 함께 소멸하고 되돌릴 수 없어요/);
  assert.match(member, /"포인트 포기하고 탈퇴"/);
  assert.match(api, /forfeitPointBalance && forfeitPointBalance > 0 \? \{ forfeitPointBalance \} : \{\}/);
  assert.match(member, /await storeAccountDeletionReceipt/);
  assert.match(member, /readAccountDeletionReceipt/);
  assert.match(member, /fetchAccountDeletionStatusByReceipt/);
  assert.match(member, /로그아웃된 뒤에도 이 기기에 안전하게 저장된 접수증/);
  const blocked = member.indexOf('if (result.status === "BLOCKED")');
  const clearDeviceState = member.indexOf("await clearAccountDeviceState({", blocked);
  assert.ok(blocked >= 0 && clearDeviceState > blocked, "blocked branch must return before local logout");
  assert.match(api, /expo-secure-store/);
  assert.match(api, /X-Deletion-Status-Token/);
  assert.match(api, /\^\[A-Za-z0-9_-\]\{43\}\$/);
});

test("profile consent status shows the exact server policy version and acceptance time", () => {
  const member = read("apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx");
  assert.match(member, /fetchAccountPolicyAcceptances/);
  assert.match(member, /document\.version/);
  assert.match(member, /formatDate\(document\.acceptedAt\)/);
});

test("Apple login forwards only the broker refresh token for server-side deletion revocation", () => {
  const broker = read("apps/mobile/src/features/auth/supabase-broker.ts");
  const api = read("apps/mobile/src/features/auth/auth-api.ts");
  assert.match(broker, /session\.provider_refresh_token/);
  assert.match(broker, /pending\.provider === "APPLE"/);
  assert.doesNotMatch(broker, /appleAuthorizationCode/);
  assert.match(api, /loginProvider/);
  assert.match(api, /appleRefreshToken/);
});
