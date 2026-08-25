import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("draw drafts use same-IP prize-only SKU rows instead of operator-authored JSON", async () => {
  const [page, form] = await Promise.all([
    readFile(join(adminRoot, "app/(admin)/catalog/products/[productId]/draws/page.tsx"), "utf8"),
    readFile(join(adminRoot, "components/draw-version-form.tsx"), "utf8"),
  ]);

  assert.match(page, /prizeOnly: "true"/);
  assert.match(page, /candidate\.isActive/);
  assert.match(page, /candidate\.ipId === product\.ipId/);
  assert.match(page, /<Feedback searchParams=\{query\}/);
  assert.doesNotMatch(page, /EXAMPLE_ENTRIES|prize-product-a|경품 구성 JSON/);
  assert.match(form, /name="entries" value=\{calculation\.serialized\}/);
  assert.match(form, /경품 전용 SKU/);
  assert.match(form, /기본 가중치/);
  assert.match(form, /유한 수량/);
  assert.match(form, /현재 예상 확률/);
});

test("draw draft controls expose capacity and manual physical-lot safeguards", async () => {
  const [form, actions] = await Promise.all([
    readFile(join(adminRoot, "components/draw-version-form.tsx"), "utf8"),
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
  ]);

  assert.match(form, /판매 가용 수량/);
  assert.match(form, /물리 재고 lot 대조 필수/);
  assert.match(form, /lot 원장이 없어 중복 투입을 자동으로 확인하지 못하므로/);
  assert.match(form, /초안은 저장할 수 있지만 공개 전 판매 재고와 물리 lot을 맞춰야 합니다/);
  assert.match(form, /disabled=\{!calculation\.complete\}/);
  assert.match(actions, /같은 경품 SKU를 두 번 이상 입력할 수 없습니다/);
  assert.match(actions, /유한 수량은 1~10,000 정수여야 합니다/);
});

test("catalog product forms distinguish immutable prize-only SKUs", async () => {
  const [forms, page, actions] = await Promise.all([
    readFile(join(adminRoot, "components/catalog-forms.tsx"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/catalog/products/page.tsx"), "utf8"),
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
  ]);

  assert.match(forms, /name="isPrizeOnly"/);
  assert.match(forms, /상품 용도는 생성 후 바꿀 수 없습니다/);
  assert.match(page, /name="prizeOnly"/);
  assert.match(page, /경품 전용/);
  assert.match(actions, /isPrizeOnly: form\.get\("isPrizeOnly"\) === "on"/);
});
