import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const previewRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const originals = [
  ["native capsule shader", "scenes/capsule-shader.mjs", "apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts"],
  ["native outer ticket artwork", "assets/kuji/kuji-ticket-outer-layer.png", "apps/mobile/assets/draw/kuji/kuji-ticket-outer-layer.png"],
  ["native peel ticket artwork", "assets/kuji/kuji-ticket-peel-layer.png", "apps/mobile/assets/draw/kuji/kuji-ticket-peel-layer.png"],
  ["canonical wordmark", "assets/brand/dabboba-wordmark.png", "apps/mobile/assets/brand/dabboba-wordmark.png"],
  ["original pixel capsule machine", "assets/gacha/capsule-machine-front-empty.png", "apps/mobile/assets/draw/gacha/capsule-machine-front-empty.png"],
  ["original contact sound", "assets/audio/gacha-capsule-drop.wav", "apps/mobile/assets/draw/gacha/sfx/gacha-capsule-drop.wav"],
  ["original capsule-open sound", "assets/audio/gacha-capsule-open.wav", "apps/mobile/assets/draw/gacha/sfx/gacha-capsule-open.wav"],
];

for (const [label, copied, source] of originals) {
  test(`${label} remains byte-identical to the app asset`, async () => {
    const [localBytes, originalBytes] = await Promise.all([
      readFile(new URL(copied, previewRoot)),
      readFile(new URL(source, repoRoot)),
    ]);
    assert.ok(localBytes.length > 0, `${label} must not be empty`);
    assert.equal(localBytes.length, originalBytes.length, `${label} byte length changed`);
    assert.equal(digest(localBytes), digest(originalBytes), `${label} SHA-256 changed; preserve the exact approved source`);
  });
}
