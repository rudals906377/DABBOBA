import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const machine = readFileSync(
  new URL("../apps/mobile/src/features/draw/GachaLeverMachine.tsx", import.meta.url),
  "utf8",
);

test("the gacha fall and opening mount one finite photographic light payoff", () => {
  assert.match(machine, /function GachaDropImpact/);
  assert.match(machine, /sampleGachaDropImpact\(progress\.value, reduceMotion\)/);
  assert.match(machine, /testID="gacha-drop-impact"/);
  assert.match(machine, /function GachaRevealOptics/);
  assert.match(machine, /sampleGachaRevealOptics\(progress\.value, reduceMotion\)/);
  assert.match(machine, /testID="gacha-reveal-optics"/);
  assert.match(machine, /<GachaDropImpact progress=\{dispenseProgress\} reduceMotion=\{reduceMotion\} \/>/);
  assert.match(machine, /<GachaRevealOptics[\s\S]*?progress=\{revealProgress\}[\s\S]*?reduceMotion=\{reduceMotion\}/);
});

test("the new optics stay deterministic, visual-only, soft-edged, and absent under Reduced Motion", () => {
  const impact = machine.split("function GachaDropImpact")[1]?.split("function GachaCapsuleCinematic")[0];
  const optics = machine.split("function GachaRevealOptics")[1]?.split("function GachaChamberAgitator")[0];
  assert.ok(impact);
  assert.ok(optics);
  assert.match(impact, /if \(reduceMotion\) return null/);
  assert.match(optics, /if \(reduceMotion \|\| width <= 0 \|\| height <= 0\) return null/);
  assert.doesNotMatch(`${impact}\n${optics}`, /withRepeat|Math\.random|setTimeout|setInterval|requestAnimationFrame|Audio\.|playAsync|revealRing|revealRays|GACHA_REVEAL_RAY_ANGLES/);
});
