const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const imageRequire = createRequire(path.join(root, "apps/api/package.json"));
const sharp = imageRequire("sharp");
const sources = path.join(root, "design-assets/app-icons");
const destination = path.join(root, "apps/mobile/assets/icons");

async function main() {
  const approved = path.join(sources, "dabboba-wordmark-capsule-horizontal-final-source.png");
  const approvedInfo = await sharp(approved).metadata();
  if (approvedInfo.width !== 1254 || approvedInfo.height !== 1254) {
    throw new Error("Approved launcher source must remain 1254x1254.");
  }
  await sharp(approved).resize(256, 256).removeAlpha().png().toFile(path.join(sources, "dabboba-developer-icon-256.png"));
  await sharp(approved).resize(1024, 1024).removeAlpha().png().toFile(path.join(destination, "app-icon.png"));

  const adaptive = path.join(sources, "dabboba-horizontal-adaptive-source.png");
  const adaptiveInfo = await sharp(adaptive).metadata();
  if (adaptiveInfo.width !== 1254 || adaptiveInfo.height !== 1254) {
    throw new Error("Saved adaptive source must remain 1254x1254.");
  }
  // Crop only transparent exterior residue from the saved approved cutout.
  const wordmark = await sharp(adaptive).extract({ left: 220, top: 550, width: 825, height: 185 }).resize({ width: 620 }).png().toBuffer({ resolveWithObject: true });
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: wordmark.data, left: Math.floor((1024 - wordmark.info.width) / 2), top: Math.floor((1024 - wordmark.info.height) / 2) }])
    .png().toFile(path.join(destination, "adaptive-icon-foreground.png"));
  console.log("Prepared approved horizontal launcher and opaque developer-console assets.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
