import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prototype = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/prototype.css", import.meta.url), "utf8");
const profileFixtures = readFileSync(new URL("../src/data/profileFixtures.ts", import.meta.url), "utf8");
const settingsFixtures = readFileSync(new URL("../src/data/settingsFixtures.ts", import.meta.url), "utf8");

test("home exposes an accessible settings action next to search", () => {
  const searchIndex = prototype.indexOf('aria-label="전체 작품 검색"');
  const settingsIndex = prototype.indexOf('aria-label="설정 열기"');
  const pointsIndex = prototype.indexOf('className="header-points"', settingsIndex);
  assert.ok(searchIndex >= 0);
  assert.ok(settingsIndex > searchIndex);
  assert.ok(pointsIndex > settingsIndex);
  assert.match(prototype, /IconGearLine size=\{23\}/);
  assert.match(styles, /\.catalog-search-button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
});

test("settings hub contains every requested group and destination", () => {
  for (const label of [
    "알림 수신 설정",
    "사용자 설정",
    "계정정보 변경",
    "비밀번호 변경",
    "고객센터",
    "공지사항",
    "문의하기",
    "기타",
    "이용약관 및 정책",
    "로그아웃",
    "탈퇴하기",
  ]) assert.ok(prototype.includes(label), `missing ${label}`);

  for (const screen of [
    "createSettingsScreen",
    "createNotificationSettingsScreen",
    "createNoticesScreen",
    "createInquiryScreen",
    "createLegalHubScreen",
    "createAccountDeletionScreen",
  ]) assert.match(prototype, new RegExp(`function ${screen}\\(`));
});

test("notification preferences separate activity and marketing choices", () => {
  for (const key of [
    "orderUpdates",
    "exchangeUpdates",
    "requestUpdates",
    "restockUpdates",
    "marketingSms",
    "marketingEmail",
    "marketingPush",
    "personalizedRecommendations",
  ]) assert.ok(profileFixtures.includes(`${key}:`), `missing ${key}`);
  assert.ok(prototype.includes("필수 알림"));
  assert.ok(prototype.includes("활동 알림"));
  assert.ok(prototype.includes("혜택과 추천"));
});

test("support and legal flows use realistic local data with launch warnings", () => {
  assert.ok(settingsFixtures.includes("SETTINGS_NOTICES"));
  assert.ok(settingsFixtures.includes("SETTINGS_LEGAL_DOCUMENTS"));
  assert.ok(settingsFixtures.includes("LEGAL_RELEASE_CHECKLIST"));
  for (const document of [
    "서비스 이용약관",
    "개인정보 처리방침",
    "구매·청약철회·환불 정책",
    "배송·보관함 정책",
    "포인트·쿠폰 운영정책",
    "교환방·덕룸·신청방 운영정책",
    "가챠·쿠지 정보 제공 정책",
    "오픈소스 라이선스",
  ]) assert.ok(settingsFixtures.includes(document), `missing ${document}`);
  assert.ok(settingsFixtures.includes("법률 전문가의 검토"));
  assert.ok(prototype.includes("실제 문의는 전송되지 않았습니다"));
  assert.ok(prototype.includes("실제 계정이나 데이터는 삭제되지 않았습니다"));
});

test("account deletion is guarded and discloses the external Play deletion path", () => {
  assert.match(prototype, /confirmation\.trim\(\) === "탈퇴"/);
  assert.ok(prototype.includes("탈퇴 요청하기"));
  assert.ok(prototype.includes("Google Play 출시 전에는 앱 밖에서도 접근 가능한 웹 탈퇴 요청 경로"));
  assert.ok(settingsFixtures.includes("앱 내 탈퇴 처리 API와 Google Play용 웹 탈퇴 경로 제공"));
});
