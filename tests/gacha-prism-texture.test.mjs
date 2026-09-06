import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { GACHA_PRISM_RAYS, GACHA_PRISM_BEAM_LAYERS } from "../apps/mobile/src/features/draw/gacha-prism-light.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(read("apps/mobile/assets/gacha-prism-light-v1.json"));
const png = read("apps/mobile/assets/gacha-prism-light-v1.png");
const generator = read("scripts/generate-gacha-prism-texture.ts");

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

test("prism texture is a bounded 768px static fan centered on its emission point", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "static-capsule-prism-light");
  assert.equal(manifest.width, 768);
  assert.equal(manifest.height, 768);
  assert.deepEqual(manifest.origin, { x: 0.5, y: 0.5 });
  assert.equal(manifest.reachRatio, 1 / 2.4);
  assert.equal(manifest.reach, 320);
  assert.equal(manifest.decodedBytes, 768 * 768 * 4);
  assert.ok(manifest.decodedBytes <= 4 * 1024 * 1024);
  assert.ok(manifest.coreRadius > 40 && manifest.coreRadius < 45);
  assert.equal(manifest.rayCount, 12);
  assert.equal(manifest.featherBandCount, 5);
  assert.equal(manifest.rayCount, GACHA_PRISM_RAYS.length);
  assert.equal(manifest.featherBandCount, GACHA_PRISM_BEAM_LAYERS.length);
});

test("prism texture is reproducibly linked to the approved ray palette and offline generator", () => {
  assert.equal(manifest.hashes.textureSha256, sha256(png));
  assert.equal(manifest.hashes.prismSourceSha256, sha256(read("apps/mobile/src/features/draw/gacha-prism-light.ts")));
  assert.equal(manifest.hashes.generatorSha256, sha256(generator));
  const source = generator.toString("utf8");
  assert.match(source, /offline:\s*true/);
  assert.match(source, /context\.route\("\*\*\/\*", \(route\) => route\.abort\("blockedbyclient"\)\)/);
  assert.match(source, /omitBackground:\s*true/);
  assert.match(source, /GACHA_PRISM_RAYS\.map/);
  assert.match(source, /GACHA_PRISM_BEAM_LAYERS\.map/);
  assert.doesNotMatch(source, /Math\.random|https:\/\//);
});

test("prism texture retains fully transparent edges and a bright interior source", () => {
  const { width, height, rgba } = decodePng(png);
  assert.equal(width, manifest.width);
  assert.equal(height, manifest.height);
  const channel = (x, y, offset = 3) => rgba[(y * width + x) * 4 + offset];
  for (let x = 0; x < width; x += 1) {
    assert.equal(channel(x, 0), 0);
    assert.equal(channel(x, height - 1), 0);
  }
  for (let y = 0; y < height; y += 1) {
    assert.equal(channel(0, y), 0);
    assert.equal(channel(width - 1, y), 0);
  }
  const center = width / 2;
  assert.ok(channel(center, center) >= 245, "center must retain the white-hot source");
  assert.ok(channel(center, center, 0) >= 240);
  assert.ok(channel(center, center, 1) >= 245);
  let nonZero = 0;
  let translucent = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] > 0) nonZero += 1;
    if (rgba[offset] > 0 && rgba[offset] < 240) translucent += 1;
  }
  assert.ok(nonZero > 30000, "the fan must extend far beyond its tiny core");
  assert.ok(translucent > nonZero * 0.9, "ray edges should stay softly transparent");
});
