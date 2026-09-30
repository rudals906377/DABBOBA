import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { includedPrizes } from "../apps/mobile/src/features/shop/included-prizes.ts";

const prize = (id, extra) => ({
  id, prizeProductId: `prize-${id}`, prizeName: `${id}상`, prizeImageUrl: null,
  prizeSku: `SKU-${id}`, prizeIpId: "ip", prizeCategory: "figure", rarity: id, ...extra,
});

test("LIVE product detail shows each prize's probability", () => {
  const items = includedPrizes({
    drawOdds: { version: 1, entries: [prize("A", { probabilityPercent: 12.5 })] },
    prizeLineup: null,
  });
  assert.deepEqual(items.map((item) => [item.prizeName, item.detail]), [["A상", "12.50%"]]);
});

test("before LIVE the lineup shows composition quantities and no probability", () => {
  const items = includedPrizes({
    drawOdds: null,
    prizeLineup: { version: 1, entries: [prize("A", { quantity: 2 }), prize("B", { quantity: 1200 }), prize("C", { quantity: null })] },
  });
  assert.deepEqual(items.map((item) => [item.prizeName, item.detail, item.accessibilityDetail]), [
    ["A상", "2개", "구성 2개"],
    ["B상", "1,200개", "구성 1200개"],
    ["C상", null, null],
  ]);
  assert.equal(items.some((item) => /%/.test(item.detail ?? "")), false);
  assert.deepEqual(includedPrizes({ drawOdds: null, prizeLineup: null }), []);
});

test("product detail falls back to the lineup only when the odds are withheld", () => {
  const api = readFileSync(new URL("../apps/mobile/src/features/shop/shop-api.ts", import.meta.url), "utf8");
  assert.match(api, /if \(!drawOdds\) \{[\s\S]*?\/v1\/catalog\/products\/\{productId\}\/prize-lineup/);
  const screen = readFileSync(new URL("../apps/mobile/src/features/shop/ProductDetailScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /const prizes = includedPrizes\(snapshot\);/);
  // The probability disclosure caption appears only with real odds.
  assert.match(screen, /\{odds\?\.entries\.length \? \(\s*<SeedInlineGuidance/);
});
