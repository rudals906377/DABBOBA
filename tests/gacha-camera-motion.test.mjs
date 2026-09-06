import assert from "node:assert/strict";
import test from "node:test";

import {
  GACHA_CAPSULE_DISPENSE_DURATION_MS,
  GACHA_PICKUP_GEOMETRY,
  resolveGachaMachineScale,
  sampleGachaCameraMotion,
  sampleGachaPickupMotion,
} from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";

const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} should equal ${expected}`);
};
const geometry = GACHA_PICKUP_GEOMETRY;
const restingX = geometry.left + geometry.restLeft + geometry.capsuleSize / 2;
const restingY = geometry.top + geometry.restTop + geometry.capsuleSize / 2;
const fixedX = (restingX - geometry.machineWidth / 2) * resolveGachaMachineScale(340, 624);
const fixedY = (restingY - geometry.machineHeight / 2) * resolveGachaMachineScale(340, 624);
const baseDiameter = geometry.capsuleSize * resolveGachaMachineScale(340, 624);

test("the 3D handoff finishes at pickup scale before the camera magnifies the shell", () => {
  const start = sampleGachaCameraMotion(0, 340, 624);
  const handoff = sampleGachaCameraMotion(0.03, 340, 624);
  close(start.overlayOpacity, 0);
  close(handoff.overlayOpacity, 1);
  close(handoff.scale, 1);
  close(handoff.capsuleDiameter, baseDiameter);
  assert.ok(sampleGachaCameraMotion(0.07, 340, 624).scale > handoff.scale);
});

test("the pickup capsule rests inside the source-image aperture behind its front lip", () => {
  // The actual source image maps its black aperture to x109..133, with the lip at y267.
  assert.equal(restingX, 121);
  assert.equal(restingY, 257);
  assert.ok(geometry.restLeft >= 0);
  assert.ok(geometry.restLeft + geometry.capsuleSize <= geometry.width);
  assert.ok(geometry.restTop + geometry.capsuleSize <= geometry.height);

  for (let step = 0; step <= 1_000; step += 1) {
    const frame = sampleGachaPickupMotion(step / 1_000, false);
    assert.ok(Object.values(frame).every(Number.isFinite));
    assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
    assert.ok(frame.shadowOpacity >= 0 && frame.shadowOpacity <= 1);
    const left = geometry.left + geometry.restLeft + frame.x;
    const top = geometry.top + geometry.restTop + frame.y;
    const bottom = top + geometry.capsuleSize;
    if (frame.opacity > 0 && bottom > geometry.top) {
      assert.ok(left >= 109, `capsule crossed the left aperture edge at ${step}`);
      assert.ok(left + geometry.capsuleSize <= 133, `capsule crossed the right aperture edge at ${step}`);
      assert.ok(bottom <= 267, `capsule fell in front of the pickup lip at ${step}`);
    }
    // The initial approach is intentionally above the clipped aperture; every impact stays above its floor.
    assert.ok(frame.y <= 0);
  }
});

test("the pickup fall accelerates under gravity and each parabolic bounce loses height", () => {
  for (const elapsed of [0, 0.25, 0.5, 0.75, 1]) {
    close(sampleGachaPickupMotion(0.48 + 0.17 * elapsed, false).y, -28 * (1 - elapsed ** 2));
  }
  const bounces = [[0.65, 0.75, 4.2], [0.75, 0.83, 1.7], [0.83, 0.88, 0.5]];
  let previousHeight = Infinity;
  for (const [start, end, height] of bounces) {
    assert.ok(height < previousHeight);
    previousHeight = height;
    close(sampleGachaPickupMotion(start, false).y, 0);
    close(sampleGachaPickupMotion(end, false).y, 0);
    for (const elapsed of [0.25, 0.5, 0.75]) {
      close(
        sampleGachaPickupMotion(start + (end - start) * elapsed, false).y,
        -4 * height * elapsed * (1 - elapsed),
      );
    }
  }
});

test("the capsule holds exactly still and remains visible before the camera takes over", () => {
  assert.ok(GACHA_CAPSULE_DISPENSE_DURATION_MS >= 1_400);
  assert.ok(GACHA_CAPSULE_DISPENSE_DURATION_MS <= 2_200);
  assert.ok(GACHA_CAPSULE_DISPENSE_DURATION_MS * 0.1 >= 160);
  const settled = sampleGachaPickupMotion(1, false);
  assert.equal(settled.x, 0);
  assert.equal(settled.y, 0);
  assert.equal(settled.rotation, 0);
  assert.equal(settled.opacity, 1);
  for (let step = 900; step <= 1_000; step += 1) {
    assert.deepEqual(sampleGachaPickupMotion(step / 1_000, false), settled);
  }

  const firstCameraFrame = sampleGachaCameraMotion(0, 340, 624);
  close(firstCameraFrame.capsuleX, 340 / 2 + fixedX);
  close(firstCameraFrame.capsuleY, 624 / 2 + fixedY);
  close(firstCameraFrame.capsuleDiameter, baseDiameter);
  assert.equal(firstCameraFrame.scale, 1);
  close(firstCameraFrame.translateX, 0);
  close(firstCameraFrame.translateY, 0);
});

test("one camera projects the fixed pickup point and every world feature at every viewport size", () => {
  for (const [width, height] of [[280, 440], [320, 568], [340, 624], [390, 844], [430, 932], [768, 1024], [1024, 768], [1, 1]]) {
    const presentationScale = resolveGachaMachineScale(width, height);
    const fixedX = (restingX - geometry.machineWidth / 2) * presentationScale;
    const fixedY = (restingY - geometry.machineHeight / 2) * presentationScale;
    const baseDiameter = geometry.capsuleSize * presentationScale;
    let previousScale = 1;
    let previousMachineOpacity = 1;
    let previousOverlayOpacity = 0;
    for (let step = 0; step <= 200; step += 1) {
      const frame = sampleGachaCameraMotion(step / 200, width, height);
      assert.ok(Object.values(frame).every(Number.isFinite));
      assert.ok(frame.scale >= previousScale - 1e-8);
      assert.ok(frame.machineOpacity <= previousMachineOpacity + 1e-8);
      assert.ok(frame.overlayOpacity >= previousOverlayOpacity - 1e-8);
      assert.ok(frame.machineOpacity >= 0 && frame.machineOpacity <= 1);
      assert.ok(frame.overlayOpacity >= 0 && frame.overlayOpacity <= 1);
      previousScale = frame.scale;
      previousMachineOpacity = frame.machineOpacity;
      previousOverlayOpacity = frame.overlayOpacity;

      close(frame.capsuleX, width / 2 + fixedX * frame.scale + frame.translateX);
      close(frame.capsuleY, height / 2 + fixedY * frame.scale + frame.translateY);
      close(frame.capsuleDiameter, baseDiameter * frame.scale);
      const projectedFeatureX = width / 2 - 55 * frame.scale + frame.translateX;
      const projectedFeatureY = height / 2 - 130 * frame.scale + frame.translateY;
      close(frame.capsuleX - projectedFeatureX, (fixedX + 55) * frame.scale);
      close(frame.capsuleY - projectedFeatureY, (fixedY + 130) * frame.scale);
    }
    const centered = sampleGachaCameraMotion(0.25, width, height);
    close(centered.capsuleX, width / 2);
    close(centered.capsuleY, height / 2);
    const focused = sampleGachaCameraMotion(1, width, height);
    close(focused.capsuleX, width / 2);
    close(focused.capsuleY, height / 2);
    close(focused.capsuleDiameter, Math.max(baseDiameter, Math.min(width * 0.76, height * 0.53)));
    assert.equal(focused.machineOpacity, 0);
    assert.equal(focused.overlayOpacity, 1);
    assert.deepEqual(sampleGachaCameraMotion(0.46, width, height), focused);
  }
});

test("invalid inputs and Reduced Motion keep deterministic finite frames without pickup travel", () => {
  for (const progress of [NaN, Infinity, -Infinity, -1]) {
    assert.deepEqual(sampleGachaPickupMotion(progress, false), sampleGachaPickupMotion(0, false));
    assert.deepEqual(sampleGachaCameraMotion(progress, 340, 624), sampleGachaCameraMotion(0, 340, 624));
  }
  assert.deepEqual(sampleGachaPickupMotion(2, false), sampleGachaPickupMotion(1, false));
  assert.deepEqual(sampleGachaCameraMotion(2, 340, 624), sampleGachaCameraMotion(1, 340, 624));
  for (const [width, height] of [[NaN, 624], [Infinity, 624], [-1, 624], [340, 0], [340, -1], [340, Infinity], [NaN, NaN]]) {
    assert.deepEqual(sampleGachaCameraMotion(0.24, width, height), sampleGachaCameraMotion(0.24, 340, 624));
  }
  for (const progress of [0, 0.5, 0.7, 0.85, 1]) {
    const pickup = sampleGachaPickupMotion(progress, true);
    assert.equal(pickup.x, 0);
    assert.equal(pickup.y, 0);
    assert.equal(pickup.rotation, 0);
    assert.equal(pickup.shadowOpacity, 0);
    assert.equal(pickup.opacity, progress >= 1 ? 1 : 0);
    assert.deepEqual(sampleGachaCameraMotion(progress, 390, 844, true), sampleGachaCameraMotion(0, 390, 844));
  }
});
