import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  path.join(root, "apps/mobile/src/features/catalog/CategoryAvailabilityState.tsx"),
  "utf8",
);

test("category opening-soon state expands instead of clipping at accessibility text sizes", () => {
  assert.match(source, /useWindowDimensions/);
  assert.match(source, /const expanded = fontScale >= 1\.6/);
  assert.match(source, /<KoreanPixelTitle[\s\S]*?numberOfLines=\{expanded \? 2 : 1\}/);
  assert.match(source, /expanded && styles\.containerLargeText/);
  assert.match(source, /CATEGORY_COMING_SOON_TITLE = "준비중입니다\."/);
  assert.match(source, /<KoreanPixelTitle[\s\S]*?\{CATEGORY_COMING_SOON_TITLE\}\s*<\/KoreanPixelTitle>/);
  assert.match(source, /<SeedInlineGuidance style=\{styles\.guidance\}>\{guidance\}<\/SeedInlineGuidance>/);
  assert.match(source, /accessibilityLabel=\{`\$\{label\} 상품은 아직 준비 중이에요\. \$\{guidance\}`\}/);
  assert.doesNotMatch(source, /OPENING SOON|statusPill|eyebrow|습니다/);
});
