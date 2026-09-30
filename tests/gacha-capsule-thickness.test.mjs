import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GACHA_CAPSULE_PROFILE } from "../apps/mobile/src/features/draw/gacha-capsule-profile.ts";

// The optional path allows a saved prior shader to demonstrate regression
// sensitivity without reverting or touching the live working tree.
const shaderPath = process.env.DABBOBA_CAPSULE_THICKNESS_SOURCE
  || new URL("../scripts/gacha-capsule-3d-shaders.ts", import.meta.url);
const shader = readFileSync(shaderPath, "utf8");
const numberFrom = (pattern) => {
  const match = shader.match(pattern);
  assert.ok(match, `missing shader geometry: ${pattern}`);
  const value = Number(match[1]);
  assert.ok(Number.isFinite(value));
  return value;
};
const declared = (name) => shader.match(new RegExp(`const float ${name} = ([\\d.]+);`))?.[1];
const geometry = {
  outerRadius: /intersectProfile\(ro, rd, side, 1\.0, 1\.0, hit\)/.test(shader)
    ? GACHA_CAPSULE_PROFILE.radius
    : numberFrom(/vec2 outer = sphereRoots\(ro, rd, ([\d.]+)\)/),
  innerRadius: Number(declared("INNER_RADIUS")),
  // Legacy numeric expressions are read only to exercise the saved thick-shell
  // baseline with the same geometric acceptance tests, not to bless its design.
  collarRadius: declared("COLLAR_RADIUS") === undefined
    ? numberFrom(/float c = dot\(ro.xz, ro.xz\) - ([\d.]+) \*/)
    : Number(declared("COLLAR_RADIUS")),
  collarHeight: declared("COLLAR_HEIGHT") === undefined
    ? numberFrom(/y1 >= 0\.0 && y1 <= ([\d.]+)\)/)
    : Number(declared("COLLAR_HEIGHT")),
};

function violatesThinPlastic({ outerRadius, innerRadius, collarRadius, collarHeight }) {
  const wallFraction = (outerRadius - innerRadius) / outerRadius;
  return [
    outerRadius !== 1 && "outer silhouette changed",
    !(wallFraction >= 0.015 && wallFraction <= 0.025) && "wall outside 1.5–2.5% radius",
    !(collarRadius > outerRadius && collarRadius <= 1.008) && "oversized or missing lip",
    !(collarHeight > 0 && collarHeight <= 0.020) && "oversized or missing collar height",
  ].filter(Boolean);
}

test("capsule keeps its unit exterior while the plastic wall is only 1.5–2.5% of its radius", () => {
  assert.equal(geometry.outerRadius, 1, "thin the wall internally, not by shrinking the capsule");
  const gap = geometry.outerRadius - geometry.innerRadius;
  assert.ok(gap >= 0.015 && gap <= 0.025, `radial wall gap ${gap} must be thin plastic`);
});

test("molded lip and collar remain finite but no longer form an oversized solid ring", () => {
  assert.ok(geometry.collarRadius > 1 && geometry.collarRadius <= 1.008, `collar radius ${geometry.collarRadius}`);
  assert.ok(geometry.collarHeight > 0 && geometry.collarHeight <= 0.020, `collar height ${geometry.collarHeight}`);
  const annularWidth = geometry.collarRadius - geometry.innerRadius;
  const annularArea = Math.PI * (geometry.collarRadius ** 2 - geometry.innerRadius ** 2);
  assert.ok(Number.isFinite(annularArea) && annularArea > 0, "the cut face remains a real nonzero annulus");
  assert.ok(annularWidth > 0 && annularWidth <= 0.033 + 1e-12);
  assert.ok(annularArea / Math.PI <= 0.066, "the lip's cut face occupies at most 6.6% of the unit disk");
});

test("original thick-wall geometry is rejected by the same independent acceptance bounds", () => {
  const old = { outerRadius: 1, innerRadius: 0.896, collarRadius: 1.019, collarHeight: 0.046 };
  assert.equal(violatesThinPlastic(old).length, 3);
  assert.equal(violatesThinPlastic({ outerRadius: 1, innerRadius: 0.98, collarRadius: 1.006, collarHeight: 0.016 }).length, 0);
  assert.ok(violatesThinPlastic({ ...old, outerRadius: 0.9 }).includes("outer silhouette changed"));
});

test("thin collar top faces, cut faces and inner surfaces retain correctly facing unit normals", () => {
  const body = shader.match(/vec3 localNormal\(vec3 position, float material, float side\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, "the actual shell normal function remains available");
  assert.match(body, /position.y \* side > COLLAR_HEIGHT \* 0\.5 \? side : -side/, "normal selection follows the thinner collar height");
  const vec3 = (x, y, z) => ({ x, y, z });
  const normalize = (p) => {
    const length = Math.hypot(p.x, p.y, p.z);
    return vec3(p.x / length, p.y / length, p.z / length);
  };
  const negate = (p) => vec3(-p.x, -p.y, -p.z);
  const divide = (p, scale) => vec3(p.x / scale, p.y / scale, p.z / scale);
  const profileBody = shader.match(/vec3 profileNormal\(vec3 position, float side\) \{([\s\S]*?)\n\}/)?.[1];
  const evaluateProfile = profileBody && new Function(
    "position", "side", "PROFILE_BASE_RADIUS", "PROFILE_UPPER_STRAIGHT", "PROFILE_LOWER_STRAIGHT", "vec3", "normalize", "max",
    profileBody.replace(/\bfloat /g, "let ").replace("length(position.xz)", "Math.hypot(position.x, position.z)"),
  );
  const profileNormal = (p, side) => evaluateProfile
    ? evaluateProfile(p, side, GACHA_CAPSULE_PROFILE.lowerBaseRadius, GACHA_CAPSULE_PROFILE.upperStraight, GACHA_CAPSULE_PROFILE.lowerStraight, vec3, normalize, Math.max)
    : normalize(p);
  // Execute the actual small arithmetic body. Its only GLSL-specific operator
  // adaptations are vector negation and division; profile arithmetic is read
  // from the live shader rather than copied as a second implementation.
  const executable = body.replace("return -normalize(position);", "return negate(normalize(position));")
    .replace("return -profileNormal(position / INNER_RADIUS, side);", "return negate(profileNormal(divide(position, INNER_RADIUS), side));");
  const evaluate = new Function("position", "material", "side", "COLLAR_HEIGHT", "INNER_RADIUS", "vec3", "normalize", "negate", "divide", "profileNormal", executable);
  const normal = (p, material, side) => evaluate(p, material, side, geometry.collarHeight, geometry.innerRadius, vec3, normalize, negate, divide, profileNormal);
  const middleRadius = (geometry.innerRadius + geometry.collarRadius) / 2;
  for (const side of [-1, 1]) {
    assert.deepEqual(normal(vec3(middleRadius, 0, 0), 3, side), vec3(0, -side, 0));
    assert.deepEqual(normal(vec3(middleRadius, geometry.collarHeight * side, 0), 3, side), vec3(0, side, 0));
    assert.deepEqual(normal(vec3(geometry.collarRadius, geometry.collarHeight * side / 2, 0), 4, side), vec3(1, 0, 0));
    const position = vec3(0.3, side * 0.4, Math.sqrt(0.75));
    const outer = normal(position, 1, side);
    const inner = normal(vec3(position.x * geometry.innerRadius, position.y * geometry.innerRadius, position.z * geometry.innerRadius), 2, side);
    for (const axis of ["x", "y", "z"]) {
      assert.ok(Math.abs(inner[axis] + outer[axis]) < 1e-12, `${axis} inner and outer normals must oppose`);
    }
    assert.ok(Math.abs(Math.hypot(outer.x, outer.y, outer.z) - 1) < 1e-12);
  }
  if (profileBody) {
    const innerApex = normal(vec3(0, geometry.innerRadius, 0), 2, 1);
    const innerFloor = normal(vec3(0.3, -geometry.innerRadius, 0), 2, -1);
    assert.equal(innerApex.y, -1, "the inside of the dome faces into the capsule");
    assert.equal(innerFloor.y, 1, "the inner flat floor faces the open mouth");
    for (const n of [innerApex, innerFloor]) {
      assert.ok([n.x, n.y, n.z].every(Number.isFinite));
      assert.equal(Math.hypot(n.x, n.y, n.z), 1);
    }
  }
});
