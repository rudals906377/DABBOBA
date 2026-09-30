import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sampleGachaCapsuleAtlasFrame } from "../apps/mobile/src/features/draw/gacha-capsule-frames-motion.ts";

const atlas = {
  frameCount: 64, columns: 8, rows: 8, frameWidth: 192, frameHeight: 192,
  closedFrameIndex: 0, revealProgressMin: 0, revealProgressMax: 0.92,
};
const renderer = readFileSync(new URL("../apps/mobile/src/features/draw/GachaCapsuleFrames.tsx", import.meta.url), "utf8");

test("finite 3D atlas selection uses the reveal clock and clamps every exceptional input", () => {
  assert.equal(sampleGachaCapsuleAtlasFrame(0, atlas).index, 0);
  assert.equal(sampleGachaCapsuleAtlasFrame(0.92, atlas).index, 63);
  assert.equal(sampleGachaCapsuleAtlasFrame(1, atlas).index, 63);
  assert.equal(sampleGachaCapsuleAtlasFrame(-1, atlas).index, 0);
  assert.equal(sampleGachaCapsuleAtlasFrame(Number.NaN, atlas).index, 0);
  assert.equal(sampleGachaCapsuleAtlasFrame(Number.POSITIVE_INFINITY, atlas).index, 0);
  assert.deepEqual(sampleGachaCapsuleAtlasFrame(0.92, atlas), { index: 63, translateX: -1344, translateY: -1344 });
});

test("each baked tile is selected exactly on its recorded progress without traveling into adjacent tiles", () => {
  for (let index = 0; index < atlas.frameCount; index += 1) {
    const tile = sampleGachaCapsuleAtlasFrame(index / 63 * 0.92, atlas);
    assert.equal(tile.index, index);
    assert.equal(tile.translateX, -(index % 8) * 192);
    assert.equal(tile.translateY, -Math.floor(index / 8) * 192);
  }
  let previous = -1;
  for (let step = 0; step <= 1_000; step += 1) {
    const tile = sampleGachaCapsuleAtlasFrame(step / 1_000, atlas);
    assert.ok(tile.index >= previous);
    assert.ok(tile.index >= 0 && tile.index < 64);
    assert.equal(tile.translateX % 192, -0);
    assert.equal(tile.translateY % 192, -0);
    previous = tile.index;
  }
});

test("tall atlas tiles preserve vertical clearance for the opened hollow lid", () => {
  const tallAtlas = { ...atlas, frameHeight: 256 };
  assert.deepEqual(sampleGachaCapsuleAtlasFrame(0.92, tallAtlas), {
    index: 63, translateX: -1344, translateY: -1792,
  });
  for (let index = 0; index < tallAtlas.frameCount; index += 1) {
    const tile = sampleGachaCapsuleAtlasFrame(index / 63 * 0.92, tallAtlas);
    assert.equal(tile.translateX, -(index % 8) * 192);
    assert.equal(tile.translateY, -Math.floor(index / 8) * 256);
  }
  assert.match(renderer, /height: ATLAS.frameHeight/);
  assert.match(renderer, /height: ATLAS.rows \* ATLAS.frameHeight/);
});

test("Reduced Motion never advances atlas frames or draws its light and spatial travel", () => {
  for (const progress of [0, 0.4, 0.6, 0.92, 1]) {
    assert.equal(sampleGachaCapsuleAtlasFrame(progress, atlas, true).index, 0);
  }
  assert.match(renderer, /!reduceMotion && tone === ATLAS.tone && active.value > 0 \? loaded.value \* pickup.opacity : 0/);
});

test("one decoded image animates only native tile and camera transforms with no presentation bridge loop", () => {
  assert.equal((renderer.match(/<Animated.Image/g) ?? []).length, 1);
  assert.match(renderer, /onLoad=\{handleLoad\}/);
  assert.match(renderer, /loaded.value = 1;[\s\S]*?callbacks.current.onReady\?\.\(\)/);
  assert.match(renderer, /onError=\{handleError\}/);
  assert.match(renderer, /loaded.value = 0;/);
  assert.match(renderer, /sampleGachaCapsuleAtlasFrame\(progress.value, ATLAS, reduceMotion\)/);
  assert.doesNotMatch(renderer, /requestAnimationFrame|setInterval|setTimeout|scheduleOnRN|setState|useState|GLView|endFrameEXP/);
  assert.doesNotMatch(renderer, /consumeDrawEntitlement|Math.random|fetch\(/);
});

test("camera magnifies the fixed pickup capsule and its source aperture with matching geometry", () => {
  assert.match(renderer, /sampleGachaCameraMotion\(progress.value, viewportSize.width, viewportSize.height, reduceMotion\)/);
  assert.match(renderer, /sampleGachaPickupMotion\(dispenseProgress.value, reduceMotion\)/);
  assert.match(renderer, /clipped = dispenseProgress.value < 1/);
  assert.match(renderer, /camera.capsuleX \+ pickup.x \* worldScale - clipLeft - ATLAS.frameWidth \/ 2/);
  assert.match(renderer, /camera.capsuleY \+ pickup.y \* worldScale - clipTop - ATLAS.frameHeight \/ 2/);
  assert.match(renderer, /scale: camera.capsuleDiameter \/ ATLAS.projection.diameter/);
  assert.match(renderer, /aperture: \{ position: "absolute", overflow: "hidden", backgroundColor: seed.color.background.transparent \}/);
  assert.doesNotMatch(renderer, /sampleGachaRevealLighting|shellOpacity\s*\*/);
});

test("aperture layout props are split from the per-frame opacity and stay constant after the pickup lands", () => {
  const layout = renderer.match(/const apertureLayoutStyle = useAnimatedStyle\(\(\) => \{[\s\S]*?\n  \}\);/)?.[0] ?? "";
  const opacity = renderer.match(/const apertureOpacityStyle = useAnimatedStyle\(\(\) => \{[\s\S]*?\n  \}\);/)?.[0] ?? "";
  assert.match(layout, /if \(!clipped\) \{\s*return \{ left: 0, top: 0, width: viewportSize.width, height: viewportSize.height \};/);
  assert.doesNotMatch(layout, /opacity/);
  assert.match(opacity, /opacity:/);
  assert.doesNotMatch(opacity, /left:|top:|width:|height:/);
  assert.match(renderer, /style=\{\[styles.aperture, apertureLayoutStyle, apertureOpacityStyle\]\}/);
});
