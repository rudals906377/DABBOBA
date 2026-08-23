import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(path.join(root, "src/fixtures/ip-seed.json"), "utf8"));
const sources = JSON.parse(readFileSync(path.join(root, "public/assets/dabboba/ips/sources.json"), "utf8"));
const products = JSON.parse(readFileSync(path.join(root, "src/fixtures/product-seed.json"), "utf8"));
const productSources = JSON.parse(
  readFileSync(path.join(root, "public/assets/dabboba/products/ip/sources.json"), "utf8"),
);

const normalize = (value) => value
  .normalize("NFKC")
  .toLocaleLowerCase("ko-KR")
  .replace(/[\s\p{P}\p{S}]+/gu, "");

const search = (query) => catalog.filter((ip) =>
  [ip.nameKo, ip.nameEn, ip.nameJa, ...ip.aliases]
    .map(normalize)
    .some((candidate) => candidate.includes(normalize(query))),
);

test("catalog contains every explicitly named IP with unique IDs and local images", () => {
  assert.equal(catalog.length, 25);
  assert.equal(new Set(catalog.map((ip) => ip.id)).size, catalog.length);
  assert.equal(new Set(catalog.map((ip) => ip.slug)).size, catalog.length);
  assert.equal(sources.count, catalog.length);

  for (const ip of catalog) {
    assert.ok(ip.nameKo && ip.nameEn && ip.nameJa);
    assert.ok(Array.isArray(ip.aliases) && ip.aliases.length > 0);
    assert.ok(existsSync(path.join(root, "public", ip.image)));
  }
});

test("Korean, English, Japanese, and alias searches resolve the expected IP", () => {
  assert.deepEqual(search("엣지러너").map((ip) => ip.slug), ["cyberpunk-edgerunners"]);
  assert.deepEqual(search("JJK").map((ip) => ip.slug), ["jujutsu-kaisen"]);
  assert.deepEqual(search("ポケモン").map((ip) => ip.slug), ["pokemon"]);
  assert.deepEqual(search("進撃の巨人").map((ip) => ip.slug), ["attack-on-titan"]);
});

test("every IP has one local test product in the agreed category distribution", () => {
  assert.equal(products.length, 25);
  assert.equal(new Set(products.map((product) => product.id)).size, products.length);
  assert.equal(new Set(products.map((product) => product.ipId)).size, catalog.length);
  assert.equal(productSources.count, products.length);

  const counts = Object.fromEntries(
    ["gacha", "figure", "kuji", "tcg"].map((categoryId) => [
      categoryId,
      products.filter((product) => product.categoryId === categoryId).length,
    ]),
  );
  assert.deepEqual(counts, { gacha: 8, figure: 8, kuji: 7, tcg: 2 });

  assert.deepEqual(
    products.filter((product) => product.categoryId === "tcg").map((product) => product.ipId).sort(),
    ["one-piece", "pokemon"],
  );

  for (const product of products) {
    assert.ok(catalog.some((ip) => ip.id === product.ipId));
    assert.ok(product.title && product.description && product.sourcePage);
    assert.ok(product.price > 0 && product.stock > 0);
    assert.ok(existsSync(path.join(root, "public", product.asset)));
  }
});
