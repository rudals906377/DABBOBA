import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getGachaCapsuleSilhouette } from "../apps/mobile/src/features/draw/gacha-capsule-silhouette.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const visual = read("apps/mobile/src/features/draw/GachaCapsuleVisual.tsx");
const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");
const reveal = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

test("the chamber and hero share one lightweight spherical capsule profile", () => {
  for (const diameter of [17, 24, 200]) {
    const small = getGachaCapsuleSilhouette(diameter);
    const hero = getGachaCapsuleSilhouette(diameter, true);
    assert.equal(small.borderTopLeftRadius, diameter / 2);
    assert.equal(small.borderTopRightRadius, diameter / 2);
    assert.equal(small.borderBottomLeftRadius, diameter / 2);
    assert.equal(small.borderBottomRightRadius, diameter / 2);
    assert.ok(Object.values(hero).every((radius) => radius === diameter / 2));
  }
});

test("both small and fallback capsules size their contour once and clip all face layers consistently", () => {
  assert.match(visual, /getGachaCapsuleSilhouette\(diameter, heroDetail\)/);
  assert.match(visual, /styles.root,\s*silhouette/);
  assert.match(visual, /styles.innerRim, silhouette/);
  assert.match(visual, /styles.depthShade, silhouette/);
  assert.match(visual, /styles.heroLightRim, silhouette/);
  assert.match(visual, /styles.heroDarkRim, silhouette/);
  assert.match(visual, /split && \{ borderBottomLeftRadius: lowerRadius, borderBottomRightRadius: lowerRadius \}/);
  assert.match(machine, /diameter=\{capsule.size\}/);
  assert.match(machine, /diameter=\{GACHA_PICKUP_GEOMETRY.capsuleSize\}/);
  assert.doesNotMatch(visual, /onLayout|useState|GLView|setInterval/);
});

test("the shared capsule uses a one-pixel seam and all three approved colorways", () => {
  assert.match(visual, /orange:\s*\{/);
  assert.match(visual, /lower: "#91E98E"/);
  assert.match(visual, /lower: "#F4F0E6"/);
  assert.match(visual, /lower: "#F36B2C"/);
  assert.match(visual, /seam:[\s\S]*?height: 1/);
});

test("machine and reveal share anatomy without sharing the same material treatment", () => {
  assert.match(visual, /const upperColor = heroDetail \? palette\.upper : palette\.machineUpper/);
  assert.match(visual, /const lowerColor = heroDetail \? palette\.lower : palette\.machineLower/);
  assert.match(visual, /!heroDetail && styles\.machineHighlight/);
  assert.match(visual, /heroDetail \? <View style=\{styles\.lowerRoundShade\} \/> : <View style=\{styles\.machineLowerPlane\} \/>/);
  assert.doesNotMatch(reveal, /capsuleTop|capsuleBottom|capsuleSeam/);
});
