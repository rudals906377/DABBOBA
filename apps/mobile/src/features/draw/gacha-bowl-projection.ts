import { sampleGachaCapsuleAtlasFrame } from "./gacha-capsule-frames-motion";
import { sampleGachaRevealLighting, sampleGachaRevealRattle } from "./gacha-reveal-timeline";

type Vector3 = [number, number, number];
type CapsuleCamera = { capsuleX: number; capsuleY: number; capsuleDiameter: number };
type CapsuleAtlas = Parameters<typeof sampleGachaCapsuleAtlasFrame>[1] & {
  frameProgress: number[];
  projection: { diameter: number };
};

const ATLAS = require("../../../assets/draw/gacha/gacha-capsule-reveal-atlas-v1.json") as CapsuleAtlas;
const FIXED_DISTANCE = Math.sqrt((2.7 / (ATLAS.projection.diameter / ATLAS.frameWidth)) ** 2 + 1);
const PROJECTION_SCALE = 2.7 * ATLAS.frameWidth / 2 / ATLAS.projection.diameter;
const RIM_RADIUS = 0.84; // Conservative optional clip inside the .98 inner seam; native light only projects the emitter.
const RIM_POINTS = 24;

function rotateX([x, y, z]: Vector3, angle: number): Vector3 {
  "worklet";
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, c * y - s * z, s * y + c * z];
}

function rotateY([x, y, z]: Vector3, angle: number): Vector3 {
  "worklet";
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x + s * z, y, -s * x + c * z];
}

function rotateZ([x, y, z]: Vector3, angle: number): Vector3 {
  "worklet";
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x - s * y, s * x + c * y, z];
}

/** Exact shader order: fixed body Rz * Ry * Rx, then restrained opening Rx. */
function rotateLower(point: Vector3, opening: number, rattle: number): Vector3 {
  "worklet";
  return rotateZ(
    rotateY(
      rotateX(rotateX(point, opening * 0.18), -0.065),
      -0.10,
    ),
    -0.075 + rattle,
  );
}

/**
 * The light is fixed inside the rendered lower bowl, not at the screen center.
 * Pose follows the exact baked tile; only its stage translation/scale stay live.
 * rimPath uses stage-point offsets relative to the returned emitter x/y, ready
 * for a foreground SVG clip without painting over the near lip or wordmark.
 */
export function sampleGachaBowlProjection(progress: number, camera: CapsuleCamera, includeRim = true) {
  "worklet";
  const { index } = sampleGachaCapsuleAtlasFrame(progress, ATLAS);
  const poseProgress = ATLAS.frameProgress[index] ?? ATLAS.revealProgressMin;
  const { opening, seal } = sampleGachaRevealLighting(poseProgress);
  const rattle = sampleGachaRevealRattle(poseProgress);
  const center: Vector3 = [0, -seal * 0.035 - opening * 0.42, 0];
  const emitter = rotateLower([0, -0.08, 0], opening, rattle);
  const emitterX = center[0] + emitter[0];
  const emitterY = center[1] + emitter[1];
  const emitterZ = center[2] + emitter[2];
  const projectionScale = camera.capsuleDiameter * PROJECTION_SCALE;
  const unitScale = projectionScale / (FIXED_DISTANCE - emitterZ);
  const offsetX = emitterX * unitScale;
  const offsetY = -emitterY * unitScale;
  // Native optical texture needs only the apex; the baked shell owns mouth occlusion.
  if (!includeRim) return { x: camera.capsuleX + offsetX, y: camera.capsuleY + offsetY, unitScale, rimPath: "" };

  // Rotate the rim plane's basis once, then project its bounded 24-point edge.
  const rimX = rotateLower([1, 0, 0], opening, rattle);
  const rimZ = rotateLower([0, 0, 1], opening, rattle);
  let rimPath = "";
  for (let point = 0; point < RIM_POINTS; point += 1) {
    const angle = point * Math.PI * 2 / RIM_POINTS;
    const localX = RIM_RADIUS * Math.cos(angle);
    const localZ = RIM_RADIUS * Math.sin(angle);
    const worldX = center[0] + rimX[0] * localX + rimZ[0] * localZ;
    const worldY = center[1] + rimX[1] * localX + rimZ[1] * localZ;
    const worldZ = center[2] + rimX[2] * localX + rimZ[2] * localZ;
    const pointScale = projectionScale / (FIXED_DISTANCE - worldZ);
    const x = worldX * pointScale - offsetX;
    const y = -worldY * pointScale - offsetY;
    rimPath += `${point === 0 ? "M" : " L"} ${x} ${y}`;
  }
  return { x: camera.capsuleX + offsetX, y: camera.capsuleY + offsetY, unitScale, rimPath: `${rimPath} Z` };
}
