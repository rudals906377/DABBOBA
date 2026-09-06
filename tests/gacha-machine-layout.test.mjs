import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as motion from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";

test("the ready machine grows with usable stage space instead of keeping the old fixed scale", () => {
  assert.equal(typeof motion.resolveGachaMachineScale, "function");
  const scale = motion.resolveGachaMachineScale(340, 624);
  assert.ok(scale > 1.58 * 1.25, "ordinary phone stage should visibly enlarge the machine by at least 25 percent");
  assert.ok(motion.resolveGachaMachineScale(380, 690) > scale);
  assert.ok(motion.resolveGachaMachineScale(340, 400) < scale, "short stages must fit the entire cabinet");
});

test("the complete cabinet and invisible lever target fit phone, landscape and tablet stages", () => {
  // Independent source-alpha measurement, rounded outward to unscaled artwork points.
  const silhouette = { left: 33, right: 157, top: 41, bottom: 294 };
  for (const [width, height] of [[250, 390], [280, 440], [340, 624], [380, 690], [700, 360], [768, 1024], [1, 1]]) {
    const frame = motion.sampleGachaCameraMotion(0, width, height);
    const scale = frame.presentationScale;
    assert.ok(Number.isFinite(scale) && scale > 0 && scale <= 2.6);
    for (const x of [silhouette.left, silhouette.right, 95 - 80, 95 + 80]) {
      const projectedX = width / 2 + (x - 95) * scale;
      assert.ok(projectedX >= 0 && projectedX <= width);
    }
    for (const y of [silhouette.top, silhouette.bottom, 338 * 0.6365 - 80, 338 * 0.6365 + 80]) {
      const projectedY = height / 2 + (y - 169) * scale;
      assert.ok(projectedY >= 0 && projectedY <= height);
    }
    assert.equal(motion.sampleGachaCameraMotion(0.8, width, height).presentationScale, scale);
  }
});

test("machine, outlet occlusion and capsule renderers consume the same responsive projection", () => {
  const base = new URL("../apps/mobile/src/features/draw/", import.meta.url);
  const machine = readFileSync(new URL("GachaLeverMachine.tsx", base), "utf8");
  const atlas = readFileSync(new URL("GachaCapsuleFrames.tsx", base), "utf8");
  const reference = readFileSync(new URL("GachaCapsule3D.tsx", base), "utf8");
  assert.equal((machine.match(/scale: camera\.presentationScale \* camera\.scale/g) ?? []).length, 2);
  assert.equal((atlas.match(/worldScale = camera\.presentationScale \* camera\.scale/g) ?? []).length, 2);
  assert.match(reference, /pickupScale = camera\.presentationScale \* camera\.scale/);
  for (const source of [machine, atlas, reference]) {
    assert.doesNotMatch(source, /MACHINE_PRESENTATION_SCALE|box\.presentationScale|GACHA_PICKUP_GEOMETRY\.presentationScale/);
  }
});
