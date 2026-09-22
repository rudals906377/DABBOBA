import assert from "node:assert/strict";
import test from "node:test";

import {
  GACHA_LEVER_COMPLETION_RADIANS,
  GACHA_LEVER_REQUIRED_TAPS,
  GACHA_LEVER_REQUIRED_TURNS,
  GACHA_LEVER_TARGET_RADIANS,
  advanceGachaLeverRadians,
  advanceGachaLeverTapRadians,
  createGachaLeverMotionState,
  isGachaLeverComplete,
  normalizeGachaLeverDelta,
  resolveGachaLeverTouchStart,
  resolveGachaLeverPointAngle,
  resolveGachaLeverProgress,
  transitionGachaLeverMotion,
} from "../apps/mobile/src/features/draw/gacha-lever-motion.ts";

test("the gacha lever requires one clockwise circle with a five-percent completion tolerance", () => {
  assert.equal(GACHA_LEVER_REQUIRED_TURNS, 1);
  assert.equal(GACHA_LEVER_TARGET_RADIANS, Math.PI * 2);
  assert.equal(GACHA_LEVER_COMPLETION_RADIANS, Math.PI * 2 * 0.95);
  assert.equal(isGachaLeverComplete(Math.PI * 2 * 0.949), false);
  assert.equal(isGachaLeverComplete(Math.PI * 2), true);
  assert.equal(isGachaLeverComplete(GACHA_LEVER_COMPLETION_RADIANS - 0.01), false);
  assert.equal(isGachaLeverComplete(GACHA_LEVER_COMPLETION_RADIANS), true);
  assert.equal(resolveGachaLeverProgress(0), 0);
  assert.equal(resolveGachaLeverProgress(GACHA_LEVER_TARGET_RADIANS), 1);
});

test("five taps stay incomplete and the sixth reaches the same one-turn target", () => {
  assert.equal(GACHA_LEVER_REQUIRED_TAPS, 6);
  let radians = 0;

  for (let tap = 1; tap <= 5; tap += 1) {
    radians = advanceGachaLeverTapRadians(radians);
    assert.ok(Math.abs(radians - Math.PI * 2 * tap / 6) < 1e-12);
    assert.equal(isGachaLeverComplete(radians), false);
  }

  radians = advanceGachaLeverTapRadians(radians);
  assert.ok(Math.abs(radians - Math.PI * 2) < 1e-12);
  assert.equal(isGachaLeverComplete(radians), true);
  assert.equal(
    advanceGachaLeverTapRadians(GACHA_LEVER_TARGET_RADIANS),
    GACHA_LEVER_TARGET_RADIANS,
  );
});

test("mixed taps and drag share net clockwise progress with the same one-turn threshold", () => {
  let radians = advanceGachaLeverTapRadians(advanceGachaLeverTapRadians(0));
  assert.ok(Math.abs(radians - Math.PI * 2 / 3) < 1e-12);
  const sweep = (turns) => {
    let previous = 0;
    for (let step = 1; step <= 120; step += 1) {
      const next = turns * Math.PI * 2 * step / 120;
      radians = advanceGachaLeverRadians(radians, previous, next);
      previous = next;
    }
  };
  sweep(0.5);
  sweep(-0.1);
  assert.ok(Math.abs(radians / (Math.PI * 2) - (1 / 3 + 0.4)) < 1e-12,
    "reverse drag subtracts progress instead of counting total distance traveled");
  assert.equal(isGachaLeverComplete(radians), false);
  sweep(0.95 - (1 / 3 + 0.4) - 1e-6);
  assert.equal(isGachaLeverComplete(radians), false);
  sweep(2e-6);
  assert.equal(isGachaLeverComplete(radians), true);
  assert.ok(radians < Math.PI * 2);
});

test("clockwise samples unwrap continuously across the angle boundary", () => {
  const center = 80;
  const radius = 58;
  let previousAngle = resolveGachaLeverPointAngle(center, center - radius, center, center, 36, 78);
  let radians = 0;

  assert.notEqual(previousAngle, null);
  for (let step = 1; step <= 96; step += 1) {
    const angle = -Math.PI / 2 + (GACHA_LEVER_TARGET_RADIANS * step) / 96;
    const nextAngle = resolveGachaLeverPointAngle(
      center + Math.cos(angle) * radius,
      center + Math.sin(angle) * radius,
      center,
      center,
      36,
      78,
    );
    assert.notEqual(nextAngle, null);
    radians = advanceGachaLeverRadians(radians, previousAngle, nextAngle);
    previousAngle = nextAngle;
  }

  assert.ok(Math.abs(radians - GACHA_LEVER_TARGET_RADIANS) < 0.001);
  assert.equal(isGachaLeverComplete(radians), true);
  assert.ok(normalizeGachaLeverDelta(-Math.PI * 2 + 0.08) > 0);
});

test("a clockwise circle can start with a finger placed directly on the visible lever", () => {
  const center = 80;
  const trackingRadius = 58;
  const start = resolveGachaLeverTouchStart(
    center,
    center,
    center,
    center,
    28,
    78,
  );
  let previousAngle = start.angle;
  let radians = 0;

  assert.equal(start.accepted, true);
  assert.equal(previousAngle, null);

  for (let step = 0; step <= 96; step += 1) {
    const angle = -Math.PI / 2 + (GACHA_LEVER_TARGET_RADIANS * step) / 96;
    const nextAngle = resolveGachaLeverPointAngle(
      center + Math.cos(angle) * trackingRadius,
      center + Math.sin(angle) * trackingRadius,
      center,
      center,
      28,
      78,
    );
    assert.notEqual(nextAngle, null);
    if (previousAngle !== null) {
      radians = advanceGachaLeverRadians(radians, previousAngle, nextAngle);
    }
    previousAngle = nextAngle;
  }

  assert.equal(isGachaLeverComplete(radians), true);
  assert.equal(
    resolveGachaLeverTouchStart(center + 79, center, center, center, 28, 78).accepted,
    false,
  );
});

test("reverse motion unwinds progress and off-track points do not count", () => {
  const clockwise = advanceGachaLeverRadians(Math.PI, 0, Math.PI / 4);
  const reversed = advanceGachaLeverRadians(clockwise, Math.PI / 4, 0);

  assert.equal(clockwise, Math.PI + Math.PI / 4);
  assert.equal(reversed, Math.PI);
  assert.equal(advanceGachaLeverRadians(0, Math.PI / 4, 0), 0);
  assert.equal(resolveGachaLeverPointAngle(80, 80, 80, 80, 36, 78), null);
  assert.equal(resolveGachaLeverPointAngle(170, 80, 80, 80, 36, 78), null);
});

test("coordinate jumps cannot manufacture lever progress", () => {
  const starting = Math.PI * 0.75;
  assert.equal(
    advanceGachaLeverRadians(starting, 0, Math.PI * 0.75),
    starting,
  );
  assert.ok(normalizeGachaLeverDelta(Math.PI * 2 - 0.08) < 0);
});

test("the gacha reveal waits for a committed result before dispensing", () => {
  let transition = transitionGachaLeverMotion(
    createGachaLeverMotionState(false),
    { type: "request" },
  );
  assert.equal(transition.state.phase, "waiting-result");
  assert.equal(transition.effect, "request-result");

  transition = transitionGachaLeverMotion(transition.state, {
    type: "dispense-settled",
    finished: true,
  });
  assert.equal(transition.state.phase, "waiting-result");
  assert.equal(transition.effect, "none");

  transition = transitionGachaLeverMotion(transition.state, { type: "result-ready" });
  assert.equal(transition.state.phase, "dispensing");
  assert.equal(transition.effect, "start-dispense");

  transition = transitionGachaLeverMotion(transition.state, {
    type: "dispense-settled",
    finished: true,
  });
  assert.equal(transition.state.phase, "revealed");
  assert.equal(transition.effect, "notify-settled");
});

test("reduced motion preserves the result gate and skips the dispense travel", () => {
  let transition = transitionGachaLeverMotion(
    createGachaLeverMotionState(true),
    { type: "request" },
  );
  assert.equal(transition.state.phase, "waiting-result");
  assert.equal(transition.effect, "request-result");

  transition = transitionGachaLeverMotion(transition.state, { type: "result-ready" });
  assert.equal(transition.state.phase, "revealed");
  assert.equal(transition.effect, "notify-settled");
});

test("an already committed result still waits for the explicit lever action", () => {
  let transition = transitionGachaLeverMotion(
    createGachaLeverMotionState(false),
    { type: "result-ready" },
  );
  assert.equal(transition.state.phase, "ready");
  assert.equal(transition.effect, "none");

  transition = transitionGachaLeverMotion(transition.state, { type: "request" });
  assert.equal(transition.state.phase, "dispensing");
  assert.equal(transition.effect, "start-dispense");

  const duplicate = transitionGachaLeverMotion(transition.state, { type: "request" });
  assert.equal(duplicate.state.phase, "dispensing");
  assert.equal(duplicate.effect, "none");
});
