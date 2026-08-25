import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { seedCatalog } from "./seed.js";

test("production seed fails closed without the one-time explicit flag", async () => {
  await assert.rejects(
    seedCatalog("postgresql://unused", { environment: "production" }),
    /Production catalog seed is disabled/,
  );
});

test("catalog seed never rewrites authoritative stock on re-entry", async () => {
  const source = await readFile(new URL("../src/seed.ts", import.meta.url), "utf8");
  const stockStatement = source.match(/INSERT INTO product_stock[\s\S]*?\[product\.id, product\.stock\],/u)?.[0] ?? "";

  assert.match(stockStatement, /ON CONFLICT \(product_id\) DO NOTHING/);
  assert.doesNotMatch(stockStatement, /DO UPDATE SET on_hand/);
});
