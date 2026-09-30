import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as motion from "../apps/mobile/src/features/draw/kuji-firefly-motion.ts";
import { sampleGachaCameraMotion } from "../apps/mobile/src/features/draw/gacha-camera-motion.ts";

const createField = (seed, size = { width: 393, height: 680 }) => {
  assert.equal(typeof motion.createGachaFireflyConfigs, "function");
  return motion.createGachaFireflyConfigs(seed, size);
};
const lanesOf = (particles) => [...new Set(particles.map((particle) => particle.laneIndex))]
  .map((lane) => particles.filter((particle) => particle.laneIndex === lane));
const centerAt = (particle, progress, { width, height }) => {
  const frame = motion.sampleKujiFireflyMotion(particle, progress);
  return {
    ...frame,
    x: particle.leftPercent * width / 100 + particle.size / 2 + frame.translateX,
    y: particle.startTopPercent * height / 100 + particle.size / 2 + frame.translateY,
  };
};
const fractional = (value) => value - Math.floor(value);
const screen = readFileSync(new URL("../apps/mobile/src/features/draw/DrawRevealScreen.tsx", import.meta.url), "utf8");
const fieldSource = screen.slice(screen.indexOf("function DrawEmbers("), screen.indexOf("function SealedDraw("));
const ambientSource = screen.slice(screen.indexOf("function StageAmbient("), screen.indexOf("function DrawEmbers("));

// Execute the actual native component functions. Native hooks/animation scheduling
// are the boundary; no replacement field, phase equation or motion sampler is used.
function createNativeHarness() {
  const require = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
  const ts = require("typescript");
  const running = new Map();
  let current;
  const nextSlot = (kind, create) => {
    const index = current.index++;
    if (!current.slots[index]) current.slots[index] = { kind, ...create() };
    assert.equal(current.slots[index].kind, kind, "hook order must remain stable");
    return current.slots[index];
  };
  const context = {
    exports: {},
    require: (name) => {
      assert.equal(name, "react/jsx-runtime");
      return require(name);
    },
    ...motion,
    View: "View",
    Animated: { View: "Animated.View" },
    styles: { drawEmberField: "field", drawEmber: "kuji-style", dispersedGachaEmber: "gacha-style" },
    Easing: { linear: "linear" },
    useState: (initial) => {
      const slot = nextSlot("state", () => ({ value: initial }));
      return [slot.value, (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useMemo: (create, dependencies) => {
      const slot = nextSlot("memo", () => ({}));
      if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) {
        slot.value = create();
        slot.dependencies = dependencies;
      }
      return slot.value;
    },
    useSharedValue: (initial) => nextSlot("shared", () => {
      let value = initial;
      const phase = {};
      Object.defineProperty(phase, "value", {
        get: () => value,
        set: (next) => {
          if (next && typeof next === "object") running.set(phase, next);
          else value = next;
        },
      });
      return { value: phase };
    }).value,
    useEffect: (create, dependencies) => {
      const slot = nextSlot("effect", () => ({}));
      if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) {
        current.pending.push(() => {
          slot.cleanup?.();
          slot.cleanup = create();
          slot.dependencies = dependencies;
        });
      }
    },
    useAnimatedStyle: (sample) => sample(),
    cancelAnimation: (phase) => running.delete(phase),
    withTiming: (target, options) => ({ kind: "timing", target, ...options }),
    withRepeat: (animation, count, reverse) => ({ kind: "repeat", animation, count, reverse }),
  };
  runInNewContext(ts.transpileModule(`${ambientSource}\n${fieldSource}\nglobalThis.components = { StageAmbient, DrawEmbers, DrawEmberLoop, DrawEmber };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return {
    running,
    components: context.components,
    instance: (component) => {
      const state = { slots: [], index: 0, pending: [] };
      return {
        render: (props) => {
          current = state;
          state.index = 0;
          state.pending = [];
          const tree = component(props);
          for (const effect of state.pending) effect();
          return tree;
        },
        unmount: () => {
          for (const slot of state.slots) if (slot.kind === "effect") slot.cleanup?.();
        },
      };
    },
  };
}

test("gacha spreads 36 deterministic embers evenly across twelve three-particle lanes", () => {
  const first = createField("entitlement-1");
  assert.equal(motion.GACHA_FIREFLY_COUNT, 36);
  assert.equal(motion.GACHA_FIREFLY_DURATION_MS, 12_000);
  assert.equal(first.length, 36);
  assert.deepEqual(first, createField("entitlement-1"));
  assert.notDeepEqual(first, createField("entitlement-2"));
  assert.equal(new Set(first.map((particle) => particle.id)).size, 36);
  assert.equal(new Set(first.map((particle) => particle.laneIndex)).size, 12);
  const centers = first.map((particle) => particle.leftPercent + particle.size / 2 / 393 * 100);
  for (let quarter = 0; quarter < 4; quarter += 1) {
    assert.equal(centers.filter((center) => center >= quarter * 25 && center < (quarter + 1) * 25).length, 9,
      "every horizontal quarter must receive equal population, not two crowded edge strips");
  }
  for (const lane of new Set(first.map((particle) => particle.laneIndex))) {
    const particles = first.filter((particle) => particle.laneIndex === lane);
    assert.equal(particles.length, 3);
    assert.ok(particles.every((particle) => particle.durationMs === 12_000));
    const phases = particles.map((particle) => particle.startOffset).sort((a, b) => a - b);
    for (let index = 0; index < phases.length; index += 1) {
      const next = index === phases.length - 1 ? phases[0] + 1 : phases[index + 1];
      assert.ok(Math.abs(next - phases[index] - 1 / 3) < 1e-12,
        "three vertically staggered embers keep exact one-third-cycle spacing forever");
    }
  }
  const phases = first.map((particle) => particle.startOffset).sort((a, b) => a - b);
  for (let index = 0; index < phases.length; index += 1) {
    const next = index === phases.length - 1 ? phases[0] + 1 : phases[index + 1];
    assert.ok(next - phases[index] >= 0.02 && next - phases[index] <= 1 / 24,
      "field-wide phase ranks must not form synchronized horizontal launch rows");
  }
  const lanes = lanesOf(first);
  for (let index = 0; index < lanes.length; index += 2) {
    const phaseA = Math.min(...lanes[index].map((particle) => particle.startOffset));
    const phaseB = Math.min(...lanes[index + 1].map((particle) => particle.startOffset));
    assert.ok(Math.abs(Math.abs(phaseA - phaseB) - 1 / 6) < 0.008,
      "adjacent lane pairs should interleave heights, including the exposed outer pairs");
  }
});

test("the retired twelve-particle kuji helper is removed; only the dispersed field remains", () => {
  assert.equal(motion.createKujiFireflyConfigs, undefined);
  assert.equal(motion.KUJI_FIREFLY_COUNT, undefined);
  assert.equal(typeof motion.createGachaFireflyConfigs, "function");
});

test("complete gacha paths fit narrow and tall stages with separate horizontal lanes", () => {
  for (const width of [160, 240, 280, 320, 393, 430, 768]) {
    for (const height of [320, 496, 680, 920]) {
      for (let seed = 0; seed < 16; seed += 1) {
        const particles = createField(`draw-${seed}`, { width, height });
        const laneBounds = new Map();
        for (const particle of particles) {
          const centerX = particle.leftPercent * width / 100 + particle.size / 2;
          // Rotation never exceeds 9 degrees and scale never exceeds 1. This
          // independent support bound includes the complete square, not just its center.
          const extent = particle.size / 2 * (Math.cos(Math.PI / 20) + Math.sin(Math.PI / 20));
          const minimumX = centerX - particle.curveAmplitude - extent;
          const maximumX = centerX + particle.curveAmplitude + extent;
          assert.ok(minimumX >= 0 && maximumX <= width);
          const lane = laneBounds.get(particle.laneIndex) ?? { minimum: Infinity, maximum: -Infinity };
          lane.minimum = Math.min(lane.minimum, minimumX);
          lane.maximum = Math.max(lane.maximum, maximumX);
          laneBounds.set(particle.laneIndex, lane);
          let previousY = Infinity;
          for (let step = 0; step <= 32; step += 1) {
            const frame = motion.sampleKujiFireflyMotion(particle, step / 32);
            assert.ok(Object.values(frame).every(Number.isFinite));
            assert.ok(Math.abs(frame.rotateDeg) <= 9 && frame.scale > 0 && frame.scale <= 1);
            const centerY = particle.startTopPercent * height / 100 + particle.size / 2 + frame.translateY;
            assert.ok(centerY >= extent && centerY + extent <= height);
            assert.ok(centerY < previousY);
            previousY = centerY;
            if (step === 0 || step === 32) assert.equal(frame.opacity, 0);
          }
          assert.ok(particle.startTopPercent > 90);
          assert.ok(previousY < height * 0.1, "each ember must reach the upper edge of a tall stage");
        }
        const bounds = [...laneBounds.values()].sort((a, b) => a.minimum - b.minimum);
        for (let index = 1; index < bounds.length; index += 1) {
          assert.ok(bounds[index - 1].maximum < bounds[index].minimum,
            `seed ${seed}, width ${width}: complete paths from different lanes cannot overlap`);
        }
      }
    }
  }
});

test("same-lane embers never meet and each lane remains populated for fifty complete cycles", () => {
  for (const stage of [{ width: 160, height: 320 }, { width: 393, height: 680 }, { width: 768, height: 920 }]) {
    for (let seed = 0; seed < 12; seed += 1) {
      const lanes = lanesOf(createField(`draw-${seed}`, stage));
      for (const cycle of [0, 1, 7, 23, 50]) {
        for (let step = 0; step <= 120; step += 1) {
          const elapsedMs = (cycle + step / 120) * 12_000;
          for (const particles of lanes) {
            const positions = particles.map((particle) => ({
              ...centerAt(particle, fractional(elapsedMs / particle.durationMs + particle.startOffset), stage),
              size: particle.size,
            })).sort((a, b) => a.y - b.y);
            assert.ok(positions.filter((position) => position.opacity >= 0.25).length >= 2,
              "every lane must retain at least two visible embers even while a third wraps");
            for (let index = 1; index < positions.length; index += 1) {
              const upper = positions[index - 1];
              const lower = positions[index];
              const gap = lower.y - upper.y;
              assert.ok(gap > (upper.size + lower.size) / Math.SQRT2,
                "even bounding circles of same-lane squares must not meet");
              assert.ok(gap >= stage.height * 0.25,
                "vertically staggered embers must stay broadly separated, not gradually bunch up");
            }
          }
        }
      }
    }
  }
});

test("visible embers continue across both sides and all vertical regions around the opaque cabinet", () => {
  // Use the independently measured source-alpha bounds rounded outward. Treat
  // the entire rectangle as opaque, including its clear glass: conservative visibility.
  for (const [width, height] of [[160, 320], [280, 496], [393, 680], [430, 920], [768, 920], [768, 320]]) {
    const stage = { width, height };
    const scale = sampleGachaCameraMotion(0, width, height).presentationScale;
    const cabinet = {
      left: width / 2 + (33 - 95) * scale,
      right: width / 2 + (157 - 95) * scale,
      top: height / 2 + (41 - 169) * scale,
      bottom: height / 2 + (294 - 169) * scale,
    };
    for (let seed = 0; seed < 16; seed += 1) {
      const particles = createField(`draw-${seed}`, stage);
      const emptySteps = [0, 0, 0];
      // Two periods include the wrap boundary; fixed equal periods then preserve
      // this spatial distribution indefinitely (also sampled after 50 cycles above).
      for (let step = 0; step < 240; step += 1) {
        const quadrants = [0, 0, 0, 0];
        const thirds = [0, 0, 0];
        for (const particle of particles) {
          const frame = centerAt(particle, fractional(step / 120 + particle.startOffset), stage);
          const extent = particle.size / Math.SQRT2;
          const uncovered = frame.x + extent < cabinet.left || frame.x - extent > cabinet.right
            || frame.y + extent < cabinet.top || frame.y - extent > cabinet.bottom;
          if (frame.opacity < 0.25 || !uncovered) continue;
          quadrants[(frame.y < height / 2 ? 0 : 2) + (frame.x < width / 2 ? 0 : 1)] += 1;
          thirds[Math.min(2, Math.floor(frame.y / height * 3))] += 1;
        }
        assert.ok(quadrants.every((count) => count >= 1),
          `seed ${seed}, ${width}×${height}, step ${step}: all four exposed quadrants remain populated`);
        for (let third = 0; third < 3; third += 1) {
          emptySteps[third] = thirds[third] === 0 ? emptySteps[third] + 1 : 0;
          // An edge fade may briefly empty one third, but not create a perceptible
          // half-second pause in that region while the opposite side loops.
          assert.ok(emptySteps[third] * 100 < 500,
            `seed ${seed}, ${width}×${height}: vertical third ${third} goes empty too long`);
        }
      }
    }
  }
});

test("each ember resets only while transparent without a synchronized field blink", () => {
  const particles = createField("loop-seam");
  for (const particle of particles) {
    for (const p of [0, 1]) assert.equal(motion.sampleKujiFireflyMotion(particle, p).opacity, 0);
    for (const p of [1e-7, 1 - 1e-7]) assert.ok(motion.sampleKujiFireflyMotion(particle, p).opacity < 2e-6);
  }
  const brightness = (phase) => particles.reduce((sum, particle) => sum
    + motion.sampleKujiFireflyMotion(particle, fractional(phase + particle.startOffset)).opacity, 0);
  assert.ok(Math.abs(brightness(1 - 1e-7) - brightness(1 + 1e-7)) < 1e-4,
    "the shared clock reset must not blank or relaunch the whole field together");
});

test("unmeasured or invalid stages do not start a guessed gacha field", () => {
  for (const stage of [
    { width: 0, height: 680 }, { width: 393, height: 0 },
    { width: -1, height: 680 }, { width: 393, height: -1 },
    { width: NaN, height: 680 }, { width: 393, height: Infinity },
  ]) assert.deepEqual(createField("draw-1", stage), []);
});

test("the native field stays behind the machine, noninteractive and cancellable under Reduced Motion", () => {
  const field = fieldSource;
  assert.match(field, /createGachaFireflyConfigs\(seed, stageSize\)/);
  assert.doesNotMatch(field, /createKujiFireflyConfigs|KujiEmberLoop/,
    "both production draw categories must use the same dispersed field and shared clock");
  assert.match(field, /onLayout=\{/);
  assert.doesNotMatch(field, /onLayout=\{sourceCategory === "gacha"/);
  assert.match(field, /if \(reduceMotion\) return null/);
  assert.match(field, /pointerEvents="none"/);
  assert.match(field, /accessibilityElementsHidden/);
  assert.match(field, /return \(\) => cancelAnimation\(phase\)/);
  assert.match(field, /useAnimatedStyle[\s\S]*?sampleKujiFireflyMotion/);
  assert.doesNotMatch(field, /Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  assert.ok(screen.indexOf("<StageAmbient sourceCategory={sourceCategory}") < screen.indexOf("<GachaLeverMachine"));
});

test("one measured shared parent clock drives every child and cancels on field removal", () => {
  const harness = createNativeHarness();
  const field = harness.instance(harness.components.DrawEmbers);
  const props = { seed: "shared-phase", reduceMotion: false };
  const unmeasured = field.render(props);
  assert.equal(unmeasured.props.children, false);
  assert.equal(harness.running.size, 0);
  unmeasured.props.onLayout({ nativeEvent: { layout: { width: 393, height: 680 } } });
  const measured = field.render(props);
  const loopNode = measured.props.children;
  assert.equal(loopNode.type, harness.components.DrawEmberLoop);
  const loop = harness.instance(loopNode.type);
  const tree = loop.render(loopNode.props);
  const children = tree.props.children;
  assert.equal(children.length, 36);
  assert.equal(new Set(children.map((child) => child.props.phase)).size, 1);
  assert.equal(harness.running.size, 1);
  const [phase, animation] = [...harness.running][0];
  assert.equal(animation.kind, "repeat");
  assert.equal(animation.count, -1);
  assert.equal(animation.reverse, false);
  assert.equal(animation.animation.duration, 12_000);
  assert.equal(animation.animation.easing, "linear");
  const repeat = loop.render(loopNode.props);
  assert.equal(repeat.props.children[0].props.phase, phase);
  assert.equal(harness.running.get(phase), animation, "ordinary rerender must not restart the loop");
  phase.value = 0.413;
  for (const child of children) {
    assert.equal(child.type, harness.components.DrawEmber);
    assert.equal(child.props.phase, phase);
    assert.equal(child.props.dispersed, true);
    const rendered = harness.instance(child.type).render(child.props);
    const style = rendered.props.style.at(-1);
    const expected = motion.sampleKujiFireflyMotion(child.props.particle, fractional(phase.value + child.props.particle.startOffset));
    assert.equal(style.opacity, expected.opacity);
    assert.equal(style.transform[0].translateX, expected.translateX);
    assert.equal(style.transform[1].translateY, expected.translateY);
  }
  assert.equal(harness.running.size, 1, "particles cannot create additional independent clocks");
  assert.equal(field.render({ ...props, reduceMotion: true }), null);
  // React unmounts the removed child subtree; run its real effect cleanup.
  loop.unmount();
  assert.equal(harness.running.size, 0);
  field.unmount();
});

test("kuji and gacha mount identical measured distributions, one clock and the same quiet ember style", () => {
  for (const stage of [{ width: 280, height: 496 }, { width: 393, height: 680 }, { width: 768, height: 920 }]) {
    const snapshots = ["gacha", "kuji"].map((sourceCategory) => {
      const harness = createNativeHarness();
      const ambient = harness.instance(harness.components.StageAmbient);
      const ambientProps = { seed: "same-draw-seed", reduceMotion: false, sourceCategory };
      const node = ambient.render(ambientProps);
      assert.equal(node.type, harness.components.DrawEmbers);
      const field = harness.instance(node.type);
      const initial = field.render(node.props);
      assert.equal(initial.props.children, false, "neither category can spawn unmeasured particles");
      assert.equal(harness.running.size, 0);
      assert.equal(typeof initial.props.onLayout, "function");
      initial.props.onLayout({ nativeEvent: { layout: stage } });
      const measured = field.render(node.props);
      const loopNode = measured.props.children;
      assert.equal(loopNode.type, harness.components.DrawEmberLoop);
      const loop = harness.instance(loopNode.type);
      const tree = loop.render(loopNode.props);
      assert.equal(tree.props.children.length, 36);
      assert.equal(harness.running.size, 1);
      const [phase, animation] = [...harness.running][0];
      assert.equal(animation.animation.duration, 12_000);
      assert.equal(new Set(tree.props.children.map((child) => child.props.phase)).size, 1);
      const frames = [];
      for (const progress of [0, 0.17, 0.5, 0.83, 1]) {
        phase.value = progress;
        frames.push(tree.props.children.map((child) => {
          assert.equal(child.props.dispersed, true);
          const rendered = harness.instance(child.type).render(child.props);
          assert.equal(rendered.props.style[1], "gacha-style", "kuji must use the same restrained shared halo style");
          return rendered.props.style.at(-1);
        }));
      }
      const reducedNode = ambient.render({ ...ambientProps, reduceMotion: true });
      assert.equal(field.render(reducedNode.props), null);
      loop.unmount();
      field.unmount();
      ambient.unmount();
      assert.equal(harness.running.size, 0);
      return { particles: loopNode.props.particles, frames };
    });
    assert.equal(JSON.stringify(snapshots[0]), JSON.stringify(snapshots[1]),
      "the category must not change positions, phases, speeds, opacity, size or curve motion");
  }
});
