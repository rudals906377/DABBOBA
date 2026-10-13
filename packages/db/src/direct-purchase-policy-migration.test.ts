import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct purchase publication binds the actual terms, privacy and exchange policy bytes to a new version", async () => {
  const migration = await readFile(new URL("../migrations/0099_legal_direct_purchase_2026_10_13.sql", import.meta.url), "utf8");
  for (const [key, folder] of [["TERMS", "terms"], ["PRIVACY", "privacy"], ["OPERATIONS", "community-operations"]]) {
    const bytes = await readFile(new URL(`../../../public/legal/${folder}/index.html`, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.ok(migration.includes(`('${key}','2026-10-13','${hash}'`), `${key} publication hash must match served bytes`);
    assert.match(bytes.toString(), /시행일 2026년 10월 13일/);
  }
  const terms = await readFile(new URL("../../../public/legal/terms/index.html", import.meta.url), "utf8");
  assert.match(terms, /구매할 정확한 상품과 수량을 선택/);
  assert.match(terms, /본인이 직접 구매해 현재 보관 중인 적격/);
  assert.match(terms, /자동 포인트 전환은 현재 제공하지 않습니다/);
  assert.doesNotMatch(terms, /원하는 종류를 고르거나 특정 결과를 보장받을 수 없고/);
});
