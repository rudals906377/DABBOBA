import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GACHA_AGITATION_DURATION_MS,
  GACHA_AGITATION_PULSE_TURNS,
  GACHA_CAPSULE_REVEAL_DURATION_MS,
  GACHA_CHAMBER_CAPSULES,
  GACHA_CHAMBER_HEIGHT,
  GACHA_CHAMBER_WIDTH,
  resolveGachaAgitationPulseCount,
  sampleGachaAgitatorMotion,
  sampleGachaCapsuleDispenseMotion,
  sampleGachaCapsuleMotion,
  sampleGachaCapsuleRevealMotion,
} from "../apps/mobile/src/features/draw/gacha-capsule-motion.ts";
import { GACHA_LEVER_TARGET_RADIANS } from "../apps/mobile/src/features/draw/gacha-lever-motion.ts";
import { GACHA_PICKUP_GEOMETRY } from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";

const component = readFileSync(
  new URL("../apps/mobile/src/features/draw/GachaLeverMachine.tsx", import.meta.url),
  "utf8",
);
const motionSource = readFileSync(
  new URL("../apps/mobile/src/features/draw/gacha-capsule-motion.ts", import.meta.url),
  "utf8",
);
const capsuleVisual = readFileSync(
  new URL("../apps/mobile/src/features/draw/GachaCapsuleVisual.tsx", import.meta.url),
  "utf8",
);

const settledCapsulePose = (capsule) => ({
  translateX: 0,
  translateY: 0,
  rotateDeg: capsule.restRotation,
  scaleX: 1,
  scaleY: 1,
});

const settledDispensePose = {
  translateX: 0,
  translateY: 0,
  rotateDeltaDeg: 0,
  opacity: 1,
};

const sampleCapsule = (capsule, impulseProgress, reduceMotion = false) => sampleGachaCapsuleMotion(
  impulseProgress,
  capsule.index,
  capsule.size,
  capsule.rollDistance,
  capsule.liftHeight,
  capsule.impulseDelayMs,
  capsule.responseDurationMs,
  capsule.restRotation,
  reduceMotion,
);

const sampleDispense = (capsule, dispenseProgress, reduceMotion = false) => sampleGachaCapsuleDispenseMotion(
  dispenseProgress,
  capsule.isDispenseCapsule,
  capsule.dispenseX,
  capsule.dispenseY,
  capsule.settleX,
  capsule.settleY,
  reduceMotion,
);

const capsuleFrames = (capsule) => Array.from(
  { length: GACHA_AGITATION_DURATION_MS + 1 },
  (_, elapsedMs) => sampleCapsule(capsule, elapsedMs / GACHA_AGITATION_DURATION_MS),
);

const frameMoved = (frame, threshold = 0.02) => (
  Math.abs(frame.translateX) > threshold
  || Math.abs(frame.translateY) > threshold
);

const renderedCapsuleDiameter = (capsule) => capsule.size * capsule.visualScale;

const capsuleCenter = (capsule) => ({
  x: capsule.left + capsule.size / 2,
  y: capsule.top + capsule.size / 2,
});

const capsuleOverlap = (first, second) => {
  const firstCenter = capsuleCenter(first);
  const secondCenter = capsuleCenter(second);
  const centerDistance = Math.hypot(
    firstCenter.x - secondCenter.x,
    firstCenter.y - secondCenter.y,
  );
  return (renderedCapsuleDiameter(first) + renderedCapsuleDiameter(second)) / 2 - centerDistance;
};

const hasMeaningfulCapsuleOverlap = (first, second) => (
  capsuleOverlap(first, second)
  >= Math.min(renderedCapsuleDiameter(first), renderedCapsuleDiameter(second)) * 0.08
);

test("the chamber contains twenty-six bounded capsules in a dense three-depth pile", () => {
  assert.equal(GACHA_CHAMBER_CAPSULES.length, 26);
  assert.equal(new Set(GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.id)).size, 26);
  assert.deepEqual(
    GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.index),
    Array.from({ length: 26 }, (_, index) => index),
  );
  assert.deepEqual(
    new Set(GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.tone)),
    new Set(["lime", "ivory"]),
  );

  const rowCounts = Object.fromEntries(
    ["upper", "middle", "lower"].map((row) => [
      row,
      GACHA_CHAMBER_CAPSULES.filter((capsule) => capsule.mechanicalRow === row).length,
    ]),
  );
  assert.deepEqual(rowCounts, { upper: 12, middle: 9, lower: 5 });

  const depthCounts = new Map();
  for (const capsule of GACHA_CHAMBER_CAPSULES) {
    assert.equal(capsule.size, 17);
    assert.ok(Number.isFinite(capsule.visualScale));
    assert.ok(capsule.visualScale >= 0.89 && capsule.visualScale <= 1.06);
    depthCounts.set(capsule.depth, (depthCounts.get(capsule.depth) ?? 0) + 1);
    const center = capsuleCenter(capsule);
    const radius = renderedCapsuleDiameter(capsule) / 2;
    assert.ok(center.x - radius >= 3.5);
    assert.ok(center.y - radius >= 10);
    assert.ok(center.x + radius <= GACHA_CHAMBER_WIDTH - 3);
    assert.ok(center.y + radius <= GACHA_CHAMBER_HEIGHT - 2);
  }
  assert.deepEqual([...depthCounts.keys()].sort(), [0, 1, 2]);
  assert.ok([...depthCounts.values()].every((count) => count >= 6));
  assert.deepEqual(
    GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.stackOrder).sort((a, b) => a - b),
    Array.from({ length: 26 }, (_, index) => index + 1),
  );
  assert.ok(
    new Set(GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.top)).size >= 14,
    "the pile must not collapse into a few perfectly flat rows",
  );

  const mixedMechanicalRows = ["upper", "middle", "lower"].filter((row) => (
    new Set(
      GACHA_CHAMBER_CAPSULES
        .filter((capsule) => capsule.mechanicalRow === row)
        .map((capsule) => capsule.depth),
    ).size >= 2
  ));
  assert.ok(mixedMechanicalRows.length >= 2, "visual depth must not be locked to vertical motion rows");

  const allDepthsShareAHeightBand = GACHA_CHAMBER_CAPSULES.some((bandStartCapsule) => {
    const bandStart = capsuleCenter(bandStartCapsule).y;
    const bandDepths = new Set(
      GACHA_CHAMBER_CAPSULES
        .filter((capsule) => {
          const centerY = capsuleCenter(capsule).y;
          return centerY >= bandStart && centerY <= bandStart + 17;
        })
        .map((capsule) => capsule.depth),
    );
    return bandDepths.size === 3;
  });
  assert.ok(allDepthsShareAHeightBand, "back, middle, and front capsules must interleave at one height");

  const overlapPairs = [];
  const crossDepthOverlapPairs = [];

  for (let firstIndex = 0; firstIndex < GACHA_CHAMBER_CAPSULES.length; firstIndex += 1) {
    const first = GACHA_CHAMBER_CAPSULES[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < GACHA_CHAMBER_CAPSULES.length; secondIndex += 1) {
      const second = GACHA_CHAMBER_CAPSULES[secondIndex];
      const overlap = capsuleOverlap(first, second);
      assert.ok(
        overlap <= Math.min(renderedCapsuleDiameter(first), renderedCapsuleDiameter(second)) * 0.36,
        `${first.id} and ${second.id} merge too deeply to read as separate capsules`,
      );
      if (hasMeaningfulCapsuleOverlap(first, second)) {
        overlapPairs.push([first.id, second.id]);
        if (first.depth !== second.depth) crossDepthOverlapPairs.push([first.id, second.id]);
      }
    }
  }
  assert.ok(overlapPairs.length >= GACHA_CHAMBER_CAPSULES.length * 1.2, "the pile needs visible contact and overlap instead of grid gaps");
  assert.ok(crossDepthOverlapPairs.length >= GACHA_CHAMBER_CAPSULES.length * 0.9, "front capsules must visibly occlude back capsules");

  const overlapNeighbors = new Map(
    GACHA_CHAMBER_CAPSULES.map((capsule) => [capsule.id, new Set()]),
  );
  for (const [firstId, secondId] of overlapPairs) {
    overlapNeighbors.get(firstId).add(secondId);
    overlapNeighbors.get(secondId).add(firstId);
  }
  assert.ok(
    [...overlapNeighbors.values()].filter((neighbors) => neighbors.size > 0).length >= Math.ceil(GACHA_CHAMBER_CAPSULES.length * 0.9),
    "almost every capsule must participate in the packed mass",
  );
  assert.ok(
    Math.max(...[...overlapNeighbors.values()].map((neighbors) => neighbors.size)) >= 4,
    "the center of the pile needs multi-capsule contact",
  );

  const visited = new Set();
  const pending = [GACHA_CHAMBER_CAPSULES[0].id];
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of overlapNeighbors.get(current)) pending.push(neighbor);
  }
  assert.ok(visited.size >= Math.ceil(GACHA_CHAMBER_CAPSULES.length * 0.9), "the pile must read as one connected mass");

  for (const frontCapsule of GACHA_CHAMBER_CAPSULES.filter((capsule) => capsule.depth === 2)) {
    assert.ok(
      GACHA_CHAMBER_CAPSULES.some((other) => (
        other.id !== frontCapsule.id
        && hasMeaningfulCapsuleOverlap(frontCapsule, other)
      )),
      `${frontCapsule.id} must visibly touch the packed pile`,
    );
  }
});

test("each mechanical row has a restrained local roll instead of a chamber-wide jump", () => {
  const metricsByRow = { upper: [], middle: [], lower: [] };

  for (const capsule of GACHA_CHAMBER_CAPSULES) {
    const frames = capsuleFrames(capsule);
    const metrics = {
      maxHorizontal: Math.max(...frames.map((frame) => Math.abs(frame.translateX))),
      maxLift: Math.max(...frames.map((frame) => -frame.translateY)),
      maxRoll: Math.max(...frames.map((frame) => Math.abs(frame.rotateDeg - capsule.restRotation))),
    };
    metricsByRow[capsule.mechanicalRow].push(metrics);
    assert.ok(frames.every((frame) => frame.translateY <= 0), `${capsule.id} must not be pumped downward`);

    if (capsule.mechanicalRow === "lower") {
      assert.ok(metrics.maxHorizontal >= 2.4 && metrics.maxHorizontal <= 5.2);
      assert.ok(metrics.maxLift <= 1.25);
      assert.ok(metrics.maxRoll >= 15 && metrics.maxRoll <= 32);
    } else if (capsule.mechanicalRow === "middle") {
      assert.ok(metrics.maxHorizontal <= 1.8);
      assert.ok(metrics.maxLift <= 0.8);
      assert.ok(metrics.maxRoll <= 12);
    } else {
      assert.ok(metrics.maxHorizontal <= 0.4);
      assert.ok(metrics.maxLift <= 0.2);
      assert.ok(metrics.maxRoll <= 2.5);
    }
  }

  const rowPeakAverage = (row) => (
    metricsByRow[row].reduce((sum, metrics) => sum + metrics.maxHorizontal, 0)
    / metricsByRow[row].length
  );
  assert.ok(rowPeakAverage("lower") > rowPeakAverage("middle") * 2.5);
  assert.ok(rowPeakAverage("middle") > rowPeakAverage("upper") * 3);
  assert.ok(
    GACHA_CHAMBER_CAPSULES
      .filter((capsule) => capsule.mechanicalRow === "upper")
      .filter((capsule) => capsule.rollDistance === 0 && capsule.liftHeight === 0)
      .length >= 3,
    "at least half of the top tier should remain visually braced",
  );
});

test("the finite agitator sweep leads the lower, middle, and upper responses", () => {
  const tau = 2 * Math.PI;
  assert.deepEqual(GACHA_AGITATION_PULSE_TURNS, [0.09, 0.59]);
  assert.equal(resolveGachaAgitationPulseCount(0.08 * tau), 0);
  assert.equal(resolveGachaAgitationPulseCount(0.09 * tau), 1);
  assert.equal(resolveGachaAgitationPulseCount(0.58 * tau), 1);
  assert.equal(resolveGachaAgitationPulseCount(0.59 * tau), 2);
  assert.equal(resolveGachaAgitationPulseCount(GACHA_LEVER_TARGET_RADIANS), 2);

  const agitatorFrames = Array.from(
    { length: GACHA_AGITATION_DURATION_MS + 1 },
    (_, elapsedMs) => sampleGachaAgitatorMotion(elapsedMs / GACHA_AGITATION_DURATION_MS, false),
  );
  const firstAgitatorMotion = agitatorFrames.findIndex((frame) => (
    Math.abs(frame.translateX) > 0.02 || Math.abs(frame.translateY) > 0.02
  ));
  const firstRowMotion = (row) => {
    for (let elapsedMs = 0; elapsedMs <= GACHA_AGITATION_DURATION_MS; elapsedMs += 1) {
      const impulseProgress = elapsedMs / GACHA_AGITATION_DURATION_MS;
      if (GACHA_CHAMBER_CAPSULES
        .filter((capsule) => capsule.mechanicalRow === row)
        .some((capsule) => frameMoved(sampleCapsule(capsule, impulseProgress)))) return elapsedMs;
    }
    return Number.POSITIVE_INFINITY;
  };

  const firstLowerMotion = firstRowMotion("lower");
  const firstMiddleMotion = firstRowMotion("middle");
  const firstUpperMotion = firstRowMotion("upper");
  assert.ok(firstAgitatorMotion >= 0 && firstAgitatorMotion < firstLowerMotion);
  assert.ok(firstLowerMotion < firstMiddleMotion);
  assert.ok(firstMiddleMotion < firstUpperMotion);
  assert.ok(Math.max(...agitatorFrames.map((frame) => frame.translateX)) >= 3.2);
  assert.ok(Math.min(...agitatorFrames.map((frame) => frame.translateY)) >= -0.6);
  assert.deepEqual(sampleGachaAgitatorMotion(0, false), sampleGachaAgitatorMotion(1, false));
  assert.deepEqual(sampleGachaAgitatorMotion(0.75, false), sampleGachaAgitatorMotion(1, false));
});

test("capsule agitation is deterministic, finite, and fully disabled by Reduced Motion", () => {
  const traceSignatures = new Set();

  for (const capsule of GACHA_CHAMBER_CAPSULES) {
    assert.deepEqual(sampleCapsule(capsule, 0), settledCapsulePose(capsule));
    assert.deepEqual(sampleCapsule(capsule, 0.9), settledCapsulePose(capsule));
    assert.deepEqual(sampleCapsule(capsule, 1), settledCapsulePose(capsule));
    assert.deepEqual(sampleCapsule(capsule, 0.42, true), settledCapsulePose(capsule));

    const trace = [0.12, 0.28, 0.42, 0.58, 0.74].map((progress) => sampleCapsule(capsule, progress));
    assert.deepEqual(
      trace,
      [0.12, 0.28, 0.42, 0.58, 0.74].map((progress) => sampleCapsule(capsule, progress)),
    );
    traceSignatures.add(JSON.stringify(trace));
  }

  assert.ok(traceSignatures.size >= 14, "the pile should not move as one rigid layer");
  assert.deepEqual(sampleGachaAgitatorMotion(0.4, true), sampleGachaAgitatorMotion(1, false));
});

test("exactly one lower-right capsule is aligned and hidden for dispensing", () => {
  const candidates = GACHA_CHAMBER_CAPSULES.filter((capsule) => capsule.isDispenseCapsule);
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.mechanicalRow, "lower");
  assert.equal(candidate.depth, Math.max(...GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.depth)));
  assert.equal(candidate.stackOrder, Math.max(...GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.stackOrder)));
  assert.equal(candidate.left, Math.max(...GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.left)));
  assert.ok(candidate.dispenseY >= 14);

  const exited = sampleDispense(candidate, 1);
  assert.equal(exited.translateX, candidate.dispenseX);
  assert.equal(exited.translateY, candidate.dispenseY);
  assert.equal(exited.opacity, 0);
  assert.ok(candidate.top + exited.translateY > GACHA_CHAMBER_HEIGHT - 7);

  const fadedCapsules = GACHA_CHAMBER_CAPSULES
    .filter((capsule) => sampleDispense(capsule, 1).opacity < 1);
  assert.deepEqual(fadedCapsules.map((capsule) => capsule.id), [candidate.id]);

  const chamberStyleMatch = component.match(/capsuleChamber:\s*\{[\s\S]*?left:\s*(\d+),/);
  assert.ok(chamberStyleMatch);
  assert.match(component, /dispenseTrack:\s*\{[\s\S]*?left: GACHA_PICKUP_GEOMETRY.left/);
  assert.match(component, /dispensedCapsule:\s*\{[\s\S]*?left: GACHA_PICKUP_GEOMETRY.restLeft/);
  const chamberLeft = Number(chamberStyleMatch[1]);
  const exitingCenter = chamberLeft
    + candidate.left
    + candidate.dispenseX
    + candidate.size / 2;
  const chuteCenter = GACHA_PICKUP_GEOMETRY.left + GACHA_PICKUP_GEOMETRY.restLeft + GACHA_PICKUP_GEOMETRY.capsuleSize / 2;
  assert.ok(Math.abs(exitingCenter - chuteCenter) <= 3);
});

test("the result-driven exit settles only the supporting neighborhood into the vacancy", () => {
  const candidate = GACHA_CHAMBER_CAPSULES.find((capsule) => capsule.isDispenseCapsule);
  assert.ok(candidate);

  for (const capsule of GACHA_CHAMBER_CAPSULES) {
    assert.deepEqual(sampleDispense(capsule, 0), settledDispensePose);
    assert.deepEqual(sampleDispense(capsule, 0.7, true), settledDispensePose);
    if (capsule.isDispenseCapsule) {
      assert.ok(Math.abs(sampleDispense(capsule, 0.2).translateX) > 3);
    } else {
      assert.deepEqual(sampleDispense(capsule, 0.5), settledDispensePose);
    }
  }

  const significantSettlers = GACHA_CHAMBER_CAPSULES
    .filter((capsule) => !capsule.isDispenseCapsule)
    .filter((capsule) => Math.abs(capsule.settleX) >= 2.5 || capsule.settleY >= 2.5)
  assert.ok(significantSettlers.length >= 1 && significantSettlers.length <= 4);

  const candidateCenter = capsuleCenter(candidate);
  for (const capsule of significantSettlers) {
    assert.ok(
      hasMeaningfulCapsuleOverlap(capsule, candidate),
      `${capsule.id} must be an immediate contact neighbor of the vacated capsule`,
    );
    const start = capsuleCenter(capsule);
    const end = {
      x: start.x + capsule.settleX,
      y: start.y + capsule.settleY,
    };
    assert.ok(
      Math.hypot(end.x - candidateCenter.x, end.y - candidateCenter.y)
      < Math.hypot(start.x - candidateCenter.x, start.y - candidateCenter.y),
      `${capsule.id} must settle toward the vacated pocket`,
    );
  }

  for (const capsule of GACHA_CHAMBER_CAPSULES.filter((entry) => !entry.isDispenseCapsule)) {
    const settled = sampleDispense(capsule, 1);
    assert.equal(settled.opacity, 1);
    assert.equal(settled.translateX, capsule.settleX);
    assert.equal(settled.translateY, capsule.settleY);
    assert.ok(capsule.left + settled.translateX >= 0);
    assert.ok(capsule.left + settled.translateX + capsule.size <= GACHA_CHAMBER_WIDTH);
    assert.ok(capsule.top + settled.translateY + capsule.size <= GACHA_CHAMBER_HEIGHT);
  }
});

test("the capsule opens gently during approach without rattles or a rectangular background flash", () => {
  assert.equal(GACHA_CAPSULE_REVEAL_DURATION_MS, 3_000);

  const atChute = sampleGachaCapsuleRevealMotion(0, false);
  const focused = sampleGachaCapsuleRevealMotion(0.34, false);
  const stableFrames = [0.36, 0.41, 0.46, 0.52, 0.57, 0.62, 0.68]
    .map((progress) => sampleGachaCapsuleRevealMotion(progress, false));
  const flashPeak = sampleGachaCapsuleRevealMotion(0.81, false);
  const opened = sampleGachaCapsuleRevealMotion(0.96, false);
  const finished = sampleGachaCapsuleRevealMotion(1, false);

  assert.equal(atChute.capsuleTranslateY, 0);
  assert.equal(atChute.capsuleTranslateX, 0);
  assert.equal(atChute.capsuleScale, 1);
  assert.ok(Math.abs(focused.capsuleTranslateX) < 0.1);
  assert.ok(Math.abs(focused.capsuleTranslateY) < 0.1);
  assert.ok(focused.capsuleScale >= 1);
  assert.equal(new Set(stableFrames.map((frame) => frame.capsuleRotateDeg)).size, 1);
  assert.ok(stableFrames.every((frame) => frame.capsuleTranslateX === 0));
  assert.equal(flashPeak.flashOpacity, 0);
  const held = [0, 0.08, 0.16].map((progress) => sampleGachaCapsuleRevealMotion(progress, false));
  assert.ok(held.every((frame) => frame.upperTranslateY === 0 && frame.lowerTranslateY === 0));
  assert.equal(held[0].capsuleScale, held[2].capsuleScale, "only the camera magnifies the world capsule");
  const sealCrack = sampleGachaCapsuleRevealMotion(0.25, false);
  assert.ok(Math.abs(sealCrack.upperTranslateY) <= 4, "the light leaks through a small gap before release");
  assert.ok((0.84 - 0.18) * GACHA_CAPSULE_REVEAL_DURATION_MS >= 1_900, "the quiet overlapping opening is intentionally gentle");
  assert.ok(focused.upperTranslateY < 0 && focused.lowerTranslateY > 0, "the fallback opens before the camera finishes approaching");
  assert.ok(opened.upperTranslateY < -30);
  assert.ok(opened.lowerTranslateY > 30);
  assert.ok(finished.capsuleOpacity === 1);
  assert.ok(finished.machineOpacity === 0);
  let previousGap = 0;
  for (let index = 0; index <= 1_000; index += 1) {
    const frame = sampleGachaCapsuleRevealMotion(index / 1_000, false);
    assert.equal(frame.upperTranslateX, 0);
    assert.equal(frame.lowerTranslateX, 0);
    assert.equal(frame.upperRotateDeg, 0);
    assert.equal(frame.lowerRotateDeg, 0);
    assert.ok(Math.abs(frame.upperTranslateY + frame.lowerTranslateY) < 1e-12,
      "the fallback halves must open symmetrically around the same inner source");
    const gap = frame.lowerTranslateY - frame.upperTranslateY;
    assert.ok(gap >= previousGap, "the quiet opening must not rattle back closed");
    previousGap = gap;
  }

  const reduced = sampleGachaCapsuleRevealMotion(0.62, true);
  assert.equal(reduced.capsuleTranslateX, 0);
  assert.equal(reduced.capsuleTranslateY, 0);
  assert.equal(reduced.capsuleRotateDeg, 0);
  assert.equal(reduced.flashOpacity, 0);
  assert.equal(reduced.upperTranslateY, 0);
  assert.equal(reduced.lowerTranslateY, 0);
});

test("the chamber, chute, and cinematic reveal reuse one capsule visual", () => {
  assert.match(capsuleVisual, /export function GachaCapsuleVisual/);
  assert.match(capsuleVisual, /tone: GachaCapsuleTone/);
  assert.match(component, /import \{ GachaCapsuleVisual \}/);
  assert.ok(
    (component.match(/<GachaCapsuleVisual/g) ?? []).length >= 2,
    "the chamber and emitted capsule must share the same visual primitive",
  );
  assert.match(component, /testID="gacha-capsule-cinematic"/);
  assert.match(component, /sampleGachaCapsuleRevealMotion\(revealProgress\.value, reduceMotion\)/);
  assert.match(
    component,
    /revealActive\.value = 1/,
  );
  assert.match(
    component,
    /revealProgress\.value = withDelay\([\s\S]*?GACHA_CAPSULE_REVEAL_DURATION_MS[\s\S]*?scheduleOnRN\(handleRevealSettled/,
  );
  assert.match(component, /styles\.cinematicCapsuleLayer, closedCapsuleStyle/);
  assert.match(component, /styles\.cinematicCapsuleLayer, splitCapsuleStyle/);
  assert.match(component, /styles.capsuleLightWash, lightWashStyle/);
  assert.doesNotMatch(component, /styles.revealFlash/);
  assert.ok(
    (component.match(/heroDetail/g) ?? []).length >= 3,
    "the emitted and opening capsule must preserve the detailed shared finish",
  );
  assert.match(capsuleVisual, /heroGlossStepWide/);
  assert.match(capsuleVisual, /heroMakerMark/);
  assert.match(capsuleVisual, /heroLightRim/);
  assert.match(capsuleVisual, /heroDarkRim/);
  assert.match(capsuleVisual, /heroCouplingGroove/);
  assert.match(capsuleVisual, /heroUpperCavity/);
  assert.match(capsuleVisual, /heroLowerCavity/);
  assert.match(component, /styles\.dispenseCapsuleShadow/);
  assert.match(component, /styles\.cinematicShadowOuter/);
  assert.match(component, /styles\.cinematicShadowCore/);
  assert.doesNotMatch(component, /Math\.random|setTimeout|setInterval/);
});

test("the native chamber wires agitation and result-time settlement on the UI thread", () => {
  assert.match(component, /GACHA_CHAMBER_CAPSULES\.map/);
  assert.match(component, /function GachaChamberCapsule/);
  assert.match(component, /function GachaCapsuleContactShadow/);
  assert.match(component, /function GachaChamberAgitator/);
  assert.match(
    component,
    /useAnimatedReaction\([\s\S]*?resolveGachaAgitationPulseCount\(leverRadians\.value\)[\s\S]*?agitationProgress\.value = withTiming/,
  );
  assert.match(
    component,
    /sampleGachaCapsuleMotion\(\s*impulseProgress\.value,\s*capsule\.index,\s*capsule\.size,\s*capsule\.rollDistance,\s*capsule\.liftHeight,\s*capsule\.impulseDelayMs,\s*capsule\.responseDurationMs,\s*capsule\.restRotation,\s*reduceMotion,/,
  );
  assert.match(
    component,
    /sampleGachaCapsuleDispenseMotion\(\s*dispenseProgress\.value,\s*capsule\.isDispenseCapsule,\s*capsule\.dispenseX,\s*capsule\.dispenseY,\s*capsule\.settleX,\s*capsule\.settleY,\s*reduceMotion,/,
  );
  assert.match(component, /if \(resultReady\) dispatchRef\.current\(\{ type: "result-ready" \}\)/);
  assert.match(component, /transition\.effect === "start-dispense"[\s\S]*?dispenseProgress\.value = withTiming/);
  assert.match(component, /capsuleChamber:\s*\{[\s\S]*?overflow:\s*"hidden"/);
  assert.match(component, /dispenseTrack:\s*\{[\s\S]*?overflow:\s*"hidden"/);
  assert.match(component, /styles\.chamberFrontLip/);
  assert.match(component, /styles\.capsuleContactShadow/);
  assert.match(component, /frame\.scaleX \* capsule\.visualScale/);
  assert.match(component, /frame\.scaleY \* capsule\.visualScale/);
  assert.match(component, /19 \+ capsule\.stackOrder \* 2/);
  assert.match(component, /20 \+ capsule\.stackOrder \* 2/);
  assert.match(component, /chamberGlassTint:[\s\S]*?zIndex:\s*200/);
  assert.match(component, /chamberFrontLip:[\s\S]*?zIndex:\s*203/);
  assert.match(capsuleVisual, /styles\.highlightPixel/);
  assert.match(capsuleVisual, /styles\.upperSideShade/);
  assert.match(capsuleVisual, /styles\.bottomShade/);
});

test("the motion model is seeded by configuration and contains no render-time randomness", () => {
  assert.doesNotMatch(motionSource, /Math\.random|Date\.now|setTimeout|setInterval/);
  assert.doesNotMatch(motionSource, /withRepeat|withTiming/);

  for (const capsule of GACHA_CHAMBER_CAPSULES) {
    for (const progress of [0.07, 0.23, 0.41, 0.66, 0.93]) {
      assert.deepEqual(sampleCapsule(capsule, progress), sampleCapsule(capsule, progress));
      assert.deepEqual(sampleDispense(capsule, progress), sampleDispense(capsule, progress));
    }
  }
});

test("the packed chamber keeps simple capsule faces and builds depth through opaque overlap", () => {
  const chamber = component.split("function GachaChamberCapsule(")[1]?.split("const styles = StyleSheet.create")[0] ?? "";
  assert.match(chamber, /<GachaCapsuleVisual tone=\{capsule.tone\} depth=\{capsule.depth\} diameter=\{capsule.size\} \/>/);
  assert.doesNotMatch(chamber, /heroDetail|GachaCapsule3D|GachaCapsuleFrames|GachaChamberCapsuleVisual/);
  assert.match(chamber, /opacity: dispenseFrame.opacity,/);
  assert.doesNotMatch(chamber, /depthOpacity/);
  assert.match(chamber, /shadowOpacity: capsule.depth === 2 \? 0.34 : capsule.depth === 1 \? 0.22 : 0.12/);
  assert.match(component, /top: capsule.top \+ capsule.size \* 0.78/);
});

test("one small arrow orbits outside the lever plate clockwise until the lever is touched", () => {
  const readPresentationConstant = (name) => {
    const match = component.match(new RegExp(`const ${name} = ([\\d.]+);`));
    assert.ok(match, `${name} must remain an explicit presentation constant`);
    return Number(match[1]);
  };
  const crankPlateSize = readPresentationConstant("CRANK_PLATE_SIZE");
  const arrowWidth = readPresentationConstant("LEVER_CUE_ARROW_WIDTH");
  const arrowHeight = readPresentationConstant("LEVER_CUE_ARROW_HEIGHT");
  const cueRotationDurationMs = readPresentationConstant("LEVER_CUE_ROTATION_DURATION_MS");

  assert.equal(crankPlateSize, 41);
  assert.equal(arrowWidth, 10);
  assert.equal(arrowHeight, 8);
  assert.equal(cueRotationDurationMs, 2600);
  assert.ok(arrowWidth < crankPlateSize / 4, "the orbit carries a small arrow, not another plate-sized icon");
  assert.match(component, /const LEVER_CUE_ORBIT_SIZE = CRANK_PLATE_SIZE \+ 14;/);
  assert.match(component, /<GestureDetector gesture=\{interactionGesture\}>[\s\S]*?styles\.leverTouchTarget/);
  assert.equal((component.match(/testID="gacha-lever-clockwise-cue"/g) ?? []).length, 1);
  assert.match(
    component,
    /<Animated\.View[\s\S]*?testID="gacha-lever-clockwise-cue"[\s\S]*?pointerEvents="none"[\s\S]*?styles\.leverRotationCue[\s\S]*?clockwiseCueStyle[\s\S]*?<Svg[\s\S]*?styles\.leverRotationArrow[\s\S]*?<Path/,
  );
  assert.match(component, /const clockwiseCueRotation = useSharedValue\(0\)/);
  assert.match(component, /const clockwiseCueOpacity = useSharedValue\(1\)/);
  assert.match(
    component,
    /clockwiseCueRotation\.value = withRepeat\([\s\S]*?withTiming\(1,\s*\{\s*duration:\s*LEVER_CUE_ROTATION_DURATION_MS,\s*easing:\s*Easing\.linear\s*\}\)[\s\S]*?-1,[\s\S]*?false/,
  );
  assert.match(
    component,
    /if \(reduceMotion \|\| phase !== "ready" \|\| clockwiseCueOpacity\.value <= 0\) return/,
  );
  assert.match(
    component,
    /if \(!start\.accepted\) \{[\s\S]*?manager\.fail\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?cancelAnimation\(clockwiseCueRotation\);[\s\S]*?clockwiseCueOpacity\.value = 0/,
  );
  assert.match(
    component,
    /const autoCompleteLever = useCallback\(\(\) => \{[\s\S]*?cancelAnimation\(clockwiseCueRotation\);[\s\S]*?clockwiseCueOpacity\.value = 0/,
  );
  assert.match(
    component,
    /const clockwiseCueStyle = useAnimatedStyle\(\(\) => \(\{[\s\S]*?rotate: `\$\{clockwiseCueRotation\.value \* 360\}deg`/,
  );

  const handleIndex = component.indexOf("source={GACHA_CRANK_HANDLE}");
  const cueIndex = component.indexOf('testID="gacha-lever-clockwise-cue"');
  assert.ok(handleIndex >= 0 && cueIndex > handleIndex, "the cue must render in front of the crank handle");
  assert.doesNotMatch(component, /refresh-outline|LEVER_CUE_ICON_SIZE/);
  const cue = component.slice(cueIndex, component.indexOf("</Animated.View>", cueIndex));
  assert.equal((cue.match(/<Svg\b/g) ?? []).length, 1);
  assert.equal((cue.match(/<Path\b/g) ?? []).length, 1);
  assert.doesNotMatch(cue, /<Circle|<Ellipse|<Line|<Polyline|<Ionicons/);
  assert.match(cue, /width=\{LEVER_CUE_ARROW_WIDTH\}[\s\S]*?height=\{LEVER_CUE_ARROW_HEIGHT\}[\s\S]*?viewBox="0 0 10 8"/);
  assert.match(cue, /fill=\{colors.brand\}/);
  assert.match(
    component,
    /leverRotationCue:\s*\{[\s\S]*?left:\s*GESTURE_CENTER - LEVER_CUE_ORBIT_SIZE \/ 2,[\s\S]*?top:\s*GESTURE_CENTER - LEVER_CUE_ORBIT_SIZE \/ 2,[\s\S]*?width:\s*LEVER_CUE_ORBIT_SIZE,[\s\S]*?height:\s*LEVER_CUE_ORBIT_SIZE/,
  );
  assert.match(component, /leverRotationArrow:\s*\{[\s\S]*?left:\s*\(LEVER_CUE_ORBIT_SIZE - LEVER_CUE_ARROW_WIDTH\) \/ 2,[\s\S]*?top:\s*-LEVER_CUE_ARROW_HEIGHT \/ 2/);
  const arrowStyle = component.match(/leverRotationArrow:\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(arrowStyle, /transform|border|backgroundColor/,
    "the arrow must keep the same tangent heading as its rotating parent");
  const orbitStyle = component.match(/leverRotationCue:\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(orbitStyle, /border|backgroundColor|shadow|opacity|overflow|transformOrigin/,
    "the orbit box must be invisible and use its centered pivot, not draw a ring");
  assert.match(
    component,
    /crankPlate:\s*\{[\s\S]*?left:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?top:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?width:\s*CRANK_PLATE_SIZE,[\s\S]*?height:\s*CRANK_PLATE_SIZE/,
  );
  assert.match(component, /leverRotationCue:\s*\{[\s\S]*?zIndex:\s*\d+/);
  assert.match(component, /opacity: clockwiseCueOpacity.value \* 0.9/);
  assert.match(component, /cancelAnimation\(clockwiseCueRotation\);\s*clockwiseCueRotation.value = 0;\s*if \(reduceMotion/);
  assert.match(component, /return \(\) => cancelAnimation\(clockwiseCueRotation\)/);
  assert.match(component, /clockwiseCueRotation.value = 0;\s*clockwiseCueOpacity.value = 1;/,
    "a new draw must restore the cue to its original visible twelve-o'clock pose");
  assert.doesNotMatch(component, /<Text\b|styles\.instruction|styles\.status/);
  assert.doesNotMatch(
    component,
    /PROGRESS_DOTS|PROGRESS_SEGMENTS|leverOrbit|progressDot|resolveGachaLeverProgress/,
  );
});

test("the complete arrow stays clear of the plate and points along its clockwise orbit tangent", () => {
  const number = (name) => Number(component.match(new RegExp(`const ${name} = ([\\d.]+);`))?.[1]);
  const plateSize = number("CRANK_PLATE_SIZE");
  const arrowWidth = number("LEVER_CUE_ARROW_WIDTH");
  const arrowHeight = number("LEVER_CUE_ARROW_HEIGHT");
  const extraDiameter = Number(component.match(/const LEVER_CUE_ORBIT_SIZE = CRANK_PLATE_SIZE \+ ([\d.]+);/)?.[1]);
  const radius = (plateSize + extraDiameter) / 2;
  assert.ok([plateSize, arrowWidth, arrowHeight, radius].every(Number.isFinite));
  const cueStart = component.indexOf('testID="gacha-lever-clockwise-cue"');
  const cue = component.slice(cueStart, component.indexOf("</Animated.View>", cueStart));
  const path = cue.match(/<Path d="([^"]+)"/)?.[1];
  assert.ok(path, "the single rendered arrow must have inspectable geometry");
  assert.doesNotMatch(path, /[ACQSTacqst]/, "the arrow is a straight silhouette, not a circular refresh arc");
  const tokens = path.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g);
  const points = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    if (command === "Z") break;
    if (command === "M" || command === "L") { x = Number(tokens[index++]); y = Number(tokens[index++]); }
    else if (command === "H") x = Number(tokens[index++]);
    else if (command === "V") y = Number(tokens[index++]);
    else assert.fail(`unsupported arrow command ${command}`);
    points.push([x, y]);
  }
  assert.ok(points.every(([px, py]) => px >= 0 && px <= arrowWidth && py >= 0 && py <= arrowHeight));
  assert.deepEqual(points.filter(([px]) => px === arrowWidth), [[arrowWidth, arrowHeight / 2]],
    "at twelve o'clock the single tip must point right, not inward or counterclockwise");
  for (const [px, py] of points) {
    assert.ok(points.some(([otherX, otherY]) => otherX === px && otherY === arrowHeight - py),
      "the arrow must remain balanced above and below its tangent axis");
  }
  const rotate = ([px, py], angle) => [px * Math.cos(angle) - py * Math.sin(angle), px * Math.sin(angle) + py * Math.cos(angle)];
  const edgeDistance = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy)));
    return Math.hypot(a[0] + t * dx, a[1] + t * dy);
  };
  for (let degree = 0; degree < 360; degree += 2) {
    const angle = degree * Math.PI / 180;
    const outline = points.map(([px, py]) => rotate([px - arrowWidth / 2, py - arrowHeight / 2 - radius], angle));
    for (let index = 0; index < outline.length; index += 1) {
      assert.ok(edgeDistance(outline[index], outline[(index + 1) % outline.length]) >= plateSize / 2 + 3 - 1e-9,
        "every filled arrow edge keeps a three-point clearance outside the fixed metal plate");
    }
    const center = rotate([0, -radius], angle);
    const heading = rotate([1, 0], angle);
    assert.ok(Math.abs(Math.hypot(...center) - radius) < 1e-10, "the arrow orbits; it does not just spin at the plate center");
    assert.ok(Math.abs(center[0] * heading[0] + center[1] * heading[1]) < 1e-10);
    assert.ok(center[0] * heading[1] - center[1] * heading[0] > 0,
      "in screen coordinates the tip follows the positive clockwise tangent");
  }
  const touchingOutline = points.map(([px, py]) => [px - arrowWidth / 2, py - arrowHeight / 2 - plateSize / 2]);
  const touchingDistance = Math.min(...touchingOutline.map((point, index) => edgeDistance(point, touchingOutline[(index + 1) % touchingOutline.length])));
  assert.ok(touchingDistance < plateSize / 2,
    "negative control: the actual arrow intersects the plate when its orbit radius is only the plate radius");
});

test("the machine marquee reuses the canonical DABBOBA wordmark", () => {
  assert.match(
    component,
    /const DABBOBA_WORDMARK = require\("\.\.\/\.\.\/\.\.\/assets\/dabboba-wordmark\.png"\)/,
  );
  assert.match(
    component,
    /<View pointerEvents="none" style=\{styles\.machineMarquee\}>[\s\S]*?<Image[\s\S]*?source=\{DABBOBA_WORDMARK\}[\s\S]*?styles\.machineMarqueeWordmark/,
  );
});
