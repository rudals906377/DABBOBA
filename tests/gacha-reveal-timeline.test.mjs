import assert from "node:assert/strict";
import test from "node:test";
import { GACHA_CLOSEUP_DURATION_MS, sampleGachaRevealLighting, sampleGachaRevealRattle } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";
import { sampleGachaCameraMotion } from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";
import { GACHA_CAPSULE_REVEAL_DURATION_MS } from "../apps/mobile/src/features/draw/gacha-capsule-motion.ts";

test("a gentle two-second opening overlaps the unchanged camera inside the three-second reveal", () => {
  assert.equal(GACHA_CAPSULE_REVEAL_DURATION_MS, GACHA_CLOSEUP_DURATION_MS);
  assert.equal(GACHA_CLOSEUP_DURATION_MS, 3000);
  assert.equal(sampleGachaRevealLighting(0.16).seal, 0);
  assert.ok(sampleGachaRevealLighting(0.2).seal > 0);
  assert.equal(sampleGachaRevealLighting(0.18).opening, 0);
  assert.equal(sampleGachaRevealLighting(0.84).opening, 1);
  const openingMs = (0.84 - 0.18) * GACHA_CLOSEUP_DURATION_MS;
  assert.ok(openingMs >= 1900 && openingMs <= 2100, "the refined split opens gently for about two seconds");
  for (const p of [0.28, 0.34, 0.4, 0.44]) {
    const light = sampleGachaRevealLighting(p);
    const camera = sampleGachaCameraMotion(p, 340, 624);
    assert.ok(light.opening > 0 && light.innerLight > 0);
    assert.ok(camera.capsuleDiameter < sampleGachaCameraMotion(p + 0.01, 340, 624).capsuleDiameter);
  }
});

test("the premium reveal has no rattle or shake at any progress, including Reduced Motion", () => {
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000;
    assert.equal(sampleGachaRevealRattle(p), 0);
    assert.equal(sampleGachaRevealRattle(p, true), 0);
  }
  for (const p of [NaN, Infinity, -Infinity, -1, 2]) assert.equal(sampleGachaRevealRattle(p), 0);
});

test("light begins in the seam then brightens once without a background blink", () => {
  assert.equal(sampleGachaRevealLighting(0.18).innerLight, 0);
  assert.ok(sampleGachaRevealLighting(0.3).innerLight > 0);
  assert.equal(sampleGachaRevealLighting(0.68).whiteout, 0);
  let previous = sampleGachaRevealLighting(0);
  for (let i = 1; i <= 1000; i++) {
    const frame = sampleGachaRevealLighting(i / 1000);
    for (const key of ["seal", "opening", "innerLight", "whiteout", "prizeOpacity"]) {
      assert.ok(frame[key] >= previous[key] && frame[key] <= 1);
    }
    assert.ok(frame.shellOpacity <= previous.shellOpacity && frame.shellOpacity >= 0);
    assert.ok(frame.prizeOpacity <= frame.whiteout, "the product fades in behind the advancing soft exposure");
    if (frame.prizeOpacity > 0) {
      assert.equal(frame.opening, 1, "the product starts appearing only after the gentle split finishes");
      assert.ok(frame.whiteout > 0.6);
    }
    previous = frame;
  }
  assert.equal(previous.prizeOpacity, 1);
  assert.equal(previous.whiteout, 1);
  assert.equal(previous.shellOpacity, 0);
});

test("shell and light ease in and out with continuous velocity and acceleration", () => {
  const h = 0.00001;
  for (const [key, start, end] of [
    ["seal", 0.16, 0.32], ["opening", 0.18, 0.84], ["innerLight", 0.18, 0.78],
    ["whiteout", 0.68, 0.96], ["prizeOpacity", 0.84, 1], ["shellOpacity", 0.74, 0.90],
  ]) {
    for (const boundary of [start, end]) {
      const a = sampleGachaRevealLighting(boundary - h)[key];
      const b = sampleGachaRevealLighting(boundary)[key];
      const c = sampleGachaRevealLighting(boundary + h)[key];
      assert.ok(Math.abs((c - a) / (2 * h)) < 0.0001, `${key} velocity jumps at ${boundary}`);
      assert.ok(Math.abs((c - 2 * b + a) / h ** 2) < 0.1, `${key} acceleration jumps at ${boundary}`);
    }
  }
});

test("Reduced Motion removes light travel and still presents the final result", () => {
  for (const p of [0, 0.4, 0.7, 1, NaN, Infinity, -1]) {
    const frame = sampleGachaRevealLighting(p, true);
    assert.equal(frame.innerLight, 0);
    assert.equal(frame.whiteout, 0);
    assert.equal(frame.opening, 0);
    assert.equal(frame.prizeOpacity, p === 1 ? 1 : 0);
  }
});
