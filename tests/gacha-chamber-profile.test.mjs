import assert from "node:assert/strict";
import test from "node:test";
import {
  GACHA_AGITATION_DURATION_MS,
  GACHA_CHAMBER_CAPSULES as capsules,
  GACHA_CHAMBER_HEIGHT as height,
  GACHA_CHAMBER_WIDTH as width,
  sampleGachaCapsuleDispenseMotion,
  sampleGachaCapsuleMotion,
} from "../apps/mobile/src/features/draw/gacha-capsule-motion.ts";
import { GACHA_CAPSULE_DISPENSE_DURATION_MS } from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";
import { getGachaCapsuleSilhouette } from "../apps/mobile/src/features/draw/gacha-capsule-silhouette.ts";

const size = 17;
const epsilon = 1e-8;

// Exact support of the native asymmetric rounded rectangle, not the retired
// ellipse and not the transparent corners of its enclosing square. Arc ends
// also bound the two short sides and the flat bottom between the arcs.
const corners = getGachaCapsuleSilhouette(size);
const topRadius = corners.borderTopLeftRadius;
const bottomRadius = corners.borderBottomLeftRadius;
const half = size / 2;
const arcs = [
  { x: -half + topRadius, y: -half + topRadius, radius: topRadius, start: Math.PI, end: Math.PI * 1.5 },
  { x: half - topRadius, y: -half + topRadius, radius: topRadius, start: Math.PI * 1.5, end: Math.PI * 2 },
  { x: half - bottomRadius, y: half - bottomRadius, radius: bottomRadius, start: 0, end: Math.PI / 2 },
  { x: -half + bottomRadius, y: half - bottomRadius, radius: bottomRadius, start: Math.PI / 2, end: Math.PI },
];
function silhouetteSupport(x, y) {
  const direction = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  return Math.max(...arcs.map((arc) => {
    const angles = [arc.start, arc.end];
    if (direction >= arc.start && direction <= arc.end) angles.push(direction);
    return arc.x * x + arc.y * y + arc.radius * Math.max(...angles.map((angle) => x * Math.cos(angle) + y * Math.sin(angle)));
  }));
}

const localOutline = arcs.flatMap((arc) => Array.from({ length: 25 }, (_, index) => {
  const angle = arc.start + (arc.end - arc.start) * index / 24;
  return { x: arc.x + arc.radius * Math.cos(angle), y: arc.y + arc.radius * Math.sin(angle) };
}));
function outline(frame) {
  return localOutline.map((point) => ({
    x: frame.x + point.x * frame.scaleX * Math.cos(frame.angle) - point.y * frame.scaleY * Math.sin(frame.angle),
    y: frame.y + point.x * frame.scaleX * Math.sin(frame.angle) + point.y * frame.scaleY * Math.cos(frame.angle),
  }));
}
function cutOutline(frame, axis, value) {
  const points = outline(frame);
  const opposite = axis === "x" ? "y" : "x";
  return points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length];
    if (Math.abs(next[axis] - point[axis]) < epsilon) return [];
    const t = (value - point[axis]) / (next[axis] - point[axis]);
    return t >= 0 && t <= 1 ? [point[opposite] + (next[opposite] - point[opposite]) * t] : [];
  });
}

const motionStates = [
  ...Array.from({ length: 49 }, (_, step) => ({ agitation: step / 48, dispense: 0 })),
  // A result may arrive while the last 480 ms cam response is still running.
  // That finite response must finish before the later neighbor-settling beat;
  // a Cartesian product would incorrectly test an impossible second impulse.
  ...Array.from({ length: 13 }, (_, ageStep) => ageStep * GACHA_AGITATION_DURATION_MS / 12)
    .flatMap((initialAge) => Array.from({ length: 86 }, (_, step) => {
      const elapsed = step * GACHA_CAPSULE_DISPENSE_DURATION_MS / 85;
      return {
        agitation: Math.min((initialAge + elapsed) / GACHA_AGITATION_DURATION_MS, 1),
        dispense: elapsed / GACHA_CAPSULE_DISPENSE_DURATION_MS,
      };
    })),
];

function pose(capsule, agitation = 0, dispense = 0, reduced = false) {
  const roll = sampleGachaCapsuleMotion(
    agitation, capsule.index, capsule.size, capsule.rollDistance,
    capsule.liftHeight, capsule.impulseDelayMs, capsule.responseDurationMs,
    capsule.restRotation, reduced,
  );
  const exit = sampleGachaCapsuleDispenseMotion(
    dispense, capsule.isDispenseCapsule, capsule.dispenseX, capsule.dispenseY,
    capsule.settleX, capsule.settleY, reduced,
  );
  const radius = capsule.size * capsule.visualScale / 2;
  const angle = (roll.rotateDeg + exit.rotateDeltaDeg) * Math.PI / 180;
  const scaleX = capsule.visualScale * roll.scaleX;
  const scaleY = capsule.visualScale * roll.scaleY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: capsule.left + capsule.size / 2 + roll.translateX + exit.translateX,
    y: capsule.top + capsule.size / 2 + roll.translateY + exit.translateY,
    radius,
    angle, scaleX, scaleY,
    leftExtent: silhouetteSupport(-cos * scaleX, sin * scaleY),
    rightExtent: silhouetteSupport(cos * scaleX, -sin * scaleY),
    topExtent: silhouetteSupport(-sin * scaleX, -cos * scaleY),
    bottomExtent: silhouetteSupport(sin * scaleX, cos * scaleY),
    opacity: exit.opacity,
  };
}

function topAt(x, pile) {
  return Math.min(...pile.flatMap((ball) => cutOutline(ball, "x", x)));
}

function horizontalSection(y, pile) {
  const points = pile.flatMap((ball) => cutOutline(ball, "y", y));
  return {
    left: Math.min(...points),
    right: Math.max(...points),
  };
}

function assertRectangularProfile(pile) {
  const columns = Array.from({ length: 9 }, (_, index) => width * (0.12 + index * 0.095));
  const tops = columns.map((x) => topAt(x, pile));
  assert.ok(tops.every(Number.isFinite), "the pile must reach every sampled side-to-side column");
  assert.ok(
    Math.max(...tops) - Math.min(...tops) <= size * 1.15,
    `the pile needs one sloping upper edge; sampled top heights: ${tops.join(", ")}`,
  );
  const slope = tops.at(-1) - tops[0];
  assert.ok(slope >= 10 && slope <= 19, "the upper edge must visibly descend from left to right");
  for (let index = 1; index < tops.length - 1; index += 1) {
    const fraction = (columns[index] - columns[0]) / (columns.at(-1) - columns[0]);
    const edgeLine = tops[0] + slope * fraction;
    assert.ok(
      Math.abs(tops[index] - edgeLine) <= size * 0.3,
      `column ${index} creates a central apex or valley instead of the sloping upper edge`,
    );
  }

  const floor = Math.max(...pile.map((ball) => ball.y + ball.bottomExtent));
  const filledRatio = (floor - tops.reduce((sum, y) => sum + y, 0) / tops.length) / height;
  assert.ok(filledRatio >= 0.62 && filledRatio <= 0.70, `fill should reach about two thirds, got ${filledRatio}`);
  const shoulder = Math.max(...tops) + size * 0.8;
  for (const y of [shoulder, (shoulder + floor - size / 2) / 2, floor - size / 2]) {
    const section = horizontalSection(y, pile);
    assert.ok(section.left <= size * 0.85, `left side is empty at chamber height ${y}`);
    assert.ok(section.right >= width - size * 0.85, `right side is empty at chamber height ${y}`);
    assert.ok(section.right - section.left >= width * 0.72, `the pile narrows into a pyramid at height ${y}`);
  }
}

test("the dense chamber fills about two thirds with a stronger left-high sloping top", () => {
  assertRectangularProfile(capsules.map((capsule) => pose(capsule)));
});

test("poured resting poses break repeated seam angles and uniformly stepped rows", () => {
  const rotations = capsules.map((capsule) => capsule.restRotation);
  assert.ok(rotations.every((angle) => angle >= -40 && angle <= 40));
  assert.ok(Math.max(...rotations) - Math.min(...rotations) >= 65);
  assert.ok(rotations.filter((angle) => Math.abs(angle) >= 15).length >= 18);
  assert.ok(new Set(rotations).size >= 20);
  const surface = capsules.slice(0, 6).sort((a, b) => a.left - b.left);
  const heightSteps = surface.slice(1).map((capsule, index) => capsule.top - surface[index].top);
  assert.ok(heightSteps.filter((step) => step < -1).length >= 2, "the sloped surface has irregular pockets, not a staircase");
  assert.ok(Math.max(...heightSteps) - Math.min(...heightSteps) >= 7);
  assert.ok(new Set(capsules.map((capsule) => capsule.top)).size >= 24);
  // A fixed poured arrangement must remain reproducible across rerenders;
  // no random placement or particle system is needed to make it irregular.
  const oldRegularSteps = [24, 27.2, 30.4, 33.6, 36.8, 40].slice(1).map((top, index) => top - [24, 27.2, 30.4, 33.6, 36.8][index]);
  assert.equal(oldRegularSteps.filter((step) => step < -1).length, 0);
});

test("the containment oracle includes the rotated cup shoulder instead of assuming a circle", () => {
  const cup = pose({ ...capsules[0], restRotation: 45, visualScale: 1 });
  assert.ok(cup.bottomExtent > cup.radius * 1.1);
  assert.ok(cup.leftExtent > cup.radius * 1.1);
  assert.ok(cup.rightExtent < size * Math.SQRT2 / 2, "transparent square corners are not physical shell");
  const atCircularFloor = pose({ ...capsules[0], top: height - size, restRotation: 45, visualScale: 1 });
  assert.ok(atCircularFloor.y + atCircularFloor.radius <= height);
  assert.ok(atCircularFloor.y + atCircularFloor.bottomExtent > height, "the old circle test would miss this real floor leak");
});

test("the profile regression rejects the original centered pyramid", () => {
  // Frozen pre-revision coordinates, independent of the new production layout.
  const originalCoordinates = [
    [34.2, 23], [48.9, 24.5], [26.2, 36], [41, 37.5], [55.7, 35], [48.1, 50.5],
    [18.7, 49.5], [33.2, 48], [62.7, 48.5], [11.2, 62], [25.9, 63.5],
    [40.5, 61], [55.3, 63.5], [69.7, 61.5], [18.5, 73.5],
    [4.5, 75.5], [33, 76.5], [47.5, 74], [62, 76.5], [77, 74.5],
  ];
  const originalPile = capsules.slice(0, originalCoordinates.length).map((capsule, index) => pose({
    ...capsule,
    left: originalCoordinates[index][0],
    top: originalCoordinates[index][1],
  }));
  assert.throws(() => assertRectangularProfile(originalPile), /the pile needs one sloping upper edge/);
});

test("the profile regression rejects the previous low, almost level twenty-capsule fill", () => {
  const previousCoordinates = [
    [5, 39], [19.5, 40.2], [34, 41.4], [48.6, 42.7], [62.8, 43.9], [77, 45.1],
    [4.8, 53.7], [19.8, 54.5], [63, 56.7], [8.5, 64], [36, 54.9],
    [40.5, 65.2], [54.8, 66.1], [77, 62], [18.5, 73.5],
    [4.5, 75.5], [33, 76.5], [47.5, 74], [62, 76.5], [77, 74.5],
  ];
  const previousPile = previousCoordinates.map(([left, top], index) => pose({
    ...capsules[index], left, top,
  }));
  assert.throws(() => assertRectangularProfile(previousPile), /visibly descend from left to right/);
});

test("the denser profile has twenty-six distinct capsules with the same size and motion tiers", () => {
  assert.equal(capsules.length, 26);
  assert.equal(new Set(capsules.map((capsule) => capsule.id)).size, 26);
  assert.equal(new Set(capsules.map((capsule) => `${capsule.left}:${capsule.top}`)).size, 26);
  assert.ok(capsules.every((capsule) => capsule.size === size));
  assert.deepEqual(
    ["upper", "middle", "lower"].map((row) => capsules.filter((capsule) => capsule.mechanicalRow === row).length),
    [12, 9, 5],
  );
  assert.deepEqual(new Set(capsules.map((capsule) => capsule.depth)), new Set([0, 1, 2]));
  assert.deepEqual(new Set(capsules.map((capsule) => capsule.tone)), new Set(["lime", "ivory"]));
});

test("rolling and neighbor settlement keep every retained capsule inside the chamber", () => {
  for (const { agitation, dispense } of motionStates) {
    for (const capsule of capsules) {
      const frame = pose(capsule, agitation, dispense);
      const detail = `${capsule.id} at roll=${agitation}, dispense=${dispense}`;
      assert.ok(Object.values(frame).every(Number.isFinite), detail);
      assert.ok(frame.x - frame.leftExtent >= -epsilon, `${detail} leaks through the left wall`);
      assert.ok(frame.x + frame.rightExtent <= width + epsilon, `${detail} leaks through the right wall`);
      assert.ok(frame.y - frame.topExtent >= -epsilon, `${detail} leaks through the chamber roof`);
      // Exactly the selected capsule may leave through the clipped internal
      // bottom chute; no retained neighbor may leak through that floor.
      if (!capsule.isDispenseCapsule || dispense === 0) {
        assert.ok(frame.y + frame.bottomExtent <= height + epsilon, `${detail} leaks through the floor`);
      }
    }
  }
});

test("overlapping depth silhouettes never collapse into duplicate centers during motion", () => {
  for (const { agitation, dispense } of motionStates) {
    const frames = capsules
      // The selected shell deliberately passes into its internal chute and
      // behind the neighboring pile; it is not a retained pile center then.
      .filter((capsule) => dispense === 0 || !capsule.isDispenseCapsule)
      .map((capsule) => ({ id: capsule.id, ...pose(capsule, agitation, dispense) }));
    for (let first = 0; first < frames.length; first += 1) {
      for (let second = first + 1; second < frames.length; second += 1) {
        const a = frames[first];
        const b = frames[second];
        assert.ok(
          Math.hypot(a.x - b.x, a.y - b.y) >= size * 0.25,
          `${a.id} and ${b.id} merge into nearly one center at roll=${agitation}, dispense=${dispense}`,
        );
      }
    }
  }
});

test("only the lower-right capsule exits and its two immediate supporters settle into the gap", () => {
  const candidates = capsules.filter((capsule) => capsule.isDispenseCapsule);
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  const vacant = pose(candidate);
  assert.equal(candidate.mechanicalRow, "lower");
  assert.ok(vacant.x >= width * 0.75 && vacant.y >= height * 0.75);
  assert.equal(pose(candidate, 0, 1).opacity, 0);

  const neighbors = capsules.filter((capsule) => !capsule.isDispenseCapsule && (capsule.settleX || capsule.settleY));
  assert.equal(neighbors.length, 2, "only the two supporting neighbors should shift into the vacated space");
  for (const capsule of neighbors) {
    const before = pose(capsule);
    const after = pose(capsule, 0, 1);
    const distance = (point) => Math.hypot(point.x - vacant.x, point.y - vacant.y);
    assert.ok(distance(before) < size * 1.3, `${capsule.id} is not an immediate neighbor`);
    assert.ok(distance(after) < distance(before), `${capsule.id} moves away from the vacated pocket`);
    assert.equal(after.opacity, 1);
  }

  for (const capsule of capsules) {
    const still = pose(capsule);
    for (const progress of [0.2, 0.5, 0.8, 1]) {
      assert.deepEqual(pose(capsule, progress, progress, true), still, `${capsule.id} must remain still under Reduced Motion`);
    }
  }
});
