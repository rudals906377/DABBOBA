import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
test("included-product revision preserves prior documents and binds current policy bytes",async()=>{
 const sql=await readFile(new URL("../migrations/0100_included_products_portone_review.sql",import.meta.url),"utf8");
 for(const [key,folder] of [["TERMS","terms"],["PRIVACY","privacy"],["OPERATIONS","community-operations"]]) {
  const bytes=await readFile(new URL(`../../../public/legal/${folder}/index.html`,import.meta.url));
  const hash=createHash("sha256").update(bytes).digest("hex");
  assert.ok(sql.includes(`('${key}','2026-10-13-r2','${hash}'`));
  assert.match(bytes.toString(),/개정 2판/);
 }
 const terms=await readFile(new URL("../../../public/legal/terms/index.html",import.meta.url),"utf8");
 assert.match(terms,/포함된 상품 중 1개/);assert.match(terms,/개별 상품을 지정할 수 없습니다/);assert.match(terms,/같은 상품/);
 assert.match(terms,/자동 포인트 전환은 현재 제공하지 않습니다/);assert.match(terms,/쿠지 상품은 준비 중/);
 assert.doesNotMatch(sql,/DELETE FROM|UPDATE public.product_stock|DROP TABLE/);
});
