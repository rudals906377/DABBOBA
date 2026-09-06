import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GACHA_PRISM_RAYS, GACHA_PRISM_BEAM_LAYERS, sampleGachaPrismLight, sampleGachaPrismBeamScale } from "../apps/mobile/src/features/draw/gacha-prism-light.ts";

const root = new URL("../apps/mobile/src/features/draw/", import.meta.url);
const component = readFileSync(new URL("GachaPrismLight.tsx", root), "utf8");
const machine = readFileSync(new URL("GachaLeverMachine.tsx", root), "utf8");
const textureGenerator = readFileSync(new URL("../scripts/generate-gacha-prism-texture.ts", import.meta.url), "utf8");

test("archived prismatic rays fan across the stage in many directions from one narrow apex", () => {
  assert.ok(GACHA_PRISM_RAYS.length >= 12 && GACHA_PRISM_RAYS.length <= 18);
  const angles = GACHA_PRISM_RAYS.map((ray) => ray.angle);
  assert.equal(new Set(angles).size, angles.length);
  assert.ok(Math.max(...angles) - Math.min(...angles) >= 180);
  assert.ok(angles.every((angle) => Math.abs(angle) <= 110), "light exits upwards and sideways, not as a background sunburst");
  assert.ok(angles.filter((angle) => Math.abs(angle) < 95).length >= 7);
  for (const ray of GACHA_PRISM_RAYS) {
    assert.ok(ray.spread >= 5 && ray.spread <= 18);
    assert.ok(ray.strength > 0 && ray.strength <= 1);
  }
  assert.match(textureGenerator, /M 0 0 L/);
  assert.match(component, /Math\.hypot\(width, height\)/);
});

test("archived prism edges use bounded faint feather bands instead of opaque wedges and thin laser spines", () => {
  assert.equal(GACHA_PRISM_BEAM_LAYERS.length, 5);
  let previous = { width: Infinity, opacity: 0 };
  let cumulativeOpacity = 0;
  for (const layer of GACHA_PRISM_BEAM_LAYERS) {
    assert.ok(layer.width > 0.5 && layer.width < previous.width);
    assert.ok(layer.opacity > previous.opacity && layer.opacity <= 0.18);
    cumulativeOpacity += layer.opacity;
    previous = layer;
  }
  assert.ok(cumulativeOpacity < 0.5, "overlapping rays must not hide the shell in hard bright bands");
  assert.match(textureGenerator, /GACHA_PRISM_BEAM_LAYERS.map/);
  assert.match(textureGenerator, /opacity="\$\{ray.strength \* layer.opacity\}"/);
  assert.doesNotMatch(textureGenerator, /halfWidth \* 0.12|opacity="\$\{ray.strength\}"/);
});


test("archived prism helpers remain bounded without defining the current reveal timeline", () => {
  for (const p of [0.1, 0.5, 0.8]) {
    assert.equal(sampleGachaPrismLight(p, { opening: 0, innerLight: 1, whiteout: 0 }).opacity, 0);
    assert.equal(sampleGachaPrismLight(p, { opening: 1, innerLight: 1, whiteout: 1 }).opacity, 0);
    assert.equal(sampleGachaPrismLight(p, { opening: 1, innerLight: 1, whiteout: 0 }, true).opacity, 0);
    const reference = sampleGachaPrismLight(p, { opening: 1, innerLight: 1, whiteout: 0 });
    assert.equal(reference.opacity, 1);
    assert.ok(Object.values(reference).every(Number.isFinite));
  }
  for (const p of [NaN, Infinity, -Infinity, -1, 2]) {
    assert.equal(sampleGachaPrismLight(p, { opening: 1, innerLight: 1, whiteout: 0 }).opacity, 0);
  }
  assert.equal(sampleGachaPrismBeamScale(1.1, 250, 250), 1.1);
  assert.equal(sampleGachaPrismBeamScale(1, NaN, 250), 0);
  assert.equal(sampleGachaPrismBeamScale(1, 250, 0), 0);
});

test("the historical prismatic fan is preserved as reference but never mounted in the premium reveal", () => {
  assert.doesNotMatch(machine, /GachaPrismLight|gacha-prism-light/);
  assert.match(machine, /import \{ GachaCapsuleGlow \}/);
  assert.match(machine, /<GachaCapsuleGlow\s+progress=\{revealProgress\}\s+active=\{revealActive\}/);
  assert.equal((component.match(/<Animated.Image\b/g) ?? []).length, 1, "the preserved reference remains reproducible");
  assert.doesNotMatch(component, /react-native-svg|useAnimatedProps|animatedProps|ClipPath|matrix:/);
});
