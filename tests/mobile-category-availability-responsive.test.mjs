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
  assert.match(source, /expanded \? `\$\{label\}샵 오픈\\n준비 중`/);
  assert.match(source, /expanded && styles\.containerLargeText/);
  assert.match(source, /expanded && styles\.statusPillLargeText/);
  assert.match(source, /statusText:\s*\{[^}]*flexShrink:\s*1[^}]*textAlign:\s*"center"/);
  assert.match(source, /statusPillLargeText:\s*\{[^}]*width:\s*"100%"[^}]*paddingVertical:/);
});
