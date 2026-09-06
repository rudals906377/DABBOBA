import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getGachaCapsuleSilhouette } from "../apps/mobile/src/features/draw/gacha-capsule-silhouette.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const visual = read("apps/mobile/src/features/draw/GachaCapsuleVisual.tsx");
const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");

test("the hero is exactly round while the poured chamber keeps its approved simple molded shape", () => {
  for (const diameter of [17, 24, 200]) {
    const small = getGachaCapsuleSilhouette(diameter);
    const hero = getGachaCapsuleSilhouette(diameter, true);
    assert.equal(small.borderTopLeftRadius, diameter / 2);
    assert.equal(small.borderTopRightRadius, diameter / 2);
    assert.equal(small.borderBottomLeftRadius, small.borderBottomRightRadius);
    assert.ok(small.borderBottomLeftRadius < diameter / 2);
    assert.ok(small.borderBottomLeftRadius < hero.borderBottomLeftRadius);
    assert.ok(Math.abs(diameter - 2 * small.borderBottomLeftRadius - diameter * 0.36) < 1e-8);
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
