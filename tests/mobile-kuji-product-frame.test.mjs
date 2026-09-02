import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

const frameSource = readSource("apps/mobile/src/components/KujiProductFrame.tsx");
const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
const profileSource = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");
const agentGuideSource = readSource("AGENTS.md");

test("the shared kuji frame is only a thin category-gated outline", () => {
  assert.match(frameSource, /export function KujiProductFrame/);
  assert.match(frameSource, /category !== "kuji"/);
  assert.match(frameSource, /borderWidth:\s*1/);
  assert.match(frameSource, /borderColor:\s*seed\.color\.stroke\.neutral/);
  assert.match(frameSource, /borderRadius:\s*seed\.radius\.r4/);
  assert.match(frameSource, /styles\.frameCompact/);
  assert.doesNotMatch(
    frameSource,
    /backgroundColor|padding|shadow|elevation|canopy|controlPanel|coinSlot|crank|chute|perforation|ticket|Pressable|Text/,
  );
});

test("kuji catalog media reuses the outline across discovery surfaces", () => {
  for (const [relativePath, source] of [
    ["apps/mobile/src/features/home/HomeScreen.tsx", homeSource],
    ["apps/mobile/src/features/shop/ShopScreen.tsx", shopSource],
    ["apps/mobile/src/components/CatalogProductRow.tsx", catalogRowSource],
    ["apps/mobile/src/features/profile/ProfileSectionScreen.tsx", profileSource],
  ]) {
    assert.match(source, /import \{ KujiProductFrame \} from "@\/components\/KujiProductFrame"/, relativePath);
    assert.match(source, /<KujiProductFrame/, relativePath);
  }
  assert.match(homeSource, /<KujiProductFrame category=\{category\}>/);
  assert.match(homeSource, /category === "kuji" && styles\.kujiProductMediaWindow/);
  assert.match(homeSource, /kujiProductMediaWindow:\s*\{\s*borderWidth:\s*0,\s*borderRadius:\s*0,\s*backgroundColor:\s*"transparent"\s*\}/);
  assert.match(shopSource, /<KujiProductFrame category=\{category\}>/);
  assert.match(catalogRowSource, /<KujiProductFrame category=\{product\.category\} compact>/);
  assert.match(profileSource, /<KujiProductFrame category=\{catalogFrameCategory\} compact>/);
});

test("the durable kuji rule keeps the outline minimal and out of transactional surfaces", () => {
  assert.match(agentGuideSource, /shared `KujiProductFrame`/);
  assert.match(agentGuideSource, /Home, 뽀바, search, product history, and wishlist catalog media/);
  assert.match(agentGuideSource, /product detail, checkout, exchange, storage, kuji draw, or reveal summaries/);
});
