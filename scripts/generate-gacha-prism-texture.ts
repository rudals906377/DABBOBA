import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  GACHA_PRISM_BEAM_LAYERS,
  GACHA_PRISM_RAYS,
} from "../apps/mobile/src/features/draw/gacha-prism-light.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = resolve(ROOT, "apps/mobile/src/features/draw/gacha-prism-light.ts");
const ASSET_PATH = resolve(ROOT, "apps/mobile/assets/gacha-prism-light-v1.png");
const MANIFEST_PATH = resolve(ROOT, "apps/mobile/assets/gacha-prism-light-v1.json");
const SIZE = 768;
const REACH_RATIO = 1 / 2.4;
const REACH = SIZE * REACH_RATIO;
const DECODED_BYTES = SIZE * SIZE * 4;
const MAX_DECODED_BYTES = 4 * 1024 * 1024;
// Preserve the former SVG core-to-fan proportion at the existing 340x624 stage.
const REFERENCE_STAGE = { width: 340, height: 624 };
const CORE_RADIUS = REACH * (Math.min(REFERENCE_STAGE.width, REFERENCE_STAGE.height) * 0.23)
  / (Math.hypot(REFERENCE_STAGE.width, REFERENCE_STAGE.height) * 0.82);

if (DECODED_BYTES > MAX_DECODED_BYTES) throw new Error("Prism texture exceeds 4MiB decoded budget");
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceBytes = await readFile(SOURCE_PATH);
const generatorBytes = await readFile(fileURLToPath(import.meta.url));
const gradients = GACHA_PRISM_RAYS.map((ray, index) => `
  <linearGradient id="ray-${index}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${-REACH}">
    <stop offset="0" stop-color="#FFFFF4" stop-opacity="1"/>
    <stop offset="0.12" stop-color="#F4FFEF" stop-opacity="0.96"/>
    <stop offset="0.32" stop-color="${ray.color}" stop-opacity="0.8"/>
    <stop offset="0.68" stop-color="${ray.color}" stop-opacity="0.26"/>
    <stop offset="1" stop-color="${ray.color}" stop-opacity="0"/>
  </linearGradient>`).join("");
const rays = GACHA_PRISM_RAYS.map((ray, index) => {
  const halfWidth = Math.tan(ray.spread * Math.PI / 360) * REACH;
  return `<g transform="rotate(${ray.angle})">${GACHA_PRISM_BEAM_LAYERS.map((layer) => (
    `<path d="M 0 0 L ${-halfWidth * layer.width} ${-REACH} L ${halfWidth * layer.width} ${-REACH} Z" fill="url(#ray-${index})" opacity="${ray.strength * layer.opacity}"/>`
  )).join("")}</g>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}">
  <defs>${gradients}
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FFFFF8" stop-opacity="1"/>
      <stop offset="0.26" stop-color="#F6FFD8" stop-opacity="0.95"/>
      <stop offset="0.58" stop-color="#CFFFE1" stop-opacity="0.36"/>
      <stop offset="1" stop-color="#CFFFE1" stop-opacity="0"/>
    </radialGradient>
  </defs>${rays}<circle cx="0" cy="0" r="${CORE_RADIUS}" fill="url(#core)"/>
</svg>`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--disable-sync", "--host-resolver-rules=MAP * 0.0.0.0", "--metrics-recording-only",
    "--no-first-run",
  ],
});
let texture: Buffer;
let browserVersion: string;
try {
  browserVersion = browser.version();
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    offline: true,
    serviceWorkers: "block",
    viewport: { width: SIZE, height: SIZE },
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  texture = await page.screenshot({ omitBackground: true, type: "png" });
  await context.close();
} finally {
  await browser.close();
}

const require = createRequire(import.meta.url);
const manifest = {
  schemaVersion: 1,
  kind: "static-capsule-prism-light",
  assetFile: "gacha-prism-light-v1.png",
  width: SIZE,
  height: SIZE,
  origin: { x: 0.5, y: 0.5 },
  reachRatio: REACH_RATIO,
  reach: REACH,
  coreRadius: CORE_RADIUS,
  coreReferenceStage: REFERENCE_STAGE,
  rayCount: GACHA_PRISM_RAYS.length,
  featherBandCount: GACHA_PRISM_BEAM_LAYERS.length,
  decodedBytes: DECODED_BYTES,
  generator: {
    playwrightVersion: (require("playwright/package.json") as { version: string }).version,
    browserVersion,
    method: "offline SVG rasterization; static source only",
  },
  hashes: {
    textureSha256: sha256(texture),
    prismSourceSha256: sha256(sourceBytes),
    generatorSha256: sha256(generatorBytes),
  },
};
async function writeIfChanged(path: string, contents: string | Uint8Array) {
  const next = Buffer.from(contents);
  const existing = await readFile(path).catch(() => null);
  if (!existing?.equals(next)) await writeFile(path, next);
}
await Promise.all([
  writeIfChanged(ASSET_PATH, texture),
  writeIfChanged(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`),
]);
console.log(JSON.stringify({ asset: ASSET_PATH, width: SIZE, height: SIZE, bytes: texture.length, decodedBytes: DECODED_BYTES, sha256: manifest.hashes.textureSha256 }, null, 2));
