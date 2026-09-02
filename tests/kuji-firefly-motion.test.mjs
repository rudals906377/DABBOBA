import assert from "node:assert/strict";
import test from "node:test";

import {
  KUJI_FIREFLY_COUNT,
  KUJI_FIREFLY_MIN_STAGE_WIDTH,
  createKujiFireflyConfigs,
  sampleKujiFireflyMotion,
} from "../apps/mobile/src/features/draw/kuji-firefly-motion.ts";

test("kuji embers use twelve separated seeded lanes for a bottom-to-top flow", () => {
  const first = createKujiFireflyConfigs("product-1:ticket-13");
  const repeated = createKujiFireflyConfigs("product-1:ticket-13");
  const different = createKujiFireflyConfigs("product-1:ticket-14");

  assert.equal(KUJI_FIREFLY_COUNT, 12);
  assert.equal(first.length, KUJI_FIREFLY_COUNT);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, different);
  assert.equal(new Set(first.map((particle) => particle.id)).size, KUJI_FIREFLY_COUNT);
  assert.equal(new Set(first.map((particle) => particle.laneIndex)).size, KUJI_FIREFLY_COUNT);
  assert.ok(new Set(first.map((particle) => particle.durationMs)).size >= 10);

  for (const particle of first) {
    assert.ok(Number.isInteger(particle.laneIndex) && particle.laneIndex >= 0 && particle.laneIndex < 12);
    assert.ok(particle.leftPercent >= 6 && particle.leftPercent <= 94);
    assert.ok(particle.startTopPercent >= 93 && particle.startTopPercent <= 98);
    assert.ok(Number.isInteger(particle.size) && particle.size >= 3 && particle.size <= 5);
    assert.ok(particle.curveAmplitude >= 4 && particle.curveAmplitude <= 7);
    assert.ok(particle.curveDirection === -1 || particle.curveDirection === 1);
    assert.ok(particle.curvePhase >= 0 && particle.curvePhase < Math.PI * 2);
    assert.ok(particle.riseDistance >= 438 && particle.riseDistance <= 468);
    assert.ok(particle.startOffset >= 0 && particle.startOffset < 1);
    assert.ok(particle.durationMs >= 6_400 && particle.durationMs <= 9_200);
    assert.ok(particle.twinkleCycles === 2 || particle.twinkleCycles === 3);
  }

  const stageWidth = KUJI_FIREFLY_MIN_STAGE_WIDTH;
  const horizontalEnvelopes = [...first]
    .sort((left, right) => left.leftPercent - right.leftPercent)
    .map((particle) => {
      const center = (particle.leftPercent / 100) * stageWidth;
      return {
        min: center - particle.curveAmplitude,
        max: center + particle.curveAmplitude + particle.size,
      };
    });

  for (let index = 1; index < horizontalEnvelopes.length; index += 1) {
    assert.ok(
      horizontalEnvelopes[index - 1].max < horizontalEnvelopes[index].min,
      "ember lanes keep their complete curved paths from overlapping",
    );
  }

  const offsets = first.map((particle) => particle.startOffset).sort((left, right) => left - right);
  for (let index = 0; index < offsets.length; index += 1) {
    const next = index === offsets.length - 1 ? offsets[0] + 1 : offsets[index + 1];
    assert.ok(next - offsets[index] >= 0.055, "ember starts stay visibly staggered");
  }

  for (const particle of first) {
    const frames = Array.from({ length: 21 }, (_, index) => (
      sampleKujiFireflyMotion(particle, index / 20)
    ));
    assert.equal(frames[0].opacity, 0);
    assert.equal(frames.at(-1).opacity, 0);
    for (let index = 1; index < frames.length; index += 1) {
      assert.ok(
        frames[index].translateY < frames[index - 1].translateY,
        "every ember keeps rising instead of bobbing back down",
      );
      assert.ok(
        Math.abs(frames[index].translateX - frames[index - 1].translateX) < 4,
        "the lateral curve stays continuous between sampled frames",
      );
    }
    assert.ok(
      new Set(frames.map((frame) => Math.round(frame.translateX * 10))).size >= 6,
      "each ember follows a visible curved path instead of a vertical line",
    );
  }
});

test("kuji ember lanes stay disjoint across seeded ticket variations", () => {
  for (let seed = 0; seed < 128; seed += 1) {
    const configs = createKujiFireflyConfigs(`product-1:ticket-${seed}`)
      .sort((left, right) => left.leftPercent - right.leftPercent);

    for (let index = 1; index < configs.length; index += 1) {
      const previous = configs[index - 1];
      const current = configs[index];
      const previousRight = (previous.leftPercent / 100) * KUJI_FIREFLY_MIN_STAGE_WIDTH
        + previous.curveAmplitude
        + previous.size;
      const currentLeft = (current.leftPercent / 100) * KUJI_FIREFLY_MIN_STAGE_WIDTH
        - current.curveAmplitude;
      assert.ok(previousRight < currentLeft, `seed ${seed} keeps lanes ${index - 1}/${index} apart`);
    }
  }
});
