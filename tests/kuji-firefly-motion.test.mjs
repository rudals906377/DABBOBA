import assert from "node:assert/strict";
import test from "node:test";

import * as motion from "../apps/mobile/src/features/draw/kuji-firefly-motion.ts";

const { GACHA_FIREFLY_COUNT, createGachaFireflyConfigs, sampleKujiFireflyMotion } = motion;

test("the retired twelve-lane kuji generator is gone; both draws share the dispersed field", () => {
  assert.equal(motion.createKujiFireflyConfigs, undefined);
  assert.equal(motion.KUJI_FIREFLY_COUNT, undefined);
  assert.equal(motion.KUJI_FIREFLY_MIN_STAGE_WIDTH, undefined);
  const stage = { width: 393, height: 680 };
  const first = createGachaFireflyConfigs("product-1:01", stage);
  assert.equal(first.length, GACHA_FIREFLY_COUNT);
  assert.deepEqual(first, createGachaFireflyConfigs("product-1:01", stage));
  assert.notDeepEqual(first, createGachaFireflyConfigs("product-2:01", stage));
});

test("every shared-field ember rises continuously on a curved path and fades at both loop boundaries", () => {
  for (const particle of createGachaFireflyConfigs("product-1:01", { width: 393, height: 680 })) {
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
  }
});
