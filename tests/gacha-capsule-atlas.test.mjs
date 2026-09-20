import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import {
  CAPSULE_3D_FRAGMENT_SHADER,
  CAPSULE_3D_VERTEX_SHADER,
} from "../apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts";
import { GACHA_CLOSEUP_DURATION_MS } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(read("apps/mobile/assets/draw/gacha/gacha-capsule-reveal-atlas-v1.json"));
const atlasPng = read("apps/mobile/assets/draw/gacha/gacha-capsule-reveal-atlas-v1.png");
const wordmarkPng = read("apps/mobile/assets/brand/dabboba-wordmark.png");
const revealTimeline = read("apps/mobile/src/features/draw/gacha-reveal-timeline.ts");
const generator = read("scripts/generate-gacha-capsule-reveal-atlas.ts").toString("utf8");

function decodeRgbaPng(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(png.subarray(0, 8), signature);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "atlas PNG must use 8-bit channels");
      assert.equal(data[9], 6, "atlas PNG must preserve RGBA transparency");
      assert.equal(data[12], 0, "atlas PNG must not be interlaced");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0 && idat.length > 0);
  const filtered = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset++];
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous?.[x] ?? 0;
      const upperLeft = x >= 4 ? previous?.[x - 4] ?? 0 : 0;
      if (filter === 0) row[x] = raw;
      else if (filter === 1) row[x] = (raw + left) & 255;
      else if (filter === 2) row[x] = (raw + up) & 255;
      else if (filter === 3) row[x] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        const predictor = leftDistance <= upDistance && leftDistance <= upperLeftDistance
          ? left
          : upDistance <= upperLeftDistance ? up : upperLeft;
        row[x] = (raw + predictor) & 255;
      } else {
        assert.fail(`unsupported PNG filter ${filter}`);
      }
    }
  }
  return { width, height, rgba };
}

function framePixels(decoded, index) {
  const column = index % manifest.columns;
  const row = Math.floor(index / manifest.columns);
  const output = Buffer.alloc(manifest.frameWidth * manifest.frameHeight * 4);
  for (let y = 0; y < manifest.frameHeight; y += 1) {
    const sourceStart = (
      (row * manifest.frameHeight + y) * decoded.width
      + column * manifest.frameWidth
    ) * 4;
    decoded.rgba.copy(
      output,
      y * manifest.frameWidth * 4,
      sourceStart,
      sourceStart + manifest.frameWidth * 4,
    );
  }
  return output;
}

test("capsule atlas stays within the native texture and decoded-memory budgets", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "analytical-capsule-reveal");
  assert.equal(manifest.tone, "lime");
  assert.equal(manifest.frameWidth, 192);
  assert.equal(manifest.frameHeight, 256);
  assert.equal(manifest.columns, 8);
  assert.equal(manifest.rows, 10);
  assert.equal(manifest.frameCount, 80);
  assert.equal(manifest.atlasWidth, manifest.frameWidth * manifest.columns);
  assert.equal(manifest.atlasHeight, manifest.frameHeight * manifest.rows);
  assert.ok(manifest.atlasWidth <= 4096 && manifest.atlasHeight <= 4096);
  assert.equal(manifest.decodedBytes, manifest.atlasWidth * manifest.atlasHeight * 4);
  assert.ok(manifest.decodedBytes <= 16 * 1024 * 1024);
});

test("atlas sampling stays below a 36ms pose interval during the three-second close-up", () => {
  assert.equal(GACHA_CLOSEUP_DURATION_MS, 3000);
  const averageIntervalMs = (manifest.revealProgressMax - manifest.revealProgressMin)
    * GACHA_CLOSEUP_DURATION_MS / (manifest.frameCount - 1);
  assert.ok(averageIntervalMs <= 36, `average atlas pose interval is ${averageIntervalMs}ms`);
  for (let index = 1; index < manifest.frameProgress.length; index += 1) {
    const intervalMs = (manifest.frameProgress[index] - manifest.frameProgress[index - 1])
      * GACHA_CLOSEUP_DURATION_MS;
    assert.ok(intervalMs > 0 && intervalMs <= 36, `pose interval ${index} is ${intervalMs}ms`);
  }
});

test("atlas manifest provides a complete monotonic closed-to-reveal lookup", () => {
  assert.equal(manifest.closedFrameIndex, 0);
  assert.equal(manifest.revealProgressMin, 0);
  assert.equal(manifest.revealProgressMax, 0.92);
  assert.equal(manifest.frameProgress.length, manifest.frameCount);
  assert.equal(manifest.frameProgress[0], manifest.revealProgressMin);
  assert.equal(manifest.frameProgress.at(-1), manifest.revealProgressMax);
  for (let index = 1; index < manifest.frameProgress.length; index += 1) {
    assert.ok(manifest.frameProgress[index] > manifest.frameProgress[index - 1]);
  }
  assert.deepEqual(manifest.projection, {
    centerX: 0.5,
    centerY: 0.5,
    diameter: 130,
    viewWidth: 192,
  });
});

test("atlas records the exact analytical shader, reveal timeline, and canonical wordmark", () => {
  assert.equal(manifest.hashes.atlasSha256, sha256(atlasPng));
  assert.equal(manifest.hashes.wordmarkSha256, sha256(wordmarkPng));
  assert.equal(manifest.hashes.vertexShaderSha256, sha256(CAPSULE_3D_VERTEX_SHADER));
  assert.equal(manifest.hashes.fragmentShaderSha256, sha256(CAPSULE_3D_FRAGMENT_SHADER));
  assert.equal(manifest.hashes.revealTimelineSha256, sha256(revealTimeline));
  assert.deepEqual(
    wordmarkPng,
    read("public/assets/dabboba/brand/dabboba-wordmark.png"),
  );
  assert.match(generator, /CAPSULE_3D_FRAGMENT_SHADER/);
  assert.match(generator, /sampleGachaRevealLighting/);
  assert.match(generator, /apps\/mobile\/assets\/brand\/dabboba-wordmark\.png/);
  assert.doesNotMatch(generator, /fillText|strokeText|Math\.random/);
});

test("offline generator blocks network and bakes visible analytical frames to transparent", () => {
  assert.match(generator, /offline:\s*true/);
  assert.match(generator, /context\.route\("\*\*\/\*", \(route\) => route\.abort\("blockedbyclient"\)\)/);
  assert.match(generator, /--use-angle=swiftshader/);
  const decoded = decodeRgbaPng(atlasPng);
  assert.equal(decoded.width, manifest.atlasWidth);
  assert.equal(decoded.height, manifest.atlasHeight);
  const frames = Array.from({ length: manifest.frameCount }, (_, index) => framePixels(decoded, index));
  const visibleAlpha = (frame) => {
    let count = 0;
    for (let offset = 3; offset < frame.length; offset += 4) {
      if (frame[offset] > 0) count += 1;
    }
    return count;
  };
  assert.ok(visibleAlpha(frames[0]) > 5000, "closed capsule frame must be visible");
  assert.ok(visibleAlpha(frames[Math.floor(manifest.frameCount * 0.65)]) > 5000);
  assert.equal(visibleAlpha(frames.at(-1)), 0, "last shell frame must hand off transparently");
  assert.ok(new Set(frames.map(sha256)).size >= 30, "reveal must contain meaningful finite motion");
});

test("every atlas tile keeps a fully transparent border without a rectangular baked floor", () => {
  const decoded = decodeRgbaPng(atlasPng);
  const assertTransparentBorder = (frame, frameIndex) => {
    const pixelAlpha = (x, y) => frame[(y * manifest.frameWidth + x) * 4 + 3];
    for (let x = 0; x < manifest.frameWidth; x += 1) {
      assert.equal(
        pixelAlpha(x, 0), 0,
        `frame ${frameIndex} has visible pixels touching the top edge`,
      );
      assert.equal(
        pixelAlpha(x, manifest.frameHeight - 1), 0,
        `frame ${frameIndex} has visible pixels touching the bottom edge`,
      );
    }
    for (let y = 0; y < manifest.frameHeight; y += 1) {
      assert.equal(
        pixelAlpha(0, y), 0,
        `frame ${frameIndex} has visible pixels touching the left edge`,
      );
      assert.equal(
        pixelAlpha(manifest.frameWidth - 1, y), 0,
        `frame ${frameIndex} has visible pixels touching the right edge`,
      );
    }
  };

  manifest.frameProgress.forEach((_, index) => {
    assertTransparentBorder(framePixels(decoded, index), index);
  });
});

test("the production atlas holds perfectly still before the seal opens", () => {
  const decoded = decodeRgbaPng(atlasPng);
  const closed = framePixels(decoded, 0);
  // The physical shell stays still before the seal begins to open.
  // This fails against the former five-rattle atlas even if the live clock is calm.
  const earlyFrames = manifest.frameProgress
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p > 0.05 && p < 0.13)
    .map(({ index }) => framePixels(decoded, index));
  assert.ok(earlyFrames.length >= 5);
  assert.equal(new Set(earlyFrames.map(sha256)).size, 1);
  assert.ok(earlyFrames.every((frame) => frame.equals(closed)));
  assert.match(generator, /gl.uniform1f\(uniforms.rattle, frame.rattle\)/);
  assert.match(generator, /rattle: sampleGachaRevealRattle\(progress\)/);
});

test("supersampled closed sphere has a smooth antialiased contour without enlarging the native texture", () => {
  assert.equal(manifest.generator.supersample, 2);
  const decoded = decodeRgbaPng(atlasPng);
  const frame = framePixels(decoded, 0);
  let antialiased = 0;
  const solid = [];
  for (let y = 0; y < manifest.frameHeight; y += 1) {
    for (let x = 0; x < manifest.frameWidth; x += 1) {
      const alpha = frame[(y * manifest.frameWidth + x) * 4 + 3];
      if (alpha > 0 && alpha < 255) antialiased += 1;
      if (alpha >= 128) solid.push({ x, y });
    }
  }
  assert.ok(antialiased >= 80, "the 2× offline render must produce genuine smooth coverage at the silhouette");
  const width = Math.max(...solid.map((point) => point.x)) - Math.min(...solid.map((point) => point.x)) + 1;
  const height = Math.max(...solid.map((point) => point.y)) - Math.min(...solid.map((point) => point.y)) + 1;
  assert.ok(Math.abs(width - height) <= 2, "the closed silhouette must remain round");
  assert.ok(Math.abs(width - manifest.projection.diameter) <= 2);
  assert.equal(manifest.frameWidth, 192);
  assert.equal(manifest.frameHeight, 256);
  assert.equal(decoded.width * decoded.height * 4, 15 * 1024 * 1024);
});
