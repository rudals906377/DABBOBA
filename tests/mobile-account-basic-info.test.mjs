import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps/mobile");
const readMobile = (relativePath) => readFileSync(path.join(mobile, relativePath), "utf8");

test("account basic information has a dedicated native editor", () => {
  const route = "app/profile/member/personal/edit.tsx";
  assert.equal(existsSync(path.join(mobile, route)), true, `${route} is missing`);
  assert.match(readMobile(route), /AccountBasicInfoEditScreen/);

  const member = readMobile("src/features/profile/ProfileMemberDetailScreen.tsx");
  assert.match(member, /label="계정 기본정보 수정"[\s\S]*?router\.push\("\/profile\/member\/personal\/edit"/);
  assert.doesNotMatch(member, /label="프로필 닉네임·소개 수정"[\s\S]*?\/profile\/edit/);
  assert.doesNotMatch(member, /010-\*\*\*\*-1234/);
});

test("account basic editor saves only supported fields and returns to account information", () => {
  const screen = readMobile("src/features/profile/AccountBasicInfoEditScreen.tsx");

  assert.match(screen, /<Field[^>]+label="닉네임"/);
  assert.match(screen, /<Field[^>]+label="생년월일"/);
  assert.match(screen, /updateAccountBasicInfo/);
  assert.match(screen, /expectedVersion:\s*basicInfo\.version/);
  assert.match(screen, /router\.replace\("\/profile\/member\/personal"\)/);
  assert.match(screen, /label="이메일"/);
  assert.match(screen, /label="휴대폰"/);
  assert.match(screen, /본인인증 후 변경/);
  assert.doesNotMatch(screen, /body:\s*\{[^}]*email|body:\s*\{[^}]*phone/);
});

test("public profile editing remains a separate nickname and introduction flow", () => {
  const home = readMobile("src/features/profile/ProfileHomeScreen.tsx");
  const sections = readMobile("src/features/profile/ProfileSectionScreen.tsx");
  const editStart = sections.indexOf("function ProfileEdit(");
  const editEnd = sections.indexOf("\nfunction Wishlist(", editStart);
  const profileEdit = sections.slice(editStart, editEnd);

  assert.match(home, /accessibilityLabel="프로필 수정 열기"/);
  assert.match(home, /push\("edit"\)/);
  assert.match(profileEdit, /<FieldLabel label="닉네임"/);
  assert.match(profileEdit, /<FieldLabel label="한 줄 소개"/);
  assert.doesNotMatch(profileEdit, /생년월일|이메일|휴대폰/);
});

test("unfinished account actions are not exposed as working controls", () => {
  const member = readMobile("src/features/profile/ProfileMemberDetailScreen.tsx");

  assert.doesNotMatch(member, /Alert\.alert\("결제수단 등록을 준비하고 있어요"/);
  assert.doesNotMatch(member, /Alert\.alert\("모든 기기에서 로그아웃"/);
  assert.match(member, /label="결제 카드 등록 준비 중"[\s\S]*?disabled/);
  assert.match(member, /label="다른 기기 로그아웃 준비 중"[\s\S]*?disabled/);
});
