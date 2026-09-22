/** All pickup positions use the unscaled 190 x 338 machine artwork. */
export const GACHA_PICKUP_GEOMETRY = {
  left: 109,
  top: 239,
  width: 24,
  height: 29,
  capsuleSize: 18,
  restLeft: 3,
  restTop: 9,
  machineWidth: 190,
  machineHeight: 338,
} as const;

export const GACHA_CAPSULE_DISPENSE_DURATION_MS = 1_700;

/**
 * Fit the actual cabinet, not the transparent 190 x 338 image canvas. Its alpha
 * bounds are x34..156, y42..294. The wider 160-point invisible lever target must
 * also fit, including breathing room. Share this scale with every projection.
 */
export function resolveGachaMachineScale(width: number, height: number) {
  "worklet";
  const w = Number.isFinite(width) && width > 0 ? width : 340;
  const h = Number.isFinite(height) && height > 0 ? height : 624;
  return Math.min(2.6, w / 168, h / 276);
}

function unit(value: number) {
  "worklet";
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function ease(start: number, end: number, value: number) {
  "worklet";
  const p = unit((value - start) / (end - start));
  return p * p * (3 - 2 * p);
}

function bounce(progress: number, start: number, end: number, height: number) {
  "worklet";
  const t = unit((progress - start) / (end - start));
  return 4 * height * t * (1 - t);
}

/** Gravity-driven fall, diminishing impacts and a fully still landing beat. */
export function sampleGachaPickupMotion(progress: number, reduceMotion: boolean) {
  "worklet";
  const p = unit(progress);
  if (reduceMotion) return { x: 0, y: 0, rotation: 0, opacity: p >= 1 ? 1 : 0, shadowOpacity: 0 };
  const fall = unit((p - 0.48) / 0.17);
  const y = p < 0.65
    ? -28 * (1 - fall * fall)
    : -bounce(p, 0.65, 0.75, 4.2) - bounce(p, 0.75, 0.83, 1.7) - bounce(p, 0.83, 0.88, 0.5);
  const x = -2 + 4 * ease(0.52, 0.65, p) - 3.2 * ease(0.65, 0.75, p)
    + 1.8 * ease(0.75, 0.83, p) - 0.6 * ease(0.83, 0.9, p);
  const rotation = -20 + 34 * ease(0.48, 0.65, p) - 22 * ease(0.65, 0.75, p)
    + 11 * ease(0.75, 0.83, p) - 3 * ease(0.83, 0.9, p);
  return {
    x: p >= 0.9 ? 0 : x,
    y: p >= 0.9 ? 0 : y,
    rotation: p >= 0.9 ? 0 : rotation,
    opacity: ease(0.48, 0.53, p),
    shadowOpacity: ease(0.54, 0.65, p) * (0.48 + 0.2 * (1 - unit(-y / 7))),
  };
}

/**
 * A single camera moves the whole scene. The capsule has a fixed world position
 * on the pickup floor; native scenery, sprite fallback and GL use this projection.
 */
export function sampleGachaCameraMotion(progress: number, width: number, height: number, reduceMotion = false) {
  "worklet";
  const p = reduceMotion ? 0 : unit(progress);
  const w = Number.isFinite(width) && width > 0 ? width : 340;
  const h = Number.isFinite(height) && height > 0 ? height : 624;
  const box = GACHA_PICKUP_GEOMETRY;
  const presentationScale = resolveGachaMachineScale(w, h);
  const fixedX = (box.left + box.restLeft + box.capsuleSize / 2 - box.machineWidth / 2) * presentationScale;
  const fixedY = (box.top + box.restTop + box.capsuleSize / 2 - box.machineHeight / 2) * presentationScale;
  const baseDiameter = box.capsuleSize * presentationScale;
  const finalDiameter = Math.max(baseDiameter, Math.min(w * 0.76, h * 0.53));
  const zoom = ease(0.04, 0.46, p);
  const pan = ease(0.015, 0.25, p);
  const scale = Math.exp(Math.log(finalDiameter / baseDiameter) * zoom);
  const translateX = -fixedX * (scale - 1 + pan);
  const translateY = -fixedY * (scale - 1 + pan);
  return {
    presentationScale,
    scale,
    translateX,
    translateY,
    capsuleX: w / 2 + fixedX * scale + translateX,
    capsuleY: h / 2 + fixedY * scale + translateY,
    capsuleDiameter: baseDiameter * scale,
    machineOpacity: 1 - ease(0.26, 0.40, p),
    // Hand off to the matching 3D shell while it is still small and resting in
    // the bay, before zoom starts. Never crossfade two large shell silhouettes.
    overlayOpacity: ease(0.001, 0.03, p),
  };
}
