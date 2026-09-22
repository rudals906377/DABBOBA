import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("keeps the storefront story in its approved order", () => {
  const sectionIds = ["hero", "experience", "favorites", "storage", "kuji", "prelaunch"];
  let previousIndex = -1;

  for (const sectionId of sectionIds) {
    const currentIndex = appSource.indexOf(`id=\"${sectionId}\"`);
    assert.ok(currentIndex > previousIndex, `${sectionId} must appear after the prior section`);
    previousIndex = currentIndex;
  }
});

test("publishes every required public policy and support route", () => {
  for (const href of ["/terms", "/privacy", "/support", "/account-deletion"]) {
    assert.match(appSource, new RegExp(`href=\"${href.replace("/", "\\/")}\"`));
  }
});

test("shows the agreed storage and delivery rules as future live policies", () => {
  for (const copy of [
    "정식 오픈 후 적용 예정",
    "획득일부터 60일 보관",
    "24,900원 이상 무료 배송",
    "54,900원 이상 무료 배송",
    "배송비 3,000원",
  ]) {
    assert.ok(appSource.includes(copy), `missing policy copy: ${copy}`);
  }
});

test("prelaunch storefront does not expose commerce actions or a zero price", () => {
  for (const forbidden of ["구매하기", "결제하기", "뽑기 시작", ">0원<"]) {
    assert.equal(appSource.includes(forbidden), false, `forbidden storefront copy: ${forbidden}`);
  }
  assert.match(appSource, /PRELAUNCH/);
  assert.match(appSource, /OPENING SOON/);
});

test("keeps accessible interaction and motion fallbacks", () => {
  assert.match(appSource, /className=\"skip-link\"/);
  assert.match(appSource, /aria-label=\"소개 화면 바로가기\"/);
  assert.match(stylesSource, /min-height:\s*44px/);
  assert.match(stylesSource, /prefers-reduced-motion:\s*reduce/);
  assert.match(stylesSource, /scroll-snap-type:\s*y proximity/);
  assert.match(stylesSource, /\.section-label--kuji\s*\{[^}]*var\(--orange-ink\)/s);
});

test("keeps destinations honest and defers below-fold artwork", () => {
  assert.match(appSource, /href=\"\/support\">고객지원 보기/);
  assert.match(appSource, /fetchPriority=\"high\"/);
  assert.match(appSource, /loading=\"lazy\"/);
});

test("ships Korean metadata for a standalone prelaunch page", () => {
  assert.match(indexSource, /<html lang=\"ko\">/);
  assert.match(indexSource, /사전 오픈/);
  assert.match(indexSource, /<title>DABBOBA/);
});
