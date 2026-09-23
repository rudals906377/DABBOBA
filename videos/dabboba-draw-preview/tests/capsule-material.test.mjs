import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CAPSULE_3D_FRAGMENT_SHADER } from '../scenes/capsule-shader.mjs';
import {
  CAPSULE_PREVIEW_FRAGMENT_SHADER,
  CAPSULE_MATERIAL_FRAGMENT_SHADER,
  CAPSULE_MATERIAL_REVISION,
  CAPSULE_OPEN_OFFSET,
} from '../scenes/capsule-material.mjs';

const previewRoot = new URL('../', import.meta.url);
const repoRoot = new URL('../../../', import.meta.url);

function functionSlice(source, name) {
  const signature = new RegExp(`\\bvec3\\s+${name}\\s*\\([^]*?\\)\\s*\\{`).exec(source);
  assert.ok(signature, `Missing ${name} function`);
  const start = signature.index;
  const open = start + signature[0].lastIndexOf('{');
  let depth = 1;
  let cursor = open + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
    cursor += 1;
  }
  assert.equal(depth, 0, `${name} must have balanced braces`);
  return { prefix: source.slice(0, start), body: source.slice(start, cursor), suffix: source.slice(cursor) };
}

function declaration(body, name) {
  const found = new RegExp(`\\bvec3\\s+${name}\\s*=\\s*[^;]+;`).exec(body);
  assert.ok(found, `Missing ${name} palette declaration`);
  return found[0];
}

const native = functionSlice(CAPSULE_3D_FRAGMENT_SHADER, 'shadeShell');
const material = functionSlice(CAPSULE_MATERIAL_FRAGMENT_SHADER, 'shadeShell');
const preview = functionSlice(CAPSULE_PREVIEW_FRAGMENT_SHADER, 'shadeShell');

function blockSlice(source, anchor) {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `Missing block: ${anchor}`);
  const open = source.indexOf('{', start);
  let depth = 1;
  let cursor = open + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
    cursor += 1;
  }
  assert.equal(depth, 0);
  return { prefix: source.slice(0, start), body: source.slice(start, cursor), suffix: source.slice(cursor) };
}

test('the native shader copy remains byte-identical to the current app source', async () => {
  const [copy, source] = await Promise.all([
    readFile(new URL('scenes/capsule-shader.mjs', previewRoot)),
    readFile(new URL('apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts', repoRoot)),
  ]);
  assert.deepEqual(copy, source, 'The preview override must never edit the canonical shader');
});

test('the neutral-ivory override is an explicit preview-only material revision', () => {
  assert.equal(CAPSULE_MATERIAL_REVISION, 'neutral-ivory-thin-plastic-upper-v2');
  assert.equal(typeof CAPSULE_MATERIAL_FRAGMENT_SHADER, 'string');
  assert.equal(typeof CAPSULE_PREVIEW_FRAGMENT_SHADER, 'string');
  assert.notEqual(CAPSULE_PREVIEW_FRAGMENT_SHADER, CAPSULE_3D_FRAGMENT_SHADER);
  assert.match(CAPSULE_3D_FRAGMENT_SHADER, /vec3\(0\.878, 0\.973, 0\.882\)/,
    'The imported native upper palette must remain untouched');
});

test('the material-only export leaves all code outside shadeShell exactly unchanged', () => {
  assert.equal(material.prefix, native.prefix,
    'Uniforms, intersection geometry, shell thickness, and constants must not change');
  assert.equal(material.suffix, native.suffix,
    'Camera, motion, logo texture input, emitter, and final compositing must not change');
  assert.equal(preview.body, material.body,
    'The final preview must use exactly the material that can be compared in isolation');
});

test('the upper base palette has no green cast while the lower palette stays exact', () => {
  assert.equal(declaration(preview.body, 'lower'), declaration(native.body, 'lower'));
  const upper = declaration(preview.body, 'upper');
  const triples = [...upper.matchAll(/vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g)];
  assert.ok(triples.length > 0, 'Upper material must declare its neutral-ivory RGB palette explicitly');
  for (const [, redText, greenText, blueText] of triples) {
    const [red, green, blue] = [redText, greenText, blueText].map(Number);
    assert.ok(red >= green && green >= blue, `Ivory palette has a green cast: ${red}, ${green}, ${blue}`);
    assert.ok(Math.min(red, green, blue) >= .85 && Math.max(red, green, blue) <= 1,
      'The upper base must remain light plastic, not a dark painted replacement');
    assert.ok(red - blue <= .075, 'The upper base must remain neutral ivory, not saturated yellow');
  }
});

test('the complete lower-hemisphere wordmark mapping and ink response are unchanged', () => {
  const inkBlock = body => body.slice(body.indexOf('  float ink = 0.0;'), body.indexOf('  vec3 key ='));
  assert.ok(inkBlock(native.body).length > 100);
  assert.equal(inkBlock(preview.body), inkBlock(native.body));
  assert.equal((preview.body.match(/\(1\.0 - ink \* 0\.68\)/g) ?? []).length,
    (native.body.match(/\(1\.0 - ink \* 0\.68\)/g) ?? []).length,
    'Printed wordmark reflection suppression must remain intact');
});

test('every shared-material change is upper-only and the full lower shading path stays identical', () => {
  // Selecting side < 0 must recover every original shared operation.
  // The upper palette is a dead input on that path and may be restored directly.
  const guards = [
    ['side > 0.0 ? vec3(0.800, 0.798, 0.785) : mix(vec3(0.467, 0.788, 0.475), vec3(0.812, 0.773, 0.698), uIvory)',
      'mix(vec3(0.467, 0.788, 0.475), vec3(0.812, 0.773, 0.698), uIvory)'],
    ['side > 0.0 ? vec3(0.70) : vec3(0.43, 0.46, 0.37)',
      'vec3(0.43, 0.46, 0.37)'],
    ['(side > 0.0 ? upper : lower)', 'lower'],
    ['(side > 0.0 ? 0.72 : 0.58)', '0.58'],
    ['(side > 0.0 ? vec3(0.16, 0.16, 0.15) : vec3(0.13, 0.22, 0.12))',
      'vec3(0.13, 0.22, 0.12)'],
    ['(side > 0.0 ? vec3(0.97, 0.97, 0.95) : vec3(0.88, 0.97, 0.90))',
      'vec3(0.88, 0.97, 0.90)'],
    ['(side > 0.0 ? vec3(0.80, 0.80, 0.78) : vec3(0.68, 0.86, 0.68))',
      'vec3(0.68, 0.86, 0.68)'],
    ['side > 0.0 ? 30.0 : 54.0', '54.0'],
    ['side > 0.0 ? 8.0 : 13.0', '13.0'],
    ['side > 0.0 ? 38.0 : 86.0', '86.0'],
    ['(side > 0.0 ? 0.13 : 0.34)', '0.34'],
    ['(side > 0.0 ? 0.27 : 0.20)', '0.20'],
    ['(side > 0.0 ? 0.045 : 0.08)', '0.08'],
    ['(side > 0.0 ? (0.035 + rimLight * 0.095) : (0.08 + rimLight * 0.24))',
      '(0.08 + rimLight * 0.24)'],
  ];
  let lowerPath = preview.body.replace(declaration(preview.body, 'upper'), declaration(native.body, 'upper'));
  for (const [guarded, originalLower] of guards) {
    assert.equal(lowerPath.split(guarded).length, 2,
      `Expected exactly one explicit upper-only guard: ${guarded}`);
    lowerPath = lowerPath.replace(guarded, originalLower);
  }
  const transmission = blockSlice(lowerPath, '  if (side > 0.0 && material < 1.5) {');
  assert.match(transmission.body, /edgeTransmission/);
  lowerPath = transmission.prefix + transmission.suffix;
  lowerPath = lowerPath.replace(/  \/\/ A low-energy,[^]*?  vec3 toCore =/, '  vec3 toCore =');
  assert.equal(lowerPath, native.body,
    'For the lower hemisphere all diffuse, cavity, rim, specular, Fresnel, wordmark, and emission operations must be exactly original');
});

test('upper reflections widen without increasing a sharp metallic highlight', () => {
  for (const spec of ['keySpec', 'broadSpec', 'fillSpec']) {
    const line = new RegExp(`float ${spec} = [^;]+;`).exec(material.body)?.[0];
    assert.ok(line);
    const powers = /side > 0\.0 \? ([\d.]+) : ([\d.]+)/.exec(line);
    assert.ok(powers, `${spec} must preserve the lower lobe behind an explicit side guard`);
    assert.ok(Number(powers[1]) < Number(powers[2]), `${spec} upper lobe should be broader`);
  }
  assert.match(material.body, /keySpec \* \(side > 0\.0 \? 0\.13 : 0\.34\)/);
  assert.match(material.body, /side > 0\.0 && material < 1\.5/,
    'Edge transmission must not affect the lower bowl, cut face or cavity');
  assert.match(material.body, /vec3\(1\.0, 0\.998, 0\.985\) \* edgeTransmission/,
    'Transmission tint must remain neutral-warm rather than green');
});

test('the final preview changes only approved separation and recessed emission after shading', () => {
  assert.equal(CAPSULE_OPEN_OFFSET, 0.32);
  assert.equal(preview.prefix, native.prefix,
    'Sphere intersections, radii, thickness, normals and uniforms remain native');
  const nativeMouth = blockSlice(native.suffix, '  if (coreVisible) {');
  const finalMouth = blockSlice(preview.suffix, '  if (coreVisible) {');
  assert.equal(finalMouth.prefix.replaceAll('opening * 0.32', 'opening * 0.42'), nativeMouth.prefix,
    'Only the symmetric separation amplitude may differ before the mouth composite');
  assert.equal(finalMouth.suffix, nativeMouth.suffix,
    'Final alpha, clipping and output remain exactly native');
  assert.equal((finalMouth.prefix.match(/opening \* 0\.32/g) ?? []).length, 2);
  assert.match(finalMouth.body, /centerHot = exp\(-radial \* radial \* 5\.4\)/);
  assert.match(finalMouth.body, /depthAttenuation = mix\(1\.0, 0\.62, edgeDepth\)/);
  assert.match(finalMouth.body, /color = mix\(color, mouthColor, emission\)/);
  assert.doesNotMatch(finalMouth.body, /mix\(color, vec3\(1\.0\), emission\)/,
    'The emitter must no longer composite one flat white disc');
  assert.match(finalMouth.prefix, /bool coreVisible = energy > 0\.0 && coreHit < hit\.x/,
    'Both opaque shells and the front lip must continue to occlude the light');
});
