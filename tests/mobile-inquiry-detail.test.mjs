import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const apiSource = read("apps/mobile/src/features/profile/inquiry-api.ts");
const createSource = read("apps/mobile/src/features/profile/InquiryCreateScreen.tsx");
const detailSource = read("apps/mobile/src/features/profile/InquiryDetailScreen.tsx");
const createRouteSource = read("apps/mobile/app/profile/inquiries/new.tsx");
const detailRouteSource = read("apps/mobile/app/profile/inquiries/[inquiryId].tsx");

test("native inquiry routes expose footer-free compose and conversation screens", () => {
  assert.match(createRouteSource, /InquiryCreateScreen/);
  assert.match(detailRouteSource, /InquiryDetailScreen/);
  assert.match(createSource, /KoreanPixelTitle variant="header">1:1 문의 작성/);
  assert.match(detailSource, /KoreanPixelTitle variant="header">문의 내역/);
  assert.match(createSource, /paddingHorizontal: seed\.spacing\.globalGutter/);
  assert.match(detailSource, /paddingHorizontal: seed\.spacing\.globalGutter/);
  assert.doesNotMatch(createSource, /RootFloatingTabBar|ROOT_NAVIGATION_CONTENT_INSET/);
  assert.doesNotMatch(detailSource, /RootFloatingTabBar|ROOT_NAVIGATION_CONTENT_INSET/);
});

test("inquiry API uses the generated create, detail, and reply contracts", () => {
  assert.match(apiSource, /client\.POST\("\/v1\/inquiries"/);
  assert.match(apiSource, /"Idempotency-Key": randomUUID\(\)/);
  assert.match(apiSource, /client\.GET\("\/v1\/inquiries\/\{inquiryId\}"/);
  assert.match(apiSource, /client\.POST\("\/v1\/inquiries\/\{inquiryId\}\/messages"/);
  assert.match(apiSource, /createExampleInquiry/);
  assert.match(apiSource, /appendExampleInquiryMessage/);
});

test("compose collects the complete contract and requires login before server receipt", () => {
  for (const field of ["category", "title", "content"]) {
    assert.match(createSource, new RegExp(field));
  }
  assert.match(createSource, /TITLE_LIMIT = 160/);
  assert.match(createSource, /CONTENT_LIMIT = 10_000/);
  assert.match(createSource, /createInquiry\(/);
  assert.match(createSource, /로그인이 필요해요/);
  assert.doesNotMatch(createSource, /화면 예시/);
});

test("detail renders the conversation and only sends authenticated follow-up messages", () => {
  assert.match(detailSource, /fetchInquiryDetail\(/);
  assert.match(detailSource, /addInquiryMessage\(/);
  assert.match(detailSource, /fetchExampleInquiryDetail\(/);
  assert.match(detailSource, /detail\.messages\.map/);
  assert.match(detailSource, /authorRole === "USER"/);
  assert.match(detailSource, /status === "CLOSED"/);
  assert.match(detailSource, /추가 답변 보내기/);
  assert.doesNotMatch(detailSource, /화면 예시/);
});
