import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  GACHA_LEVER_TARGET_RADIANS,
  advanceGachaLeverRadians,
  advanceGachaLeverTapRadians,
  isGachaLeverComplete,
  resolveGachaLeverPointAngle,
  resolveGachaLeverTouchStart,
} from "../apps/mobile/src/features/draw/gacha-lever-motion.ts";

const machine = readFileSync(new URL(
  "../apps/mobile/src/features/draw/GachaLeverMachine.tsx",
  import.meta.url,
), "utf8");
const finalizeSource = machine.match(
  /\.onFinalize\((\(_event, success\) => \{[\s\S]*?\n    \})\), \[/,
)?.[1];
assert.ok(finalizeSource, "release handling must also run when manual iOS Pan never enters ACTIVE");
const downSource = machine.match(/\.onTouchesDown\((\(event, manager\) => \{[\s\S]*?\n    \})\)\s*\.onTouchesUp/)?.[1];
const updateSource = machine.match(/\.onUpdate\((\(event\) => \{[\s\S]*?\n    \})\)\s*\.onFinalize/)?.[1];
assert.ok(downSource && updateSource, "execute the actual accepted-touch and continuous-drag handlers");
const numericConstant = (name) => {
  const match = machine.match(new RegExp(`const ${name} = ([\\d.]+);`));
  assert.ok(match, `${name} must be taken from the real gesture geometry`);
  return Number(match[1]);
};

function releaseHarness(startRadians = 0, { reduceMotion = false, animationFinishes = true } = {}) {
  const shared = (value) => ({ value });
  const requests = [];
  const scope = {
    previousAngle: shared(0),
    gestureEnded: shared(0),
    gestureAccepted: shared(1),
    gestureCompleted: shared(0),
    gestureTravel: shared(0),
    gestureStartRadians: shared(startRadians),
    interactionRadians: shared(startRadians),
    leverRadians: shared(startRadians),
    clockwiseCueRotation: shared(0.25),
    clockwiseCueOpacity: shared(1),
    animationRun: shared(7),
    GESTURE_TAP_SLOP: numericConstant("GESTURE_TAP_SLOP"),
    GESTURE_CENTER: numericConstant("GESTURE_SIZE") / 2,
    GESTURE_MIN_RADIUS: numericConstant("GESTURE_MIN_RADIUS"),
    GESTURE_MAX_RADIUS: numericConstant("GESTURE_MAX_RADIUS"),
    GACHA_LEVER_TARGET_RADIANS,
    advanceGachaLeverRadians,
    advanceGachaLeverTapRadians,
    isGachaLeverComplete,
    resolveGachaLeverPointAngle,
    resolveGachaLeverTouchStart,
    reduceMotion,
    cancelAnimation: () => {},
    smoothEasing: undefined,
    withTiming: (target, _options, callback) => {
      callback?.(animationFinishes);
      return target;
    },
    scheduleOnRN: (callback, run) => callback(run),
    beginOpen: (run) => requests.push(run),
  };
  const down = runInNewContext(`(${downSource})`, scope);
  const update = runInNewContext(`(${updateSource})`, scope);
  const finalize = runInNewContext(`(${finalizeSource})`, scope);
  return { scope, requests, down, update, finalize };
}

test("stationary manual-Pan END leaves five taps incomplete and requests one draw on tap six", () => {
  const { scope, requests, finalize } = releaseHarness();
  for (let tap = 1; tap <= 6; tap += 1) {
    scope.gestureStartRadians.value = scope.interactionRadians.value;
    scope.gestureAccepted.value = 1;
    scope.gestureEnded.value = 0;
    finalize({}, true);
    const afterRelease = scope.interactionRadians.value;
    finalize({}, true);
    assert.equal(scope.interactionRadians.value, afterRelease, "duplicate finalization cannot count a second tap");
    assert.ok(Math.abs(scope.interactionRadians.value - Math.PI * 2 * tap / 6) < 1e-12);
    assert.equal(requests.length, tap === 6 ? 1 : 0);
  }
  assert.deepEqual(requests, [7]);
  assert.equal(scope.leverRadians.value, Math.PI * 2);
});

function circleEvent(turns, center = 80, radius = 58) {
  const angle = -Math.PI / 2 + turns * Math.PI * 2;
  const x = center + Math.cos(angle) * radius;
  const y = center + Math.sin(angle) * radius;
  return { x, y, translationX: x - center, translationY: y - (center - radius) };
}

test("the real onUpdate requests once near 0.95 clockwise turns and eases the handle to 360 degrees", () => {
  for (const reduceMotion of [false, true]) {
    const { scope, requests, down, update, finalize } = releaseHarness(0, { reduceMotion });
    let activations = 0;
    down({ allTouches: [circleEvent(0)] }, { activate: () => { activations += 1; }, fail: () => assert.fail("valid plate-ring touch rejected") });
    assert.equal(activations, 1);
    assert.equal(scope.clockwiseCueOpacity.value, 0);
    let firstRequestStep;
    for (let step = 1; step <= 1_200; step += 1) {
      update(circleEvent(step / 1_000));
      if (step <= 949) assert.equal(requests.length, 0, "less than 95 percent cannot request a draw");
      if (requests.length && firstRequestStep === undefined) firstRequestStep = step;
    }
    assert.ok(firstRequestStep >= 950 && firstRequestStep <= 951,
      "floating-point point-angle accumulation may cross the 95 percent boundary on the next sample only");
    assert.deepEqual(requests, [7]);
    assert.equal(scope.gestureCompleted.value, 1);
    assert.equal(scope.leverRadians.value, Math.PI * 2);
    const completedRadians = scope.interactionRadians.value;
    update(circleEvent(-0.4));
    update(circleEvent(2));
    finalize({}, true);
    finalize({}, true);
    assert.equal(scope.interactionRadians.value, completedRadians);
    assert.equal(scope.leverRadians.value, Math.PI * 2);
    assert.deepEqual(requests, [7], "extra update/end events cannot dispatch twice");
  }
});

test("two accepted taps and a remaining clockwise drag use one shared completion budget", () => {
  const { scope, requests, down, update, finalize } = releaseHarness();
  const manager = { activate: () => {}, fail: () => assert.fail("valid lever touch rejected") };
  for (let tap = 0; tap < 2; tap += 1) {
    down({ allTouches: [{ x: 80, y: 80 }] }, manager);
    finalize({}, true);
  }
  assert.ok(Math.abs(scope.interactionRadians.value - Math.PI * 2 / 3) < 1e-12);
  assert.deepEqual(requests, []);
  down({ allTouches: [circleEvent(0)] }, manager);
  for (let step = 1; step <= 600; step += 1) update(circleEvent(step / 1_000));
  assert.deepEqual(requests, [], "two taps plus 0.60 turn is still below the 0.95-turn total");
  for (let step = 601; step <= 620; step += 1) update(circleEvent(step / 1_000));
  assert.deepEqual(requests, [7]);
  assert.equal(scope.leverRadians.value, Math.PI * 2);
  finalize({}, true);
  assert.deepEqual(requests, [7]);
});

test("rejected contact and a cancelled completion animation cannot issue a draw", () => {
  const invalid = releaseHarness();
  let rejected = 0;
  invalid.down({ allTouches: [{ x: 500, y: 500 }] }, { activate: () => assert.fail("outside touch activated"), fail: () => { rejected += 1; } });
  invalid.finalize({}, true);
  assert.equal(rejected, 1);
  assert.equal(invalid.scope.interactionRadians.value, 0);
  assert.deepEqual(invalid.requests, []);
  const cancelled = releaseHarness(0, { animationFinishes: false });
  cancelled.down({ allTouches: [circleEvent(0)] }, { activate: () => {}, fail: () => assert.fail("valid touch rejected") });
  for (let step = 1; step <= 1_000; step += 1) cancelled.update(circleEvent(step / 1_000));
  cancelled.finalize({}, false);
  assert.deepEqual(cancelled.requests, []);
});

test("cancelled taps and unfinished drags preserve only progress earned before contact", () => {
  for (const [success, travel] of [[false, 0], [false, 30], [true, 30]]) {
    const { scope, requests, finalize } = releaseHarness(Math.PI);
    scope.gestureTravel.value = travel;
    scope.interactionRadians.value = Math.PI + 0.4;
    scope.leverRadians.value = Math.PI + 0.4;
    finalize({}, success);
    assert.equal(scope.interactionRadians.value, Math.PI);
    assert.equal(scope.leverRadians.value, Math.PI);
    assert.equal(scope.gestureAccepted.value, 0);
    assert.deepEqual(requests, []);
  }
});

test("a completed circular gesture is not reset or requested twice on release", () => {
  const { scope, requests, finalize } = releaseHarness(Math.PI);
  scope.gestureCompleted.value = 1;
  scope.gestureTravel.value = 60;
  scope.interactionRadians.value = GACHA_LEVER_TARGET_RADIANS;
  scope.leverRadians.value = GACHA_LEVER_TARGET_RADIANS;
  finalize({}, true);
  assert.equal(scope.interactionRadians.value, GACHA_LEVER_TARGET_RADIANS);
  assert.equal(scope.leverRadians.value, GACHA_LEVER_TARGET_RADIANS);
  assert.deepEqual(requests, []);
});
