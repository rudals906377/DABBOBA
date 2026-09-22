import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ips = JSON.parse(readFileSync(path.join(root, "src/fixtures/ip-seed.json"), "utf8"));
const products = JSON.parse(readFileSync(path.join(root, "src/fixtures/product-seed.json"), "utf8"));

test("bundled catalog seeds stay empty until operator-owned production records are supplied", () => {
  assert.deepEqual(ips, []);
  assert.deepEqual(products, []);
});

test("legacy example catalog media is absent from the runtime asset tree", () => {
  assert.equal(existsSync(path.join(root, "public/assets/dabboba/ips")), false);
  assert.equal(existsSync(path.join(root, "public/assets/dabboba/products")), false);
  assert.equal(existsSync(path.join(root, "apps/mobile/assets/logo-concepts")), false);
  assert.equal(existsSync(path.join(root, "public/assets/dabboba/logo-concepts")), false);
});

test("active Expo assets are grouped by brand, icon and draw responsibility", () => {
  for (const relative of [
    "apps/mobile/assets/brand/dabboba-wordmark.png",
    "apps/mobile/assets/icons/app-icon.png",
    "apps/mobile/assets/icons/adaptive-icon-foreground.png",
    "apps/mobile/assets/draw/gacha/capsule-machine-front-empty.png",
    "apps/mobile/assets/draw/kuji/kuji-ticket-front.png",
  ]) {
    assert.equal(existsSync(path.join(root, relative)), true, relative);
  }
});
