import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors.js";
import {
  CONTENT_NOT_ALLOWED_CODE,
  CONTENT_NOT_ALLOWED_MESSAGE,
  SEVERE_TERM_COUNT,
  assertPublicContentAllowed,
  contentFilterWords,
  findContentViolation,
} from "./content-filter.js";

const zeroWidthSpace = String.fromCodePoint(0x200b);
const wordJoiner = String.fromCodePoint(0x2060);
const softHyphen = String.fromCodePoint(0x00ad);
const byteOrderMark = String.fromCodePoint(0xfeff);

function assertBlocked(values: readonly string[], scope: "PUBLIC_PROFILE" | "COMMUNITY" | "MARKETPLACE", kind: string) {
  for (const value of values) {
    assert.equal(findContentViolation(value, scope), kind, `expected ${scope} to block ${JSON.stringify(value)}`);
  }
}

function assertAllowed(values: readonly string[], scope: "PUBLIC_PROFILE" | "COMMUNITY" | "MARKETPLACE") {
  for (const value of values) {
    assert.equal(findContentViolation(value, scope), null, `expected ${scope} to allow ${JSON.stringify(value)}`);
  }
}

test("severe Korean and English terms are blocked in every public scope", () => {
  const severe = [
    "시발", "씨발 진짜", "아 씨팔", "ㅅㅂ", "ㅆㅂ", "병신같은 거래", "ㅄ", "좆같네", "개새끼",
    "섹스", "창녀", "니애미", "느금마", "엠창", "쪽바리", "짱깨", "깜둥이",
    "fuck", "Fucking deal", "motherfucker", "shit", "bullshit!", "cunt", "nigger", "niggas",
    "faggot", "bitch", "whores", "slut", "sex", "porn",
  ];
  for (const scope of ["PUBLIC_PROFILE", "COMMUNITY", "MARKETPLACE"] as const) {
    assertBlocked(severe, scope, "OBJECTIONABLE");
  }
});

test("normalization catches spacing, separators, zero-width characters and width variants", () => {
  assertBlocked([
    "시 발",
    "아 시 발 진짜",
    "시.발",
    "시-발",
    "시_발",
    "시*발",
    "시·발",
    `시${zeroWidthSpace}발`,
    `씨${wordJoiner}발`,
    `병${softHyphen}신`,
    `${byteOrderMark}좆`,
    "ㅅ ㅂ",
    "s.e.x",
    "S E X",
    "s-e-x toy",
    "F*U*C*K",
    "f u c k",
    "ＦＵＣＫ",
    "Ｓｈｉｔ",
    "bull-shit",
  ], "PUBLIC_PROFILE", "OBJECTIONABLE");
  assert.deepEqual(contentFilterWords("아 시 발 다시 발매"), ["아시발", "다시", "발매"]);
  assert.deepEqual(contentFilterWords(`s.e.x${zeroWidthSpace} toy`), ["sex", "toy"]);
});

test("common anime, product and everyday Korean words are not false positives", () => {
  assertAllowed([
    "시바",
    "시바견 피규어",
    "Shiba Inu 키링",
    "보스",
    "보스 베이비",
    "자지러지다",
    "아이가 자지러지게 웃었어요",
    "아직 보지 못했어요",
    "자지 않고 기다렸어요",
    "다시 발매해주세요",
    "혹시 발매되면 알려주세요",
    "출시 발표 기다려요",
    "출시발매 예정",
    "시발점",
    "3시 발매",
    "개 새끼 고양이 키링",
    "섹시 컨셉 일러스트",
    "Sexy Zone 굿즈",
    "unisex 후드",
    "Essex",
    "Scunthorpe",
    "Kinoshita Hideyoshi",
    "Yamashita",
    "Matsushita",
    "push it",
    "snigger",
    "짱구는 못말려",
    "니어 오토마타",
    "병아리 키링",
  ], "MARKETPLACE");
});

test("marketplace text rejects links, phone numbers and messenger contact requests", () => {
  assertBlocked([
    "https://example.com/item",
    "http://abc.kr",
    "www.naver.com",
    "open.kakao.com/o/abcdef",
    "naver . com 으로 오세요",
    "abc@gmail.com",
    "abc@naver",
    "bit.ly/abc",
    "youtu.be/abc",
    "t.me/dabboba",
    "010-1234-5678",
    "010 1234 5678",
    "010.1234.5678",
    "01012345678",
    "0 1 0 - 1 2 3 4 - 5 6 7 8",
    "(010)1234-5678",
    "+82 10-1234-5678",
    "０１０-１２３４-５６７８",
    "011-123-4567",
    "카톡 아이디 abc123",
    "카카오톡 id: abc",
    "카톡ID abc",
    "kakao id dabboba",
    "라인 아이디 알려드려요",
    "오픈채팅 주세요",
    "오픈 채팅방으로 와요",
    "카톡 주세요",
    "카톡으로 연락 주세요",
    "텔레그램으로 연락",
    "인스타 DM 주세요",
    "디엠 주세요",
    "연락처 남겨주세요",
    "전화번호 알려주세요",
  ], "MARKETPLACE", "OFF_PLATFORM_CONTACT");
});

test("prices, quantities, dates, scales and product names are not treated as contact details", () => {
  assertAllowed([
    "12,000원",
    "₩12000",
    "1,000,000원",
    "1/8 스케일",
    "1/7 scale figure",
    "2024년 10월 15일",
    "2024.10.15 발매",
    "2024-10-15",
    "No.1234",
    "No.6",
    "Ver.2",
    "1:1 교환 원해요",
    "수량 2개",
    "JAN 4549660123456",
    "S.H.Figuarts",
    "Dr.STONE",
    "D.Gray-man",
    "K-ON!",
    "Re:Zero",
    "Fate/stay night",
    ".hack//sign",
    "Love Live!",
    "카카오프렌즈 춘식이 피규어",
    "카카오 프렌즈 라이언 인형으로 교환해요",
    "라인업 추가",
    "신규 라인 추가",
    "가이드라인 아이디어",
    "guideline identity",
    "디코레이션 추가",
    "인스타 아디다스 콜라보",
  ], "MARKETPLACE");
});

test("profile and community scopes apply only the objectionable-term category", () => {
  assertAllowed(["010-1234-5678", "https://example.com", "카톡 주세요"], "PUBLIC_PROFILE");
  assertAllowed(["010-1234-5678", "https://example.com", "카톡 주세요"], "COMMUNITY");
  assert.equal(findContentViolation("카톡 주세요 시발", "MARKETPLACE"), "OBJECTIONABLE");
  assert.equal(findContentViolation(null, "MARKETPLACE"), null);
  assert.equal(findContentViolation(undefined, "PUBLIC_PROFILE"), null);
  assert.equal(findContentViolation("", "COMMUNITY"), null);
});

test("violations raise one generic CONTENT_NOT_ALLOWED error without revealing the match", () => {
  assert.doesNotThrow(() => assertPublicContentAllowed("MARKETPLACE", "아냐 교복 피규어", undefined, null, "12,000원"));
  for (const blocked of ["씨발", "010-1234-5678"]) {
    assert.throws(
      () => assertPublicContentAllowed("MARKETPLACE", "정상 제목", blocked),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 400
        && error.code === CONTENT_NOT_ALLOWED_CODE
        && error.message === CONTENT_NOT_ALLOWED_MESSAGE
        && error.details === undefined
        && !error.message.includes(blocked),
    );
  }
  assert.equal(CONTENT_NOT_ALLOWED_MESSAGE, "부적절한 표현이나 외부 연락처가 포함되어 등록할 수 없어요.");
});

test("the severe-term list stays small and long adversarial input stays bounded", () => {
  assert.ok(SEVERE_TERM_COUNT > 0 && SEVERE_TERM_COUNT <= 40, `term list grew to ${SEVERE_TERM_COUNT}`);
  const started = performance.now();
  for (const value of ["a.".repeat(2500), "ab . ".repeat(1000), "0 ".repeat(2500), "시 ".repeat(2500)]) {
    assert.equal(findContentViolation(value, "MARKETPLACE"), null);
  }
  assert.ok(performance.now() - started < 2000);
});
