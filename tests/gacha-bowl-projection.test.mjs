import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sampleGachaCapsuleAtlasFrame } from "../apps/mobile/src/features/draw/gacha-capsule-frames-motion.ts";
import { sampleGachaRevealLighting, sampleGachaRevealRattle } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("apps/mobile/package.json", root));
const ts = require("typescript");
const atlas = JSON.parse(readFileSync(new URL("apps/mobile/assets/draw/gacha/gacha-capsule-reveal-atlas-v1.json", root), "utf8"));
const source = readFileSync(new URL("apps/mobile/src/features/draw/gacha-bowl-projection.ts", root), "utf8");
const module = { exports: {} };
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module,
  exports: module.exports,
  require: (name) => {
    if (name.endsWith("gacha-capsule-reveal-atlas-v1.json")) return atlas;
    if (name.endsWith("gacha-capsule-frames-motion")) return { sampleGachaCapsuleAtlasFrame };
    if (name.endsWith("gacha-reveal-timeline")) return { sampleGachaRevealLighting, sampleGachaRevealRattle };
    throw new Error(`Unexpected projection dependency: ${name}`);
  },
});
const { sampleGachaBowlProjection } = module.exports;
const camera = { capsuleX: 172, capsuleY: 312, capsuleDiameter: 261.44 };
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const vertices = (path) => {
  assert.match(path, /^M .* Z$/);
  const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  assert.equal(values.length, 48, "the clip contains exactly 24 projected rim vertices");
  return Array.from({ length: 24 }, (_, index) => values.slice(index * 2, index * 2 + 2));
};

// Independent row-major matrix calculation of the documented shader transform.
const multiply = (a, b) => a.map((row) => b[0].map((_, column) => row.reduce((sum, value, k) => sum + value * b[k][column], 0)));
const transform = (matrix, vector) => matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
const rx = (angle) => [[1, 0, 0], [0, Math.cos(angle), -Math.sin(angle)], [0, Math.sin(angle), Math.cos(angle)]];
const ry = (angle) => [[Math.cos(angle), 0, Math.sin(angle)], [0, 1, 0], [-Math.sin(angle), 0, Math.cos(angle)]];
const rz = (angle) => [[Math.cos(angle), -Math.sin(angle), 0], [Math.sin(angle), Math.cos(angle), 0], [0, 0, 1]];
const smooth = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return 6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3;
};
function reference(index, local) {
  const p = atlas.frameProgress[index];
  const opening = smooth(0.18, 0.84, p);
  const seal = smooth(0.16, 0.32, p);
  const body = multiply(multiply(rz(-0.075), ry(-0.10)), rx(-0.065));
  const rotation = multiply(body, rx(opening * 0.18));
  const rotated = transform(rotation, local);
  return [rotated[0], rotated[1] - seal * 0.035 - opening * 0.42, rotated[2]];
}
function project(world, view) {
  const distance = Math.hypot(2.7 * atlas.frameWidth / atlas.projection.diameter, 1);
  const scale = view.capsuleDiameter / atlas.projection.diameter;
  const unit = 2.7 * atlas.frameWidth / 2 / (distance - world[2]);
  return { x: view.capsuleX + world[0] * unit * scale, y: view.capsuleY - world[1] * unit * scale, unitScale: unit * scale };
}

test("emitter matches the baked camera and full ordered lower-bowl rotation at every atlas frame", () => {
  for (let index = 0; index < atlas.frameCount; index += 1) {
    const actual = sampleGachaBowlProjection(atlas.frameProgress[index], camera);
    const expected = project(reference(index, [0, -0.08, 0]), camera);
    near(actual.x, expected.x);
    near(actual.y, expected.y);
    near(actual.unitScale, expected.unitScale);
  }
});

test("emitter-only projection preserves exact atlas alignment without constructing a rim path", () => {
  const views = [
    camera,
    { capsuleX: 24, capsuleY: 53, capsuleDiameter: 18 },
    { capsuleX: 301, capsuleY: 477, capsuleDiameter: 590 },
  ];
  for (const view of views) {
    for (let index = 0; index < atlas.frameCount; index += 1) {
      const progress = atlas.frameProgress[index];
      const complete = sampleGachaBowlProjection(progress, view);
      const emitterOnly = sampleGachaBowlProjection(progress, view, false);
      const expected = project(reference(index, [0, -0.08, 0]), view);
      assert.equal(emitterOnly.rimPath, "", "the native texture does not need per-frame SVG geometry");
      assert.ok(complete.rimPath.length > 0, "the existing full projection remains available");
      for (const field of ["x", "y", "unitScale"]) {
        assert.equal(emitterOnly[field], complete[field]);
        near(emitterOnly[field], expected[field]);
      }
    }
  }
  for (const p of [NaN, Infinity, -Infinity, -10, 1, 2, 10]) {
    const full = sampleGachaBowlProjection(p, camera);
    const emitterOnly = sampleGachaBowlProjection(p, camera, false);
    assert.equal(emitterOnly.rimPath, "");
    for (const field of ["x", "y", "unitScale"]) assert.equal(emitterOnly[field], full[field]);
  }
});

test("24-point mouth clip is inset inside the inner rim and local to the emitter", () => {
  for (const index of [0, 6, 12, 19, 26, 32, 35, 40, 44, 48, 56, 63]) {
    const actual = sampleGachaBowlProjection(atlas.frameProgress[index], camera);
    const rim = vertices(actual.rimPath);
    for (let point = 0; point < 24; point += 1) {
      const angle = point * Math.PI * 2 / 24;
      const expected = project(reference(index, [0.84 * Math.cos(angle), 0, 0.84 * Math.sin(angle)]), camera);
      near(rim[point][0] + actual.x, expected.x);
      near(rim[point][1] + actual.y, expected.y);
    }
    assert.ok(0.84 < 0.896, "the glow stays inside the shader's molded inner lip");
  }
});

test("pose changes only with the atlas tile while the live camera can still pan and zoom", () => {
  for (let index = 1; index < atlas.frameCount - 1; index += 1) {
    const step = (atlas.revealProgressMax - atlas.revealProgressMin) / (atlas.frameCount - 1);
    const center = atlas.revealProgressMin + index * step;
    const exact = sampleGachaBowlProjection(atlas.frameProgress[index], camera);
    for (const offset of [-0.49, -0.1, 0.1, 0.49]) {
      const p = center + offset * step;
      assert.equal(sampleGachaCapsuleAtlasFrame(p, atlas).index, index);
      assert.deepEqual(sampleGachaBowlProjection(p, camera), exact);
    }
  }
});

test("camera translation and uniform zoom preserve the baked source and rim proportions", () => {
  const p = 0.67;
  const base = sampleGachaBowlProjection(p, camera);
  const baseRim = vertices(base.rimPath);
  for (const factor of [0.12, 0.7, 1, 1.5, 3]) {
    const view = { capsuleX: camera.capsuleX + 53, capsuleY: camera.capsuleY - 79, capsuleDiameter: camera.capsuleDiameter * factor };
    const next = sampleGachaBowlProjection(p, view);
    near(next.x - view.capsuleX, (base.x - camera.capsuleX) * factor);
    near(next.y - view.capsuleY, (base.y - camera.capsuleY) * factor);
    near(next.unitScale, base.unitScale * factor);
    const rim = vertices(next.rimPath);
    for (let index = 0; index < rim.length; index += 1) {
      near(rim[index][0], baseRim[index][0] * factor);
      near(rim[index][1], baseRim[index][1] * factor);
    }
  }
});

test("exceptional progress follows the same finite closed/end frame behavior as the atlas", () => {
  const start = sampleGachaBowlProjection(0, camera);
  const end = sampleGachaBowlProjection(atlas.revealProgressMax, camera);
  for (const p of [NaN, Infinity, -Infinity, -10]) assert.deepEqual(sampleGachaBowlProjection(p, camera), start);
  for (const p of [1, 2, 10]) assert.deepEqual(sampleGachaBowlProjection(p, camera), end);
  assert.ok([start.x, start.y, start.unitScale, end.x, end.y, end.unitScale].every(Number.isFinite));
  assert.match(source, /sampleGachaCapsuleAtlasFrame/);
  assert.match(source, /frameProgress/);
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval|setTimeout|Math\.random|useState|scheduleOnRN/);
});
