/** Fixed optical rays, not random confetti or a repeating spotlight animation. */
export const GACHA_PRISM_RAYS = [
  { angle: -98, spread: 7, strength: 0.25, color: "#DEFCE1" },
  { angle: -78, spread: 14, strength: 0.72, color: "#C7FFDA" },
  { angle: -51, spread: 9, strength: 0.88, color: "#D5F7FF" },
  { angle: -36, spread: 8, strength: 0.76, color: "#DCFFE5" },
  { angle: -23, spread: 9, strength: 0.9, color: "#ECFFD9" },
  { angle: -7, spread: 8, strength: 1, color: "#F5FFD9" },
  { angle: 15, spread: 12, strength: 0.90, color: "#DAFFF7" },
  { angle: 28, spread: 7, strength: 0.75, color: "#D7FFF0" },
  { angle: 39, spread: 8, strength: 0.82, color: "#E0E8FF" },
  { angle: 64, spread: 14, strength: 0.78, color: "#C6FFD8" },
  { angle: 93, spread: 8, strength: 0.58, color: "#F6FFE1" },
  { angle: 104, spread: 6, strength: 0.18, color: "#CFF8EE" },
] as const;

/** Bounded soft-edge bands replace the former hard wedge and laser-like spine. */
export const GACHA_PRISM_BEAM_LAYERS = [
  { width: 1.55, opacity: 0.025 },
  { width: 1.28, opacity: 0.05 },
  { width: 1.06, opacity: 0.09 },
  { width: 0.88, opacity: 0.14 },
  { width: 0.65, opacity: 0.18 },
] as const;

type RevealLight = { innerLight: number; opening: number; whiteout: number };

function ease(start: number, end: number, value: number) {
  "worklet";
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** One expanding release, driven by the same clock and light as the hollow shell. */
export function sampleGachaPrismLight(progress: number, light: RevealLight, reduceMotion = false) {
  "worklet";
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (reduceMotion || p <= 0 || p >= 1) return { opacity: 0, scale: 0.12 };
  const exposure = Math.max(0, Math.min(1, light.innerLight))
    * ease(0.02, 0.25, light.opening)
    * (1 - Math.max(0, Math.min(1, light.whiteout)));
  return {
    opacity: exposure,
    scale: 0.12 + ease(0, 0.72, light.opening) * 0.98,
  };
}

/** A small approaching capsule must not cast a full-screen fan prematurely. */
export function sampleGachaPrismBeamScale(burstScale: number, diameter: number, heroDiameter: number) {
  "worklet";
  if (![burstScale, diameter, heroDiameter].every(Number.isFinite) || heroDiameter <= 0) return 0;
  return Math.max(0, burstScale) * Math.max(0, Math.min(1, diameter / heroDiameter));
}
