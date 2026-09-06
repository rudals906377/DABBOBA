import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAPSULE_3D_FRAGMENT_SHADER as shader } from "../apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts";
import { GACHA_CAPSULE_PROFILE as profile, createCapsuleProfileRings } from "../apps/mobile/src/features/draw/gacha-capsule-profile.ts";
import { GACHA_CHAMBER_CAPSULES } from "../apps/mobile/src/features/draw/gacha-capsule-motion.ts";

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + " != " + expected);
const v2 = (x, y = x) => ({ x, y });
const v3 = (x, y, z) => ({ x, y, z, get xz() { return v2(this.x, this.z); } });
const addScaled = (a, b, scale) => v3(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
const length = (p) => Math.hypot(p.x, p.y, p.z ?? 0);
const normalize = (p) => v3(p.x / length(p), p.y / length(p), p.z / length(p));
const negate = (p) => v3(-p.x, -p.y, -p.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);

// Execute the actual small shader routines, translating vector syntax and
// inout assignment only. Independent sphere/plane/matrix oracles follow below.
function shaderRoutine(name) {
  const match = shader.match(new RegExp("(?:void|vec2|vec3|float) " + name + "\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}"));
  assert.ok(match, "missing actual shader routine " + name);
  const args = match[1].split(",").map((arg) => arg.trim().split(/\s+/).at(-1)).join(",");
  const body = match[2]
    .replace(/\b(?:float|vec[23])\s+(\w+)/g, "let $1")
    .replace(/ro \+ t \* rd|ro \+ rd \* t/g, "addScaled(ro, rd, t)")
    .replace(/(?<!let )hit = vec2\(([^;]+)\);/g, "Object.assign(hit, vec2($1));")
    .replace("return -normalize(position);", "return negate(normalize(position));");
  return "function " + name + "(" + args + ") {" + body + "\n}";
}
const constants = [...shader.matchAll(/const float (\w+) = ([\d.]+);/g)].map(([, name, value]) => "const " + name + " = " + value + ";").join("\n");
const names = ["sphereRoots", "acceptShell", "intersectShell", "localNormal", "intersectMouthLight"];
const routines = new Function("vec2", "vec3", "dot", "length", "abs", "sqrt", "normalize", "addScaled", "negate",
  constants + "\n" + names.map(shaderRoutine).join("\n") + "\nreturn {" + names.join(",") + "};",
)(v2, v3, dot, length, Math.abs, Math.sqrt, normalize, addScaled, negate);

function assertSphericalRings(rings) {
  assert.ok(rings.length >= 8);
  near(rings[0].radius, 1); near(rings[0].height, 0);
  near(rings.at(-1).radius, 0); near(rings.at(-1).height, 1);
  rings.forEach((ring, index) => {
    near(ring.radius ** 2 + ring.height ** 2, 1, 1e-12);
    if (index) {
      assert.ok(ring.height > rings[index - 1].height);
      assert.ok(ring.radius < rings[index - 1].radius);
    }
  });
}

test("hero geometry is an exact unit sphere, not the former straight-sided dome and flat-bottom cup", () => {
  assert.equal(profile.radius, 1);
  assert.equal(profile.halfHeight, 1);
  assertSphericalRings(createCapsuleProfileRings(1));
  assertSphericalRings(createCapsuleProfileRings(-1));
  assert.deepEqual(createCapsuleProfileRings(1), createCapsuleProfileRings(-1));
  assert.doesNotMatch(shader, /intersectProfile|PROFILE_BASE_RADIUS|gacha-capsule-profile/);
  const formerCup = createCapsuleProfileRings(-1).map((ring) => ({ ...ring }));
  formerCup[formerCup.length - 1].radius = 0.55;
  assert.throws(() => assertSphericalRings(formerCup));
});

test("actual shell intersections match spherical cross-sections and keep the cavity hollow", () => {
  for (const side of [-1, 1]) {
    for (const height of [0.03, 0.12, 0.4, 0.65, 0.9, 0.97]) {
      const radius = Math.sqrt(1 - height ** 2);
      for (const offset of [0, radius * 0.5, radius * 0.95]) {
        const hit = routines.intersectShell(v3(offset, side * height, 3), v3(0, 0, -1), side);
        near(hit.x, 3 - Math.sqrt(radius ** 2 - offset ** 2));
        assert.equal(hit.y, 1);
      }
      const inside = routines.intersectShell(v3(0, side * height, 0), v3(0, 0, 1), side);
      near(inside.x, Math.sqrt(0.98 ** 2 - height ** 2));
      assert.equal(inside.y, 2);
      assert.equal(routines.intersectShell(v3(radius + 0.01, side * height, 3), v3(0, 0, -1), side).x, 1000);
      assert.equal(routines.intersectShell(v3(0, -side * height, 3), v3(0, 0, -1), side).x, 1000);
    }
    const pole = routines.intersectShell(v3(0, side * 2, 0), v3(0, -side, 0), side);
    near(pole.x, 1);
    assert.equal(pole.y, 1);
  }
  const tangent = routines.sphereRoots(v3(1, 0, 3), v3(0, 0, -1), 1);
  near(tangent.x, 3); near(tangent.y, 3);
});

test("both spherical surfaces retain finite opposing unit normals and a constant two-percent wall", () => {
  for (const side of [-1, 1]) {
    for (let step = 1; step <= 99; step += 1) {
      const height = step / 100;
      const radius = Math.sqrt(1 - height ** 2);
      const point = v3(radius, side * height, 0);
      const innerPoint = v3(point.x * 0.98, point.y * 0.98, 0);
      const outer = routines.localNormal(point, 1, side);
      const inner = routines.localNormal(innerPoint, 2, side);
      near(length(outer), 1); near(length(inner), 1);
      near(dot(outer, inner), -1);
      near(length(addScaled(point, innerPoint, -1)), 0.02);
      assert.ok([outer.x, outer.y, outer.z, inner.x, inner.y, inner.z].every(Number.isFinite));
    }
  }
});

test("internal emission is a bounded recessed plane with soft edges, never a glowing sphere", () => {
  near(routines.intersectMouthLight(v3(0, 2, 0), v3(0, -1, 0)), 2.08);
  near(routines.intersectMouthLight(v3(0.8, 2, 0), v3(0, -1, 0)), 2.08);
  for (const [origin, direction] of [
    [v3(0.85, 2, 0), v3(0, -1, 0)],
    [v3(0, 2, 0), v3(0, 1, 0)],
    [v3(0, -0.08, 0), v3(0, 0, 1)],
    [v3(0, -0.08, 0), v3(0, -1, 0)],
  ]) assert.equal(routines.intersectMouthLight(origin, direction), 1000);
  assert.ok(Math.hypot(0.84, 0.08) < 0.98, "the complete emitting disk fits inside the thin spherical cavity");
  assert.doesNotMatch(shader, /sphereRoots\(ro - emitterCenter/);
  assert.match(shader, /feather = 1\.0 - smoothstep\(0\.72, 1\.0, radial\)/);
  assert.match(shader, /color = mix\(color, vec3\(1\.0\), emission\)/);
});

// Independent row-major matrix pose, not a second copy of shader GLSL.
const multiply = (a, b) => a.map((row) => b[0].map((_, column) => row.reduce((sum, value, k) => sum + value * b[k][column], 0)));
const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const transpose = (m) => m[0].map((_, i) => m.map((row) => row[i]));
const transform = (m, v) => {
  const values = m.map((row) => row[0] * v.x + row[1] * v.y + row[2] * v.z);
  return v3(...values);
};
function rayInHalf(ro, rd, side, opening, seal) {
  const body = multiply(multiply(rz(-0.075), ry(-0.10)), rx(-0.065));
  const inverse = transpose(multiply(body, rx(-side * opening * 0.18)));
  const centerY = side * (seal * 0.035 + opening * 0.42);
  return [transform(inverse, v3(ro.x, ro.y - centerY, ro.z)), transform(inverse, rd)];
}
test("both opaque halves hide the internal light when closed and expose it only through the opening", () => {
  const visibleCounts = [];
  for (const opening of [0, 0.5, 1]) {
    let visible = 0;
    for (let y = -0.9; y <= 0.9; y += 0.06) {
      for (let x = -0.9; x <= 0.9; x += 0.06) {
        const ro = v3(0, 0, 4);
        const rd = normalize(v3(x, y, -4));
        const upper = rayInHalf(ro, rd, 1, opening, opening > 0 ? 1 : 0);
        const lower = rayInHalf(ro, rd, -1, opening, opening > 0 ? 1 : 0);
        const nearShell = Math.min(routines.intersectShell(...upper, 1).x, routines.intersectShell(...lower, -1).x);
        const source = routines.intersectMouthLight(...lower);
        if (source < nearShell) visible += 1;
      }
    }
    visibleCounts.push(visible);
  }
  assert.equal(visibleCounts[0], 0, "a closed opaque sphere must hide even a forced-on internal source");
  assert.ok(visibleCounts[2] > 0, "the fully separated halves must reveal the recessed luminous face");
  assert.match(shader, /bool isUpper = upperHit.x < lowerHit.x/);
  assert.match(shader, /vec2 hit = isUpper \? upperHit : lowerHit/);
  assert.match(shader, /bool coreVisible = energy > 0\.0 && coreHit < hit.x/);
  assert.ok(shader.indexOf("if (coreVisible)") > shader.indexOf("color = shadeShell("));
});

test("the new hero sphere does not replace the poured 26-capsule chamber model", () => {
  assert.equal(GACHA_CHAMBER_CAPSULES.length, 26);
  const source = readFileSync(new URL("../apps/mobile/src/features/draw/gacha-capsule-motion.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /gacha-capsule-profile|intersectProfile/);
});
