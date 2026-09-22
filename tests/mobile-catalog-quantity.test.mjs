import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMPACT_INVENTORY_INLINE_MAX_FONT_SCALE,
  COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER,
  catalogQuantityLabel,
  remainingInventoryLabel,
  remainingInventoryRatio,
  shouldStackCompactInventoryMeter,
} from "../apps/mobile/src/features/catalog/remaining-inventory.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("remaining inventory labels distinguish kuji tickets from gacha products", () => {
  assert.equal(remainingInventoryLabel("kuji"), "잔여 티켓");
  assert.equal(remainingInventoryLabel("gacha"), "잔여 상품");
  assert.equal(remainingInventoryLabel("figure"), "잔여 수량");
});

test("catalog quantity and meter ratio share the same inventory source", () => {
  assert.equal(catalogQuantityLabel({ availableQuantity: 80, totalQuantity: 80 }), "80/80");
  assert.equal(
    `${remainingInventoryLabel("kuji")} ${catalogQuantityLabel({ availableQuantity: 80, totalQuantity: 80 })}`,
    "잔여 티켓 80/80",
  );
  assert.equal(remainingInventoryRatio({ availableQuantity: 80, totalQuantity: 80 }), 1);
  assert.equal(catalogQuantityLabel({ availableQuantity: 10, totalQuantity: 70 }), "10/70");
  assert.equal(catalogQuantityLabel({ availableQuantity: 10, totalQuantity: null }), "10");
  assert.equal(remainingInventoryRatio({ availableQuantity: 10, totalQuantity: 70 }), 1 / 7);
  assert.equal(remainingInventoryRatio({ availableQuantity: 90, totalQuantity: 70 }), 1);
  assert.equal(remainingInventoryRatio({ availableQuantity: -1, totalQuantity: 70 }), 0);
  assert.equal(remainingInventoryRatio({ availableQuantity: 10, totalQuantity: null }), null);
});

test("compact inventory meters keep 1, 2, and 3 digit quantities stable as text grows", () => {
  assert.equal(catalogQuantityLabel({ availableQuantity: 9, totalQuantity: 9 }), "9/9");
  assert.equal(catalogQuantityLabel({ availableQuantity: 99, totalQuantity: 99 }), "99/99");
  assert.equal(catalogQuantityLabel({ availableQuantity: 999, totalQuantity: 999 }), "999/999");
  assert.equal(COMPACT_INVENTORY_INLINE_MAX_FONT_SCALE, 1.3);
  assert.equal(COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER, 2);
  assert.equal(shouldStackCompactInventoryMeter(true, 1), false);
  assert.equal(shouldStackCompactInventoryMeter(true, 1.3), false);
  assert.equal(shouldStackCompactInventoryMeter(true, 1.3001), true);
  assert.equal(shouldStackCompactInventoryMeter(true, 2), true);
  assert.equal(shouldStackCompactInventoryMeter(false, 2), false);
  assert.equal(shouldStackCompactInventoryMeter(true, Number.NaN), false);
  assert.equal(shouldStackCompactInventoryMeter(true, Number.POSITIVE_INFINITY), false);
});

test("the shared remaining inventory meter is used across discovery and detail screens", () => {
  const apiSource = readSource("apps/mobile/src/features/shop/shop-api.ts");
  const meterSource = readSource("apps/mobile/src/components/RemainingInventoryMeter.tsx");
  const themeSource = readSource("apps/mobile/src/theme.ts");
  const rowSource = readSource("apps/mobile/src/components/CatalogProductRow.tsx");
  const homeSource = readSource("apps/mobile/src/features/home/HomeScreen.tsx");
  const shopSource = readSource("apps/mobile/src/features/shop/ShopScreen.tsx");
  const detailSource = readSource("apps/mobile/src/features/shop/ProductDetailScreen.tsx");
  const kujiSource = readSource("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");
  const kujiPeelSource = readSource("apps/mobile/src/features/draw/KujiPeelTicket.tsx");

  assert.match(apiSource, /export \{ catalogQuantityLabel \}/);
  assert.match(meterSource, /width: `\$\{ratio \* 100\}%`/);
  assert.match(meterSource, /accessibilityLabel=\{`\$\{label\} \$\{quantity\}`\}/);
  assert.doesNotMatch(meterSource, />\s*\{label\}\s*<\/Text>/);
  assert.doesNotMatch(meterSource, /styles\.label/);
  assert.match(themeSource, /kujiOrange:\s*"#F36B2C"/);
  assert.match(meterSource, /category === "kuji" && styles\.fillKuji/);
  assert.match(meterSource, /fillKuji:[^\n]*backgroundColor:\s*colors\.kujiOrange/);
  assert.match(
    meterSource,
    /quantityAndBar[\s\S]*?\{quantity\}[\s\S]*?ratio === null \? null : \([\s\S]*?styles\.track/,
  );
  assert.equal((meterSource.match(/flexWrap:\s*"wrap"/g) ?? []).length, 2);
  assert.match(meterSource, /quantityAndBar:\s*\{[\s\S]*?minWidth:\s*64/);
  assert.match(meterSource, /stackForLargeText && styles\.quantityAndBarLargeText/);
  assert.match(meterSource, /stackForLargeText && styles\.trackLargeText/);
  assert.match(meterSource, /maxFontSizeMultiplier=\{compact \? COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER : undefined\}/);
  assert.match(meterSource, /quantityAndBarLargeText:\s*\{[\s\S]*?flexDirection:\s*"column"[\s\S]*?flexWrap:\s*"nowrap"[\s\S]*?alignItems:\s*"stretch"/);
  assert.match(meterSource, /trackLargeText:\s*\{\s*width:\s*"100%",\s*flex:\s*0\s*\}/);
  assert.match(meterSource, /fontVariant:\s*\["tabular-nums"\]/);
  assert.match(meterSource, /quantityTextStyle\?:\s*StyleProp<TextStyle>/);
  assert.match(meterSource, /style=\{\[styles\.quantity, dark && styles\.quantityDark, quantityTextStyle\]\}/);
  assert.match(meterSource, /accessibilityRole=\{ratio === null \? "text" : "progressbar"\}/);
  assert.match(meterSource, /min:\s*0,[\s\S]*?max:\s*Math\.max\(0, totalQuantity\),[\s\S]*?now:\s*Math\.max\(0, Math\.min\(availableQuantity, totalQuantity\)\),[\s\S]*?text:\s*quantity/);
  assert.match(kujiSource, /backgroundColor:\s*colors\.kujiOrange/);
  assert.match(kujiPeelSource, /const KUJI_ORANGE = colors\.kujiOrange/);
  assert.match(rowSource, /<RemainingInventoryMeter/);
  assert.match(homeSource, /<RemainingInventoryMeter/g);
  assert.match(shopSource, /<RemainingInventoryMeter/);
  assert.match(detailSource, /<RemainingInventoryMeter/);
  assert.match(kujiSource, /category="kuji"[\s\S]*?availableQuantity=\{availableTicketCount\}[\s\S]*?totalQuantity=\{board\.totalSlots\}/);
});
