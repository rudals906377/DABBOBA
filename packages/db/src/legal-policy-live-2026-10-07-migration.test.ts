import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0090_legal_policy_live_2026_10_07.sql", import.meta.url),
  "utf8",
);

// The LIVE revision is bound to the exact bytes of the published HTML, so the
// expected digests are recomputed from the current public documents.
const revisedDocuments = [
  {
    key: "TERMS",
    path: new URL("../../../public/legal/terms/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/terms",
    previousSha256: "213e14a2499ed6a929c81455e736b5aa3d60f0e05f0d59fe5d9fc662e0782f23",
  },
  {
    key: "PRIVACY",
    path: new URL("../../../public/legal/privacy/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/privacy",
    previousSha256: "6053eb3dd4c02cfe44fb30983910f4a9d7bade3a1f03d8f58a00a490119e89dd",
  },
] as const;

const PRELAUNCH_LEGAL_MARKERS = /사전오픈판|결제(?:와|·주문·뽑기·배송 신청은).*제공하지 않습니다/;

test("publishes the LIVE 2026-10-07 policy revision as a new version bound to the current HTML", async () => {
  const source = await migration;

  assert.match(source, /Unexpected current TERMS\/PRIVACY evidence before the LIVE 2026-10-07 revision/i);
  assert.match(source, /SET superseded_at = '2026-10-07T00:00:00\+09:00'/i);
  assert.doesNotMatch(source, /'OPERATIONS'/);

  for (const document of revisedDocuments) {
    const html = await readFile(document.path);
    const digest = createHash("sha256").update(html).digest("hex");
    assert.notEqual(digest, document.previousSha256, `${document.key} content must differ from the 2026-09-30 version`);
    assert.match(source, new RegExp(`'${document.key}'[\\s\\S]*?'2026-09-30'[\\s\\S]*?'${document.previousSha256}'`, "i"));
    assert.match(
      source,
      new RegExp(
        `\\('${document.key}','2026-10-07','${digest}'[\\s\\S]*?'${document.publicUrl.replaceAll(".", "\\.")}','2026-10-07T00:00:00\\+09:00'\\)`,
        "i",
      ),
    );
    const text = html.toString("utf8");
    assert.match(text, /시행일 2026년 10월 7일/);
    assert.match(text, /<a href="tel:0319479996">031-947-9996<\/a>/);
    assert.doesNotMatch(text, PRELAUNCH_LEGAL_MARKERS);
    assert.doesNotMatch(text, /010-6374-4900|01063744900/);
  }
});

test("the LIVE terms and privacy policy state the owner's launch decisions", async () => {
  const terms = await readFile(revisedDocuments[0].path, "utf8");
  const privacy = await readFile(revisedDocuments[1].path, "utf8");

  // Login is Kakao, Naver, Google and Apple only (2026-10-07 decision).
  assert.match(terms, /휴대폰 문자 인증 로그인은 제공하지 않습니다/);
  assert.doesNotMatch(privacy, /Twilio|휴대폰 문자 로그인/);
  // Shipping fee rule and storage baseline.
  assert.match(terms, /24,900원 이상이면 무료배송/);
  assert.match(terms, /54,900원 이상일 때 무료배송/);
  assert.match(terms, /배송비 3,000원/);
  assert.match(terms, /기본 보관기간은 획득일로부터 60일/);
  // Point return basis: 50% of the prize product's own reference price.
  assert.match(terms, /서버 기준금액의 50%/);
  // Partial refund of unused draws.
  assert.match(terms, /사용하지 않은 뽑기만 환불/);
  // Privacy: processors, Seoul storage, 3-month session records, no personalized recommendation consent.
  assert.match(privacy, /네이버 주식회사\(네이버 메일\)/);
  assert.match(privacy, /데이터 저장 위치 대한민국\(서울\)/);
  assert.match(privacy, /세션 만료·폐기 후 3개월/);
  assert.doesNotMatch(privacy, /맞춤 추천/);
  assert.match(privacy, /이전 방침\(2026년 9월 30일 시행\)/);
  assert.match(terms, /이전 약관\(2026년 9월 30일 시행\)/);
});
