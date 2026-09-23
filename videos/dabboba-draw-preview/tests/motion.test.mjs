import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  GACHA_DURATION, GACHA_CONTACT_TIMES, GACHA_SEAL_TIME, KUJI_COMPLETE_DURATION, clamp, smooth, range,
  sampleGacha, dragProgress, shouldOpen, kujiCompletionDuration, sampleKujiCompletion, sampleKujiDemo,
} from "../motion.mjs";

const closeTo = (actual, expected, message, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

function assertUnit(value, name) {
  assert.ok(Number.isFinite(value), `${name} must be finite`);
  assert.ok(value >= 0 && value <= 1, `${name} must stay in [0, 1]`);
}

// Independent contract formulas: do not import implementation-specific easing.
const cubicSmooth = value => { const u = clamp(value); return u * u * (3 - 2 * u); };
const revealAlpha = (progress, x, y) => {
  const distance = Math.hypot((x - .5) * .78, y - .47);
  const radius = progress * 1.25;
  const edge0 = Math.max(0, radius - .28), edge1 = Math.max(.001, radius);
  return (1 - cubicSmooth((distance - edge0) / (edge1 - edge0))) * cubicSmooth(progress / .3);
};
const minimumRevealAlpha = progress => Math.min(...[[0, 0], [0, 1], [1, 0], [1, 1]]
  .map(([x, y]) => revealAlpha(progress, x, y)));

test("gacha preserves every approved 0–1.20 s sample, including reduced motion", () => {
  // Frozen from the approved 4.0 s sampler before the slower focus was edited.
  // Canonical key order excludes formatting/property-order differences.
  const prefix = [false, true].flatMap(reduced => Array.from({ length: 1201 }, (_, index) =>
    Object.fromEntries(Object.entries(sampleGacha(index / 1000, reduced)).sort(([a], [b]) => a.localeCompare(b)))));
  assert.equal(createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
    'c57f6d32dcbd10fb040939634865c385741eca65278eddfa7c23eed3cb2e2b28',
    'Fall, both bounces, rattle, hold and early visibility must be identical to the approved prefix');
});

test("gacha preserves the approved 4.2 s timeline while opening in one continuous lift", () => {
  assert.equal(GACHA_DURATION, 4.2);
  assert.deepEqual(GACHA_CONTACT_TIMES, [.50, .89, 1.10]);
  assert.equal(GACHA_SEAL_TIME, 1.8);
  const expected = [
    [0, 2.8, 0, 0], [0.5, 0, 0, 0], [0.89, 0, 0, 0],
    [1.1, 0, 0, 0], [1.2, 0, 0, 0], [1.76, 0, 0, 0],
    [2.53, 0, .5, 0], [3.3, 0, 1, 0], [3.82, 0, 1, 0], [4.06, 0, 1, 1], [4.2, 0, 1, 1],
  ];
  for (const [time, height, opening, opacity] of expected) {
    const state = sampleGacha(time);
    closeTo(state.time, time, "time");
    closeTo(state.dropHeight, height, "height");
    closeTo(state.opening, opening, "opening");
    closeTo(state.resultOpacity, opacity, "result opacity");
  }
});

test("the capsule holds at rest before focus, then seal and opening travel together", () => {
  for (let frame = 1100; frame <= 1200; frame += 1) {
    const state = sampleGacha(frame / 1000);
    assert.equal(state.dropHeight, 0);
    assert.equal(state.focus, 0);
    assert.equal(state.opening, 0);
  }
  assert.equal(sampleGacha(1.8).focus, 1);
  assert.equal(sampleGacha(1.76).seal, 0);
  assert.equal(sampleGacha(1.76).opening, 0);
  assert.ok(sampleGacha(1.8).seal > 0 && sampleGacha(1.8).seal < .0021);
  assert.ok(sampleGacha(1.92).opening > sampleGacha(1.8).opening);
  for (let frame = 0; frame <= 4200; frame += 1) {
    const state = sampleGacha(frame / 1000);
    assert.equal(state.seal, state.opening, 'seal must not add a separate fast displacement');
    if (frame <= 1760) assert.equal(state.opening, 0);
  }
  for (let frame = 1800; frame <= 4200; frame += 1) assert.equal(sampleGacha(frame / 1000).focus, 1);
  assert.equal(sampleGacha(4.2, true).focus, 0);
});

test("focus keeps its 0.6 s quintic curve with only the approved final 40 ms opening overlap", () => {
  closeTo(1.8 - 1.2, .6, 'focus duration');
  assert.equal(sampleGacha(1.2).focus, 0);
  closeTo(sampleGacha(1.5).focus, .5, 'focus midpoint');
  assert.ok(sampleGacha(1.6).focus < 1, 'focus must still be moving at its former endpoint');
  assert.equal(sampleGacha(1.8).focus, 1);
  for (let step = 0; step <= 600; step += 1) {
    const u = step / 600;
    const state = sampleGacha(1.2 + .6 * u);
    closeTo(state.focus, u ** 3 * (u * (u * 6 - 15) + 10), 'unchanged focus easing shape');
    assert.equal(state.dropHeight, 0);
    assert.equal(state.rattle, 0);
    if (1.2 + .6 * u <= 1.76) {
      closeTo(state.seal, 0, 'capsule stays sealed until the last 40 ms of focus');
      assert.equal(state.opening, 0);
    }
  }
});

test("opening, light and whiteout use the approved cubic curves while result uses cubic ease-out", () => {
  const approved = time => ({
    opening: cubicSmooth(range(time, 1.76, 3.30)),
    seal: cubicSmooth(range(time, 1.76, 3.30)),
    light: cubicSmooth(range(time, 1.80, 3.50)) * .78,
    whiteout: cubicSmooth(range(time, 3.12, 4.00)),
    resultOpacity: 1 - (1 - range(time, 3.82, 4.06)) ** 3,
  });
  for (let millisecond = 1200; millisecond <= 4200; millisecond += 1) {
    const time = millisecond / 1000;
    const state = sampleGacha(time);
    for (const [channel, expected] of Object.entries(approved(time))) {
      closeTo(state[channel], expected, `${channel} at ${time} s`);
    }
  }
});

test("combined shell separation accelerates once and decelerates once without an early pause", () => {
  // Center-to-center separation in capsule-radius units. These are the
  // approved shader displacements, including its unchanged final .035 seal.
  const gap = time => {
    const state = sampleGacha(time);
    return 2 * (.035 * state.seal + .32 * state.opening);
  };
  closeTo(gap(1.76), 0, 'single lift starts closed');
  assert.ok(gap(1.8) > 0, 'the seal sound now follows the first visible motion');
  closeTo(gap(2.53), .355, 'midpoint retains half the final separation');
  closeTo(gap(3.3), .71, 'approved maximum separation remains unchanged');
  closeTo(gap(4.2), .71, 'final separation remains unchanged');
  const dt = .001;
  const values = Array.from({ length: 1541 }, (_, step) => gap(1.76 + step * dt));
  const velocities = values.slice(1).map((value, index) => (value - values[index]) / dt);
  for (const value of values) assert.ok(value >= 0 && value <= .71 + 1e-12, 'no gap overshoot');
  for (const velocity of velocities) assert.ok(velocity > 0, 'the lift cannot pause or reverse internally');
  for (let index = 1; index < 770; index += 1) {
    assert.ok(velocities[index] >= velocities[index - 1] - 1e-8, `unexpected early deceleration at sample ${index}`);
  }
  for (let index = 770; index < velocities.length; index += 1) {
    assert.ok(velocities[index] <= velocities[index - 1] + 1e-8, `unexpected reacceleration at sample ${index}`);
  }
  assert.ok(velocities[0] < .001 && velocities.at(-1) < .001, 'both ends ease to rest');
  assert.ok(velocities[769] > .69, 'the single velocity peak belongs at the opening midpoint');
  assert.ok(velocities[60] > velocities[20], 'the former 1.92 s pause must now continue accelerating');
});

test("opening spans 1.54 s, remains intermediate at 2.36 s and light reaches its unchanged peak at 3.50 s", () => {
  closeTo(3.3 - 1.76, 1.54, 'approved responsive opening duration');
  closeTo(sampleGacha(2.53).opening, .5, 'long opening midpoint');
  const oldEndpoint = sampleGacha(2.36);
  assert.ok(oldEndpoint.opening > 0 && oldEndpoint.opening < .5);
  closeTo(oldEndpoint.opening, cubicSmooth((2.36 - 1.76) / (3.3 - 1.76)), 'new opening interpolation');
  assert.equal(oldEndpoint.phase, '개봉');
  assert.equal(sampleGacha(3.3).opening, 1);
  assert.equal(sampleGacha(3.3).phase, '결과 공개');
  assert.equal(sampleGacha(1.80).light, 0);
  closeTo(sampleGacha((1.80 + 3.50) / 2).light, .39, 'light midpoint');
  closeTo(sampleGacha(3.50).light, .78, 'unchanged maximum light');
});

test("fall is monotonic and exactly two diminishing bounces reach .30 and .08 radii", () => {
  let previousHeight = Infinity;
  for (let i = 0; i <= 100; i += 1) {
    const height = sampleGacha(i / 200).dropHeight;
    assert.ok(height <= previousHeight, "fall must not rise before first contact");
    previousHeight = height;
  }
  for (const [start, end, apex] of [[.5, .89, .30], [.89, 1.10, .08]]) {
    const heights = Array.from({ length: 181 }, (_, index) => sampleGacha(start + index * (end - start) / 180).dropHeight);
    closeTo(heights[0], 0, "bounce starts in contact");
    closeTo(heights[90], apex, "bounce apex");
    closeTo(heights[180], 0, "bounce ends in contact");
    assert.ok(heights.every(value => value >= 0 && value <= apex + 1e-12));
    for (let index = 1; index <= 90; index += 1) assert.ok(heights[index] >= heights[index - 1]);
    for (let index = 91; index < heights.length; index += 1) assert.ok(heights[index] <= heights[index - 1]);
  }
  for (let time = 1.10; time <= 4.2; time += 0.01) {
    assert.equal(sampleGacha(time).dropHeight, 0, "no later bounce or floating lower shell");
  }
});

test("contact rattle is below two degrees, diminishes and ends before the focus move", () => {
  const first = [], second = [];
  for (let frame = 0; frame <= 4200; frame += 1) {
    const time = frame / 1000;
    const angle = sampleGacha(time).rattle;
    assert.ok(Number.isFinite(angle) && Math.abs(angle) < 2 * Math.PI / 180);
    if (time < .5 || time >= 1.2) assert.equal(angle, 0, 'rattle belongs only to contact, never fall/zoom/opening');
    if (time >= .5 && time < .89) first.push(Math.abs(angle));
    if (time >= .89 && time < 1.10) second.push(Math.abs(angle));
  }
  assert.ok(Math.max(...first) > 0, 'first contact must have a visible angular response');
  assert.ok(Math.max(...second) < Math.max(...first), 'second contact must be weaker');
});

test("gacha product stays hidden through 3.82 seconds and reveal channels are monotonic", () => {
  const previous = Object.fromEntries(['focus', 'seal', 'opening', 'light', 'whiteout', 'resultOpacity'].map(name => [name, 0]));
  for (let frame = 0; frame <= 4200; frame += 1) {
    const time = frame / 1000;
    const state = sampleGacha(time);
    if (time <= 3.82) assert.equal(state.resultOpacity, 0);
    if (time <= 1.80) assert.equal(state.light, 0);
    for (const name of Object.keys(previous)) {
      assertUnit(state[name], name);
      assert.ok(state[name] >= previous[name], `${name} must never run backwards`);
      previous[name] = state[name];
    }
  }
});

test("whiteout spans 3.12–4.00 s and spatially covers the frame before the 3.82–4.06 s result", () => {
  assert.equal(sampleGacha(3.12).whiteout, 0);
  closeTo(sampleGacha(3.56).whiteout, .5, 'whiteout midpoint');
  assert.equal(sampleGacha(4.0).whiteout, 1);
  assert.equal(sampleGacha(3.82).resultOpacity, 0);
  assert.ok(sampleGacha(3.88).resultOpacity > .25);
  assert.ok(sampleGacha(3.94).resultOpacity > .5);
  assert.equal(sampleGacha(4.06).resultOpacity, 1);
  assert.equal(sampleGacha(4.2).resultOpacity, 1);
  assert.deepEqual(sampleGacha(3600), sampleGacha(4.2));
  let fullyWhiteAt = null;
  for (let millisecond = 0; millisecond <= 4200; millisecond += 10) {
    const frame = sampleGacha(millisecond / 1000);
    assertUnit(frame.whiteout, 'white reveal');
    const alpha = minimumRevealAlpha(frame.whiteout);
    if (alpha === 1 && fullyWhiteAt === null) fullyWhiteAt = millisecond / 1000;
    if (frame.resultOpacity > 0) assert.equal(alpha, 1, 'the unchanged radial shader must cover even the farthest corner before the product appears');
  }
  assert.ok(fullyWhiteAt >= 3.70 && fullyWhiteAt <= 3.73, `full white at ${fullyWhiteAt}`);
  assert.ok(3.82 - fullyWhiteAt <= .12, 'empty-white pause must remain about .11 s, not the former long blank hold');
  assert.ok(sampleGacha(3.83).whiteout < 1 && sampleGacha(3.83).resultOpacity > 0,
    'spatial white coverage, not a scalar value of one, gates the product');
  for (let ms = 4060; ms <= 4200; ms++) assert.equal(sampleGacha(ms / 1000).resultOpacity, 1, 'result holds through final timeline time');
});

test("samplers clamp negative, oversized and non-finite inputs into finite bounds", () => {
  for (const input of [-Infinity, -100, -0.1, 0, 0.2, 3.1, 3.9, 4.0, 4.2, 100, Infinity, Number.NaN]) {
    assertUnit(clamp(input), "clamp");
    assertUnit(smooth(input), "smooth");
    assertUnit(range(input, 0.5, 0.9), "range");
    for (const reduced of [false, true]) {
      const gacha = sampleGacha(input, reduced);
      assert.ok(Number.isFinite(gacha.time) && gacha.time >= 0 && gacha.time <= GACHA_DURATION);
      assert.ok(Number.isFinite(gacha.dropHeight) && gacha.dropHeight >= 0 && gacha.dropHeight <= 2.8);
      for (const name of ["focus", "seal", "opening", "light", "whiteout", "resultOpacity"]) assertUnit(gacha[name], `gacha.${name}`);
      assert.ok(Number.isFinite(gacha.rattle) && Math.abs(gacha.rattle) < 2 * Math.PI / 180);
      for (const start of [-Infinity, -0.5, 0, 0.58, 1, 8, Infinity, Number.NaN]) {
        const duration = kujiCompletionDuration(start);
        assert.ok(Number.isFinite(duration) && duration >= .36 && duration <= .72);
        const kuji = sampleKujiCompletion(start, input, reduced);
        for (const name of ["progress", "settle", "resultOpacity"]) assertUnit(kuji[name], `kuji.${name}`);
      }
    }
    const demo = sampleKujiDemo(input);
    for (const name of ["progress", "settle", "resultOpacity"]) assertUnit(demo[name], `demo.${name}`);
  }
});

test("kuji drag is immediate, bounded, reversible and safe for zero width", () => {
  closeTo(dragProgress(1, 300), 1 / 300, "first-pixel response");
  assert.equal(dragProgress(-30, 300), 0);
  assert.equal(dragProgress(330, 300), 1);
  assert.equal(dragProgress(150, 300), 0.5);
  assert.equal(dragProgress(60, 300), 0.2, "returning toward the start must unwind the curl");
  for (const width of [0, -1, Number.NaN]) assert.equal(dragProgress(150, width), 0);
  for (const value of [Infinity, -Infinity, Number.NaN]) assertUnit(dragProgress(value, 300), "drag");
});

test("kuji releases only at 58% or at 18% plus a forward 650 px/s flick", () => {
  assert.equal(shouldOpen(0.58, 0), true);
  assert.equal(shouldOpen(0.579999, 0), false);
  assert.equal(shouldOpen(0.18, 650), true);
  assert.equal(shouldOpen(0.179999, 650), false);
  assert.equal(shouldOpen(0.18, 649.999), false);
  assert.equal(shouldOpen(0.3, -1000), false, "reverse velocity must not count as a forward flick");
  assert.equal(shouldOpen(dragProgress(60, 300), -800), false, "reversing an incomplete peel cannot commit");
  assert.equal(shouldOpen(0.58, -800), true, "distance threshold remains sufficient by itself");
});

test("kuji completion uses the remaining peel distance and never exceeds .72 seconds", () => {
  assert.equal(KUJI_COMPLETE_DURATION, .72);
  let previousDuration = Infinity;
  for (const start of [0, .18, .58, .65, .84, 1]) {
    const duration = kujiCompletionDuration(start);
    closeTo(duration, .36 + .36 * (1 - start), 'distance-aware completion duration');
    assert.ok(duration < previousDuration);
    previousDuration = duration;
    const peelEnd = duration - .24;
    const first = sampleKujiCompletion(start, 0);
    closeTo(first.progress, start, "initial progress");
    assert.equal(first.settle, 0);
    assert.equal(first.resultOpacity, 0);
    const halfway = sampleKujiCompletion(start, peelEnd / 2);
    closeTo(halfway.progress, start + (1 - start) * .5, 'zero-velocity release uses a symmetric quintic continuation');
    assert.equal(sampleKujiCompletion(start, peelEnd - .06).settle, 0);
    const peeled = sampleKujiCompletion(start, peelEnd);
    assert.equal(peeled.progress, 1);
    closeTo(peeled.settle, smooth(.3), 'settle overlaps the final .06 seconds of peeling');
    assert.equal(peeled.resultOpacity, 0);
    closeTo(sampleKujiCompletion(start, peelEnd + .10).resultOpacity, .875, 'result uses cubic ease-out');
    assert.equal(sampleKujiCompletion(start, peelEnd + .14).settle, 1);
    assert.equal(sampleKujiCompletion(start, peelEnd + .20).resultOpacity, 1);
    const completed = sampleKujiCompletion(start, duration);
    assert.equal(completed.progress, 1);
    assert.equal(completed.settle, 1);
    assert.equal(completed.resultOpacity, 1);
    assert.deepEqual(sampleKujiCompletion(start, 8), completed);
  }
  closeTo(kujiCompletionDuration(-1), .72, 'negative peel clamps to zero');
  closeTo(kujiCompletionDuration(2), .36, 'oversized peel clamps to fully peeled');
});

test("kuji Hermite continuation matches bounded release velocity and comes to rest at peel-end", () => {
  const h = 1e-6;
  for (const start of [0, .18, .58, .65, .84, .97]) {
    const remaining = 1 - start;
    const peelEnd = kujiCompletionDuration(start) - .24;
    for (const requestedVelocity of [-10, 0, .01, .25, 1, 3, 20, 1e6]) {
      const velocity = Math.min(Math.max(requestedVelocity, 0), 2.5 * remaining / peelEnd);
      const stateAt = time => sampleKujiCompletion(start, time, false, requestedVelocity);
      const initial = (stateAt(h).progress - stateAt(0).progress) / h;
      const final = (stateAt(peelEnd).progress - stateAt(peelEnd - h).progress) / h;
      closeTo(initial, velocity, `initial normalized progress/s at start=${start}, v=${requestedVelocity}`, 1e-4);
      closeTo(final, 0, `ending normalized progress/s at start=${start}, v=${requestedVelocity}`, 1e-4);
      const m = velocity * peelEnd / remaining;
      for (const u of [0, .1, .25, .5, .75, .9, 1]) {
        const curve = m * u + (10 - 6 * m) * u ** 3 + (-15 + 8 * m) * u ** 4 + (6 - 3 * m) * u ** 5;
        closeTo(stateAt(u * peelEnd).progress, start + remaining * curve,
          `quintic Hermite position at start=${start}, v=${requestedVelocity}, u=${u}`);
      }
    }
  }
});

test("kuji release continuation stays bounded and monotonic across start positions and flick speeds", () => {
  for (let step = 0; step <= 50; step++) {
    const start = step / 50;
    const duration = kujiCompletionDuration(start);
    for (const velocity of [-100, -1, 0, .05, .5, 1, 3, 20, 1e6, Infinity, -Infinity, Number.NaN]) {
      let previous = start;
      for (let sample = 0; sample <= 200; sample++) {
        const time = duration * sample / 200;
        const state = sampleKujiCompletion(start, time, false, velocity);
        assertUnit(state.progress, 'velocity-aware progress');
        assert.ok(state.progress >= previous - 1e-12,
          `release cannot rewind at start=${start}, v=${velocity}, time=${time}`);
        previous = state.progress;
        const baseline = sampleKujiCompletion(start, time);
        assert.equal(state.settle, baseline.settle, 'release velocity must not change settle timing');
        assert.equal(state.resultOpacity, baseline.resultOpacity, 'release velocity must not change result timing');
      }
      closeTo(previous, 1, 'every valid or sanitized release finishes fully open');
      const reduced = sampleKujiCompletion(start, duration / 2, true, velocity);
      assert.equal(reduced.progress, 0);
      assert.equal(reduced.settle, 0);
      assert.equal(reduced.resultOpacity, 1);
    }
  }
});

test("kuji completion moves monotonically and keeps the final result through its hold", () => {
  for (const start of [0, .18, .58, .65, .84, 1]) {
    const duration = kujiCompletionDuration(start);
    const previous = { progress: start, settle: 0, resultOpacity: 0 };
    for (let sample = 0; sample <= 1000; sample += 1) {
      const time = duration * sample / 1000;
      const state = sampleKujiCompletion(start, time);
      for (const name of Object.keys(previous)) {
        assertUnit(state[name], name);
        assert.ok(state[name] >= previous[name], `${name} must never rewind after release`);
        previous[name] = state[name];
      }
      if (time <= duration - .24) assert.equal(state.resultOpacity, 0);
      if (time >= duration - .04 + 1e-9) assert.equal(state.resultOpacity, 1);
    }
    assert.deepEqual(sampleKujiCompletion(start, duration - .02), sampleKujiCompletion(start, duration));
  }
});

test("kuji demo completes at 1.386 s and keeps its result through the 1.62 s capture hold", () => {
  closeTo(sampleKujiDemo(.9).progress, .65, 'demo handoff progress');
  const doneAt = .9 + kujiCompletionDuration(.65);
  closeTo(doneAt, 1.386, 'demo total duration');
  const completed = sampleKujiDemo(doneAt);
  assert.equal(completed.progress, 1);
  assert.equal(completed.settle, 1);
  assert.equal(completed.resultOpacity, 1);
  assert.deepEqual(sampleKujiDemo(1.62), completed);
  assert.deepEqual(sampleKujiDemo(8), completed);
});

test("arbitrary seeks are deterministic and reduced motion skips physical movement", () => {
  const times = [3.1, 3.9, 4.0, 4.2, .66, .905, 2.4, 0, 1.3, 1.56, 1.66, 1.86, 3.0, 3.7, 3.8, .99];
  const first = times.map((time) => sampleGacha(time));
  [...times].reverse().forEach((time) => sampleGacha(time));
  assert.deepEqual(times.map((time) => sampleGacha(time)), first);
  const demos = times.map((time) => sampleKujiDemo(time));
  [...times].reverse().forEach((time) => sampleKujiDemo(time));
  assert.deepEqual(times.map((time) => sampleKujiDemo(time)), demos);
  for (const time of [0.01, 0.6, 1.8, 3.1, 3.9, 4.0, 4.2]) {
    const reduced = sampleGacha(time, true);
    assert.equal(reduced.dropHeight, 0);
    assert.equal(reduced.opening, 0);
    assert.equal(reduced.seal, 0);
    assert.equal(reduced.rattle, 0);
    assert.equal(reduced.light, 0);
    assert.equal(reduced.resultOpacity, 1);
    const paper = sampleKujiCompletion(0.58, time, true);
    assert.equal(paper.progress, 0);
    assert.equal(paper.settle, 0);
    assert.equal(paper.resultOpacity, 1);
  }
});
