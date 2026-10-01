import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { allocateGachaDrawQuantities, buildDrawVersionDraftPayload } = await import("../lib/draw-version-draft.ts");

test("gacha slots are allocated from the total without operator-entered per-prize counts", () => {
  assert.deepEqual(allocateGachaDrawQuantities(40, 5), [8, 8, 8, 8, 8]);
  assert.deepEqual(allocateGachaDrawQuantities(50, 7), [8, 7, 7, 7, 7, 7, 7]);
  assert.equal(allocateGachaDrawQuantities(4, 5), null);
  assert.equal(allocateGachaDrawQuantities(0, 5), null);
  assert.equal(allocateGachaDrawQuantities(50, 0), null);

  const slots = allocateGachaDrawQuantities(50, 7);
  assert.ok(slots);
  assert.equal(slots.reduce((sum, quantity) => sum + quantity, 0), 50);
  const draft = buildDrawVersionDraftPayload("gacha", slots.map((quantity, index) => ({
    prizeProductId: `prize-${index + 1}`,
    rarity: "일반",
    quantity,
  })));
  assert.equal(draft.entries.length, 7);
  assert.deepEqual(draft.entries.map((entry) => entry.quantity), slots);
  assert.ok(draft.entries.every((entry) => entry.weight === 1));
});

test("draw drafts use same-IP prize-only SKU rows instead of operator-authored JSON", async () => {
  const [page, form] = await Promise.all([
    readFile(join(adminRoot, "app/(admin)/catalog/products/[productId]/draws/page.tsx"), "utf8"),
    readFile(join(adminRoot, "components/draw-version-form.tsx"), "utf8"),
  ]);

  assert.match(page, /prizeOnly: "true"/);
  assert.match(page, /candidate\.isActive/);
  assert.match(page, /candidate\.ipId === product\.ipId/);
  assert.match(page, /전체 장수 \$\{\(version\.totalSlots \?\? 0\)/);
  assert.match(page, /<th>관리 코드<\/th><th>노출 순서<\/th>/);
  assert.match(page, /left\.tierRank \?\? Number\.MAX_SAFE_INTEGER/);
  assert.match(page, /result\.items\[0\]\?\.status === "DRAFT"/);
  assert.match(page, /version\.id === latestDraftId/);
  assert.match(page, /이전 초안 · 최신 초안만 공개할 수 있습니다/);
  assert.match(page, /<Feedback searchParams=\{query\}/);
  assert.doesNotMatch(page, /EXAMPLE_ENTRIES|prize-product-a|경품 구성 JSON/);
  assert.match(form, /name="entries" value=\{calculation\.serialized\}/);
  assert.match(form, /경품 전용 SKU/);
  assert.match(form, /상 이름 \(고객 카드 표시\)/);
  assert.match(form, /남은 수량이 0이 되면 고객 카드에서 자동으로 사라집니다/);
  assert.doesNotMatch(form, /기본 가중치/);
  assert.match(form, /유한 수량/);
  assert.match(form, /초기 예상 확률/);
  assert.match(page, /각 상세상품의 남은 개수를 전체 남은 개수로 나눈 값/);
});

test("draw draft controls auto-allocate gacha slots and keep physical-lot safeguards", async () => {
  const [form, actions, draft] = await Promise.all([
    readFile(join(adminRoot, "components/draw-version-form.tsx"), "utf8"),
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
    readFile(join(adminRoot, "lib/draw-version-draft.ts"), "utf8"),
  ]);

  assert.match(form, /판매 가용 수량/);
  assert.match(form, /물리 재고 lot 대조 필수/);
  assert.match(form, /물리 lot이 중복되지 않는지 공개 전에 대조하세요/);
  assert.match(form, /allocateGachaDrawQuantities\(product\.availableQuantity, entries\.length\)/);
  assert.match(form, /자동 배정 수량/);
  assert.match(form, /isKuji \? <label>유한 수량/);
  assert.match(form, /초안은 저장할 수 있지만 공개 전 판매 재고와 물리 lot을 맞춰야 합니다/);
  assert.match(form, /disabled=\{!calculation\.complete\}/);
  assert.match(form, /전체 쿠지 장수/);
  assert.match(form, /등급 코드 \(tierCode\)/);
  assert.match(form, /등급 순서 \(tierRank, 0부터\)/);
  assert.match(actions, /buildDrawVersionDraftPayload/);
  assert.match(draft, /같은 경품 SKU를 두 번 이상 입력할 수 없습니다/);
  assert.match(draft, /유한 수량은 1~10,000 정수여야 합니다/);
  assert.match(draft, /가챠 경품에는 쿠지 tierRank를 입력할 수 없습니다/);
  assert.match(draft, /봉인 쿠지는 가중치를 사용하지 않습니다/);
  assert.match(draft, /total % entryCount/);
});

test("catalog product forms distinguish immutable prize-only SKUs", async () => {
  const [forms, page, actions, drawForm] = await Promise.all([
    readFile(join(adminRoot, "components/catalog-forms.tsx"), "utf8"),
    readFile(join(adminRoot, "app/(admin)/catalog/products/page.tsx"), "utf8"),
    readFile(join(adminRoot, "lib/actions.ts"), "utf8"),
    readFile(join(adminRoot, "components/draw-version-form.tsx"), "utf8"),
  ]);

  assert.match(forms, /name="isPrizeOnly"/);
  assert.match(forms, /상품 용도는 생성 후 바꿀 수 없습니다/);
  assert.match(page, /name="prizeOnly"/);
  assert.match(page, /구성 상품/);
  assert.match(page, /쿠지 상 구성/);
  assert.match(forms, /등록 후 이어지는 <strong>쿠지 상 구성<\/strong>/);
  assert.match(drawForm, /afterCreate=/);
  assert.match(page, /const afterCreate = first\(query\.afterCreate\)/);
  assert.match(page, /prizeOnly === "true" && afterCreate/);
  assert.match(actions, /isPrizeOnly: form\.get\("isPrizeOnly"\) === "on"/);
  assert.match(actions, /needsKujiConfiguration/);
});
