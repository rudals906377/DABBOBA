type RevealLight = { innerLight: number; opening: number; whiteout: number };

/** Smooth monochrome density, with zero density and slope at the texture edge. */
export function getGachaCapsuleGlowAlpha(radius: number) {
  const r = Math.max(0, Number.isFinite(radius) ? radius : 1);
  if (r >= 1) return 0;
  const t = Math.max(0, Math.min(1, (r - 0.6) / 0.4));
  const edge = 1 - t * t * (3 - 2 * t);
  return Math.exp(-6 * r * r) * edge;
}

/** The seam opens into one strong finite halo; no pulse, rotation or random field. */
export function sampleGachaCapsuleGlow(progress: number, light: RevealLight, reduceMotion = false) {
  "worklet";
  if (reduceMotion || !Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    return { opacity: 0, scale: 0.5, verticalScale: 0.14 };
  }
  const opening = Math.max(0, Math.min(1, light.opening));
  return {
    opacity: Math.max(0, Math.min(1, light.innerLight)) * (1 - Math.max(0, Math.min(1, light.whiteout))) * 0.74,
    scale: 0.5 + opening * 0.82,
    verticalScale: 0.14 + opening * 0.86,
  };
}
