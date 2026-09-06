import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { getGachaCapsuleGlowAlpha } from "../apps/mobile/src/features/draw/gacha-capsule-glow.ts";

// Offline, dependency-free RGBA texture: no downloaded/generated art or secrets.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const size = 768;
const pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const radius = Math.hypot((x + 0.5 - size / 2) / (size / 2 - 2), (y + 0.5 - size / 2) / (size / 2 - 2));
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(255 * getGachaCapsuleGlowAlpha(radius));
  }
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4);
  const body = Buffer.concat([header.subarray(4), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, data, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]);
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schemaVersion: 1, kind: "soft-monochrome-capsule-glow", width: size, height: size,
  decodedBytes: size * size * 4,
  textureSha256: hash(png),
  sourceSha256: hash(await readFile(resolve(root, "apps/mobile/src/features/draw/gacha-capsule-glow.ts"))),
};
await writeFile(resolve(root, "apps/mobile/assets/gacha-capsule-glow-v1.png"), png);
await writeFile(resolve(root, "apps/mobile/assets/gacha-capsule-glow-v1.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
