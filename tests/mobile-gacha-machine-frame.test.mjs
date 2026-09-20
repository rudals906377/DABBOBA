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

const frameSource = readSource("apps/mobile/src/components/GachaMachineFrame.tsx");
const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
const catalogRowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
const profileSource = readSource("apps/mobile/src/features/profile/ProfileSectionScreen.tsx");
const agentGuideSource = readSource("AGENTS.md");

test("the shared gacha frame is a non-obstructing, category-gated machine outline", () => {
  assert.match(frameSource, /export function GachaMachineFrame/);
  assert.match(frameSource, /category !== "gacha"/);
  assert.match(frameSource, /\{children\}[\s\S]*?style=\{\[styles\.controlPanel/);
  assert.match(frameSource, /pointerEvents="none"/);
  assert.match(frameSource, /accessible=\{false\}/);
  assert.match(frameSource, /accessibilityElementsHidden/);
  assert.match(frameSource, /importantForAccessibility="no-hide-descendants"/);
  for (const machinePart of ["cabinet", "canopy", "controlPanel", "chute", "crank"]) {
    assert.match(frameSource, new RegExp(`styles\\.${machinePart}`), machinePart);
  }
  assert.doesNotMatch(frameSource, /position:\s*"absolute"|\bPressable\b|\bonPress\b|accessibilityRole/);
  assert.doesNotMatch(frameSource, />\s*(?:GACHA|DABBOBA)\s*</);
});

test("gacha catalog media reuses the frame across discovery surfaces", () => {
  for (const [relativePath, source] of [
    ["apps/mobile/src/features/home/HomeScreen.tsx", homeSource],
    ["apps/mobile/src/features/shop/ShopScreen.tsx", shopSource],
    ["apps/mobile/src/components/CatalogProductRow.tsx", catalogRowSource],
    ["apps/mobile/src/features/profile/ProfileSectionScreen.tsx", profileSource],
  ]) {
    assert.match(source, /import \{ GachaMachineFrame \} from "@\/components\/GachaMachineFrame"/, relativePath);
    assert.match(source, /<GachaMachineFrame/, relativePath);
  }
  assert.match(homeSource, /<GachaMachineFrame category=\{layoutKind\} clean>/);
  assert.match(shopSource, /<GachaMachineFrame category=\{category\}/);
  assert.match(catalogRowSource, /<GachaMachineFrame category=\{product\.category\} clean/);
  assert.match(profileSource, /catalogFrameCategory=\{product\.category\}/);
  assert.match(profileSource, /<GachaMachineFrame category=\{catalogFrameCategory\} clean/);
  assert.doesNotMatch(homeSource, /showBadge|styles\.categoryBadge|categoryBadge:/);
  assert.match(shopSource, /category === "kuji" \? styles\.kujiProductImageFrame : styles\.gachaProductImageFrame/);
});

test("the durable product rule retires decorative catalog machinery while preserving clean composition gates", () => {
  assert.match(agentGuideSource, /former decorative `GachaMachineFrame` catalog cabinet is retired/);
  assert.match(agentGuideSource, /clean, non-visual wrapper/);
  assert.match(agentGuideSource, /do not add a canopy, chute, crank, extra padding, or crop/);
});
