import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { getGachaCapsuleGlowAlpha, sampleGachaCapsuleGlow } from "../apps/mobile/src/features/draw/gacha-capsule-glow.ts";
import { sampleGachaRevealLighting } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(read("apps/mobile/assets/gacha-capsule-glow-v1.json"));
const png = read("apps/mobile/assets/gacha-capsule-glow-v1.png");
const generator = read("scripts/generate-gacha-capsule-glow.ts").toString("utf8");
const component = read("apps/mobile/src/features/draw/GachaCapsuleGlow.tsx").toString("utf8");
const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx").toString("utf8");
const sample = (p, reduced = false) => sampleGachaCapsuleGlow(p, sampleGachaRevealLighting(p, reduced), reduced);

function decodePng(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let width = 0;
  let height = 0;
  const blocks = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6, "texture must preserve RGBA transparency");
      assert.equal(data[12], 0, "texture must be non-interlaced");
    } else if (type === "IDAT") blocks.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(blocks));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position++];
    for (let x = 0; x < stride; x += 1) {
      const pixel = y * stride + x;
      const left = x >= 4 ? rgba[pixel - 4] : 0;
      const up = y > 0 ? rgba[pixel - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? rgba[pixel - stride - 4] : 0;
      const guess = left + up - upperLeft;
      const distances = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upperLeft)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2]
        ? left : distances[1] <= distances[2] ? up : upperLeft;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      assert.notEqual(predictor, undefined, `unsupported PNG filter ${filter}`);
      rgba[pixel] = (raw[position++] + predictor) & 255;
    }
  }
  return { width, height, rgba };
}


test("premium glow is a bounded source-hashed offline monochrome texture", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "soft-monochrome-capsule-glow");
  assert.equal(manifest.width, 768);
  assert.equal(manifest.height, 768);
  assert.equal(manifest.decodedBytes, 768 * 768 * 4);
  assert.ok(manifest.decodedBytes <= 4 * 1024 * 1024);
  assert.equal(manifest.textureSha256, sha256(png));
  assert.equal(manifest.sourceSha256, sha256(read("apps/mobile/src/features/draw/gacha-capsule-glow.ts")));
  assert.match(generator, /getGachaCapsuleGlowAlpha\(radius\)/);
  assert.doesNotMatch(generator, /fetch\(|https?:\/\/|Math\.random|GACHA_PRISM_RAYS|readFile\([^)]*\.env/);
});

test("glow pixels form one smooth white radial field with fully transparent edges and no fan directions", () => {
  const decoded = decodePng(png);
  assert.equal(decoded.width, 768);
  assert.equal(decoded.height, 768);
  const alpha = (x, y) => decoded.rgba[(y * decoded.width + x) * 4 + 3];
  for (let offset = 0; offset < decoded.rgba.length; offset += 4) {
    assert.equal(decoded.rgba[offset], 255);
    assert.equal(decoded.rgba[offset + 1], 255);
    assert.equal(decoded.rgba[offset + 2], 255);
  }
  for (let coordinate = 0; coordinate < 768; coordinate += 1) {
    assert.equal(alpha(coordinate, 0), 0);
    assert.equal(alpha(coordinate, 767), 0);
    assert.equal(alpha(0, coordinate), 0);
    assert.equal(alpha(767, coordinate), 0);
  }
  assert.equal(alpha(383, 383), 255);
  let previous = 255;
  const densities = new Set();
  for (let x = 383; x < 768; x += 1) {
    const next = alpha(x, 383);
    assert.ok(next <= previous);
    assert.ok(previous - next <= 3, "soft falloff has no hard ring or sharply cut beam");
    densities.add(next);
    previous = next;
  }
  assert.ok(densities.size >= 180, "the gradient retains many smooth opacity levels");
  for (let y = 0; y < 768; y += 7) {
    for (let x = 0; x < 768; x += 7) {
      assert.equal(alpha(x, y), alpha(767 - x, y));
      assert.equal(alpha(x, y), alpha(y, x), "radial symmetry rejects colored or directional prism wedges");
      const radius = Math.hypot((x + 0.5 - 384) / 382, (y + 0.5 - 384) / 382);
      assert.equal(alpha(x, y), Math.round(255 * getGachaCapsuleGlowAlpha(radius)));
    }
  }
});

test("optical density decays continuously from the center with no hard texture edge", () => {
  assert.equal(getGachaCapsuleGlowAlpha(0), 1);
  assert.equal(getGachaCapsuleGlowAlpha(1), 0);
  let previous = 1;
  for (let step = 1; step <= 1000; step += 1) {
    const value = getGachaCapsuleGlowAlpha(step / 1000);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= previous);
    previous = value;
  }
  const h = 1e-4;
  assert.ok(Math.abs((getGachaCapsuleGlowAlpha(1) - getGachaCapsuleGlowAlpha(1 - h)) / h) < 1e-3);
  for (const radius of [1.2, Infinity, -Infinity, NaN]) assert.equal(getGachaCapsuleGlowAlpha(radius), 0);
});

test("the seam grows into one soft halo without flashing, rotation or repeated expansion", () => {
  for (const p of [0, 0.16, 0.18, 0.96, 1]) assert.equal(sample(p).opacity, 0);
  assert.ok(sample(0.3).opacity > 0);
  assert.ok(sample(0.6).opacity > sample(0.3).opacity);
  let previous = sample(0);
  let falling = false;
  for (let step = 1; step < 1000; step += 1) {
    const frame = sample(step / 1000);
    assert.ok(Object.values(frame).every(Number.isFinite));
    assert.ok(frame.opacity >= 0 && frame.opacity <= 0.68);
    assert.ok(Math.abs(frame.opacity - previous.opacity) < 0.02);
    assert.ok(frame.scale >= previous.scale && frame.scale <= 1.15);
    assert.ok(frame.verticalScale >= previous.verticalScale && frame.verticalScale <= 1);
    if (frame.opacity < previous.opacity - 1e-8) falling = true;
    if (falling) assert.ok(frame.opacity <= previous.opacity + 1e-8);
    previous = frame;
  }
});

test("Reduced Motion, inactivity and exceptional progress cannot start an autonomous glow", () => {
  for (const p of [0, 0.2, 0.5, 0.8, 1, NaN, Infinity, -1, 2]) assert.equal(sample(p, true).opacity, 0);
  for (const p of [NaN, Infinity, -Infinity, -1, 2]) assert.equal(sample(p).opacity, 0);
  assert.match(component, /opacity: active.value \* glow.opacity/);
  assert.match(component, /if \(reduceMotion \|\| width <= 0 \|\| height <= 0\) return null/);
  assert.doesNotMatch(component, /withRepeat|Math\.random|setTimeout|setInterval|requestAnimationFrame|scheduleOnRN|useState|fetch\(|consumeDrawEntitlement/);
});

test("native halo and final exposure follow the same moving internal source behind the opaque shell", () => {
  assert.equal((component.match(/<Animated.Image\b/g) ?? []).length, 1);
  assert.match(component, /source=\{GLOW_TEXTURE\}/);
  assert.match(component, /gacha-capsule-glow-v1\.png/);
  assert.match(component, /sampleGachaBowlProjection\(progress.value, camera, false\)/);
  assert.match(component, /translateX: source.x - width \/ 2/);
  assert.match(component, /translateY: source.y - height \/ 2/);
  assert.match(component, /scale = glow.scale \* camera.capsuleDiameter \/ Math.max\(1, hero.capsuleDiameter\)/);
  assert.match(component, /scaleY: scale \* glow.verticalScale/);
  assert.match(component, /fadeDuration=\{0\}/);
  assert.match(component, /pointerEvents="none"/);
  assert.doesNotMatch(component, /react-native-svg|useAnimatedProps|animatedProps|ClipPath|matrix:|rotate:|GACHA_PRISM_RAYS/);
  assert.ok(machine.indexOf("<GachaCapsuleGlow") < machine.indexOf("<GachaCapsuleFrames"));
  assert.match(component, /container: \{[^\n]*zIndex: 1/);
  assert.match(machine, /cinematicThree: \{[^\n]*zIndex: 3/);
  assert.match(machine, /cinematicFallback: \{[^\n]*zIndex: 2/);
  assert.doesNotMatch(machine, /GachaPrismLight|gacha-prism-light/);
  const wash = machine.split("const lightWashStyle = useAnimatedStyle")[1]?.split("const heroShadowStyle")[0];
  assert.ok(wash);
  assert.match(wash, /sampleGachaBowlProjection\(revealProgress.value, camera, false\)/);
  assert.match(wash, /translateX: source.x - stageSize.width \/ 2/);
  assert.match(wash, /translateY: source.y - stageSize.height \/ 2/);
  assert.match(wash, /sampleGachaRevealLighting\(revealProgress.value, reduceMotion\)/);
  assert.match(wash, /opacity: revealActive.value \* light.whiteout/);
});
