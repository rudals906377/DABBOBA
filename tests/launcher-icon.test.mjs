import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const read = (relative) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)));

test("developer-console icon is opaque and below 250 KB", () => {
  const bytes = read("design-assets/app-icons/dabboba-developer-icon-256.png");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 256);
  assert.equal(bytes.readUInt32BE(20), 256);
  assert.equal(bytes[25], 2);
  assert.ok(bytes.length < 250000);
});

test("launcher uses the approved horizontal identity and matching mint", () => {
  const { expo } = JSON.parse(read("apps/mobile/app.json"));
  assert.equal(expo.icon, "./assets/icons/app-icon.png");
  assert.equal(expo.android.adaptiveIcon.foregroundImage, "./assets/icons/adaptive-icon-foreground.png");
  assert.equal(expo.android.adaptiveIcon.backgroundColor, "#78EF95");
  assert.match(read("design-assets/app-icons/README-launcher-icon.md").toString(), /Selected source: `dabboba-wordmark-capsule-horizontal-final-source.png`/);
});

test("packaged iOS and Android icons retain their required PNG formats", () => {
  for (const [name, colorType] of [["app-icon.png", 2], ["adaptive-icon-foreground.png", 6]]) {
    const bytes = read(`apps/mobile/assets/icons/${name}`);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), 1024);
    assert.equal(bytes.readUInt32BE(20), 1024);
    assert.equal(bytes[25], colorType);
  }
});

test("complete Android wordmark stays within the adaptive safe circle", async () => {
  const imageRequire = createRequire(fileURLToPath(new URL("../apps/api/package.json", import.meta.url)));
  const sharp = imageRequire("sharp");
  const { data } = await sharp(read("apps/mobile/assets/icons/adaptive-icon-foreground.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = 1024;
  let right = 0;
  let visible = 0;
  for (let y = 0; y < 1024; y += 1) for (let x = 0; x < 1024; x += 1) {
    if (data[(y * 1024 + x) * 4 + 3] === 0) continue;
    visible += 1;
    left = Math.min(left, x);
    right = Math.max(right, x);
    assert.ok(Math.hypot(x - 512, y - 512) <= 1024 * 33 / 108);
  }
  assert.ok(visible > 10000);
  assert.ok(right - left > 550);
});
