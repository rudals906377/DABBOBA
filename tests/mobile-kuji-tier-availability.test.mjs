import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  kujiTierDisplayLabel,
  remainingKujiTierAccessibilityLabel,
  remainingKujiTierSummary,
} from "../apps/mobile/src/features/kuji/kuji-tier-availability.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const tier = (tierCode, tierRank, label, remainingQuantity) => ({
  tierCode,
  tierRank,
  label,
  initialQuantity: Math.max(remainingQuantity, 1),
  remainingQuantity,
});

test("remaining Kuji tiers hide exhausted entries, de-duplicate codes, and keep admin order", () => {
  const summary = remainingKujiTierSummary([
    tier("B", 2, "B", 4),
    tier("S", 0, "S", 0),
    tier("A", 1, "A", 1),
    tier("A", 9, "duplicate", 3),
    tier("LAST_ONE", 3, "라스트원", 1),
  ], 3, true);

  assert.ok(summary);
  assert.deepEqual(summary.all.map(({ tierCode, displayLabel }) => [tierCode, displayLabel]), [
    ["A", "A상"],
    ["B", "B상"],
    ["LAST_ONE", "라스트원"],
  ]);
  assert.deepEqual(summary.visible.map(({ tierCode }) => tierCode), ["A", "B"]);
  assert.equal(summary.hiddenCount, 1);
  assert.equal(summary.compactLabel, "A상 · B상 · +1");
});

test("wide Kuji rows keep five named awards before collapsing overflow", () => {
  const five = [
    tier("S", 0, "S상", 1),
    tier("A", 1, "A상", 2),
    tier("B", 2, "B상", 3),
    tier("C", 3, "C상", 4),
    tier("LAST_ONE", 4, "라스트원", 1),
  ];
  const complete = remainingKujiTierSummary(five, 5);
  assert.equal(complete?.compactLabel, "S상 · A상 · B상 · C상 · 라스트원");

  const overflow = remainingKujiTierSummary([...five, tier("D", 5, "D상", 6)], 5);
  assert.equal(overflow?.compactLabel, "S상 · A상 · B상 · C상 · +2");
});

test("tier display preserves named awards and accessibility announces all actual counts", () => {
  assert.equal(kujiTierDisplayLabel(tier("A", 0, "A", 1)), "A상");
  assert.equal(kujiTierDisplayLabel(tier("LAST_ONE", 1, "라스트원", 1)), "라스트원");
  assert.equal(remainingKujiTierAccessibilityLabel([
    tier("A", 0, "A상", 1),
    tier("B", 1, "B상", 12),
  ]), "남은 상, A상 1개, B상 12개");
  assert.equal(remainingKujiTierAccessibilityLabel([tier("A", 0, "A상", 0)]), null);
});

test("Home overlays a compact summary while Kuji Shop renders the wide tier row and both refresh on focus", () => {
  const componentSource = readSource("apps/mobile/src/components/KujiPrizeTierRow.tsx");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");

  assert.match(componentSource, /variant === "overlay" \? 3 : 5/);
  assert.match(componentSource, /variant === "overlay",/);
  assert.match(componentSource, /position: "absolute"/);
  assert.match(componentSource, /colors\.kujiOrangeDark/);
  assert.match(componentSource, />남음<\/Text>/);
  assert.match(componentSource, /chip: \{[\s\S]*?flexShrink: 1/);
  assert.match(homeSource, /<KujiPrizeTierRow tiers=\{remainingKujiTiers\} variant="overlay" \/>/);
  assert.match(shopSource, /<KujiPrizeTierRow tiers=\{product\.remainingKujiTiers\}/);
  assert.match(homeSource, /useFocusEffect\([\s\S]*?void load\(\)/);
  assert.match(shopSource, /useFocusEffect\([\s\S]*?shouldRefreshShopOnFocus\(lastSuccessfulLoadAt\.current, Date\.now\(\)\)[\s\S]*?loadProductsRef\.current\(\{ inPlace: true \}\)/);
  assert.doesNotMatch(shopSource, /focusRevision/);
});
