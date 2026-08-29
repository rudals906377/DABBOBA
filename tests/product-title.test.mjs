import assert from "node:assert/strict";
import test from "node:test";
import { productSubjectTitle } from "../apps/mobile/src/features/shop/product-title.ts";

test("product detail removes the repeated IP name and keeps the remaining subject", () => {
  assert.equal(
    productSubjectTitle(
      "극장판 전생했더니 슬라임이었던 건에 대하여 창해의 눈물편 이치방쿠지",
      "전생했더니 슬라임이었던 건에 대하여",
    ),
    "극장판 창해의 눈물편 이치방쿠지",
  );
  assert.equal(
    productSubjectTitle("도쿄 리벤저스 천축편 이치방쿠지", "도쿄 리벤저스"),
    "천축편 이치방쿠지",
  );
  assert.equal(
    productSubjectTitle("스파이 패밀리 - 푸니톱 캡슐 봉제 마스코트 2", "스파이 패밀리"),
    "푸니톱 캡슐 봉제 마스코트 2",
  );
});

test("product detail keeps the original title when the IP is absent or the whole title", () => {
  assert.equal(productSubjectTitle("포켓몬 카드게임 확장팩 스톰 에메랄다", "포켓몬스터"), "포켓몬 카드게임 확장팩 스톰 에메랄다");
  assert.equal(productSubjectTitle("원피스", "원피스"), "원피스");
});
