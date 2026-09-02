import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GACHA_AGITATION_DURATION_MS,
  GACHA_AGITATION_PULSE_TURNS,
  GACHA_CHAMBER_CAPSULES,
  GACHA_CHAMBER_HEIGHT,
  GACHA_CHAMBER_WIDTH,
  resolveGachaAgitationPulseCount,
  sampleGachaAgitatorMotion,
  sampleGachaCapsuleDispenseMotion,
  sampleGachaCapsuleMotion,
} from "../apps/mobile/src/features/draw/gacha-capsule-motion.ts";
import { GACHA_LEVER_TARGET_RADIANS } from "../apps/mobile/src/features/draw/gacha-lever-motion.ts";

const component = readFileSync(
  new URL("../apps/mobile/src/features/draw/GachaLeverMachine.tsx", import.meta.url),
  "utf8",
);
const motionSource = readFileSync(
  new URL("../apps/mobile/src/features/draw/gacha-capsule-motion.ts", import.meta.url),
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

test("the chamber contains twenty bounded capsules in a staggered three-depth pile", () => {
  assert.equal(GACHA_CHAMBER_CAPSULES.length, 20);
  assert.equal(new Set(GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.id)).size, 20);
  assert.deepEqual(
    GACHA_CHAMBER_CAPSULES.map((capsule) => capsule.index),
    Array.from({ length: 20 }, (_, index) => index),
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
  assert.deepEqual(rowCounts, { upper: 6, middle: 9, lower: 5 });

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
    Array.from({ length: 20 }, (_, index) => index + 1),
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
  assert.ok(overlapPairs.length >= 24, "the pile needs visible contact and overlap instead of grid gaps");
  assert.ok(crossDepthOverlapPairs.length >= 18, "front capsules must visibly occlude back capsules");

  const overlapNeighbors = new Map(
    GACHA_CHAMBER_CAPSULES.map((capsule) => [capsule.id, new Set()]),
  );
  for (const [firstId, secondId] of overlapPairs) {
    overlapNeighbors.get(firstId).add(secondId);
    overlapNeighbors.get(secondId).add(firstId);
  }
  assert.ok(
    [...overlapNeighbors.values()].filter((neighbors) => neighbors.size > 0).length >= 18,
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
  assert.ok(visited.size >= 18, "the pile must read as one connected mass");

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
  assert.deepEqual(GACHA_AGITATION_PULSE_TURNS, [0.18, 1.18]);
  assert.equal(resolveGachaAgitationPulseCount(0.17 * tau), 0);
  assert.equal(resolveGachaAgitationPulseCount(0.18 * tau), 1);
  assert.equal(resolveGachaAgitationPulseCount(1.17 * tau), 1);
  assert.equal(resolveGachaAgitationPulseCount(1.18 * tau), 2);
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
  const chuteTrackStyleMatch = component.match(/dispenseTrack:\s*\{[\s\S]*?left:\s*(\d+),/);
  const chuteCapsuleStyleMatch = component.match(
    /dispensedCapsule:\s*\{[\s\S]*?left:\s*(\d+),[\s\S]*?width:\s*(\d+),/,
  );
  assert.ok(chamberStyleMatch);
  assert.ok(chuteTrackStyleMatch);
  assert.ok(chuteCapsuleStyleMatch);
  const chamberLeft = Number(chamberStyleMatch[1]);
  const chuteTrackLeft = Number(chuteTrackStyleMatch[1]);
  const chuteCapsuleLeft = Number(chuteCapsuleStyleMatch[1]);
  const chuteCapsuleWidth = Number(chuteCapsuleStyleMatch[2]);
  const exitingCenter = chamberLeft
    + candidate.left
    + candidate.dispenseX
    + candidate.size / 2;
  const chuteCenter = chuteTrackLeft + chuteCapsuleLeft + chuteCapsuleWidth / 2;
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
  assert.match(component, /styles\.chamberCapsuleHighlightPixel/);
  assert.match(component, /styles\.chamberCapsuleSideShade/);
  assert.match(component, /styles\.chamberCapsuleBottomShade/);
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

test("the circular lever rotates one foreground clockwise cue until the lever is touched", () => {
  const readPresentationConstant = (name) => {
    const match = component.match(new RegExp(`const ${name} = ([\\d.]+);`));
    assert.ok(match, `${name} must remain an explicit presentation constant`);
    return Number(match[1]);
  };
  const crankPlateSize = readPresentationConstant("CRANK_PLATE_SIZE");
  const cueIconSize = readPresentationConstant("LEVER_CUE_ICON_SIZE");
  const cueRotationDurationMs = readPresentationConstant("LEVER_CUE_ROTATION_DURATION_MS");

  assert.equal(crankPlateSize, 41);
  assert.equal(cueIconSize, 34);
  assert.equal(cueRotationDurationMs, 2600);
  assert.ok(cueIconSize < crankPlateSize, "the cue must remain optically inside the crank plate");
  assert.match(component, /<GestureDetector gesture=\{interactionGesture\}>[\s\S]*?styles\.leverTouchTarget/);
  assert.equal((component.match(/testID="gacha-lever-clockwise-cue"/g) ?? []).length, 1);
  assert.match(
    component,
    /<Animated\.View[\s\S]*?testID="gacha-lever-clockwise-cue"[\s\S]*?pointerEvents="none"[\s\S]*?styles\.leverRotationCue[\s\S]*?clockwiseCueStyle[\s\S]*?<Ionicons[\s\S]*?name="refresh-outline"/,
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
  assert.match(component, /<Ionicons\s+name="refresh-outline"\s+size=\{LEVER_CUE_ICON_SIZE\}/);
  assert.match(
    component,
    /leverRotationCue:\s*\{[\s\S]*?left:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?top:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?width:\s*CRANK_PLATE_SIZE,[\s\S]*?height:\s*CRANK_PLATE_SIZE/,
  );
  assert.match(
    component,
    /crankPlate:\s*\{[\s\S]*?left:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?top:\s*GESTURE_CENTER - CRANK_PLATE_SIZE \/ 2,[\s\S]*?width:\s*CRANK_PLATE_SIZE,[\s\S]*?height:\s*CRANK_PLATE_SIZE/,
  );
  assert.match(component, /leverRotationCue:\s*\{[\s\S]*?zIndex:\s*\d+/);
  assert.doesNotMatch(component, /<Text\b|styles\.instruction|styles\.status/);
  assert.doesNotMatch(
    component,
    /PROGRESS_DOTS|PROGRESS_SEGMENTS|leverOrbit|progressDot|resolveGachaLeverProgress/,
  );
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
