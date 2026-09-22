/** Quiet camera approach and a gently opening seam precede one soft reveal. */
export const GACHA_CLOSEUP_DURATION_MS = 3_000;

/** Kept as a shared compatibility seam; the premium reveal has no rattling. */
export function sampleGachaRevealRattle(progress: number, reduceMotion = false) {
  "worklet";
  void progress;
  void reduceMotion;
  return 0;
}

function smooth(start: number, end: number, value: number) {
  "worklet";
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  // Zero velocity and acceleration at either end avoid a hard catch/release.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function finiteUnit(value: number) {
  "worklet";
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finitePulse(start: number, peak: number, end: number, value: number) {
  "worklet";
  return smooth(start, peak, value) * (1 - smooth(peak, end, value));
}

/** One finite floor response when the capsule settles into the output bay. */
export function sampleGachaDropImpact(progress: number, reduceMotion = false) {
  "worklet";
  if (reduceMotion) {
    return { reflectionOpacity: 0, reflectionScaleX: 1, reflectionScaleY: 1 };
  }
  const p = finiteUnit(progress);
  const impact = finitePulse(0.6, 0.66, 0.84, p);
  return {
    reflectionOpacity: impact * 0.64,
    reflectionScaleX: 0.54 + smooth(0.6, 0.79, p) * 0.92,
    reflectionScaleY: 0.36 + smooth(0.6, 0.72, p) * 0.22,
  };
}

/** Continuous lens-like diffusion replaces graphic rays and rings. */
export function sampleGachaRevealOptics(progress: number, reduceMotion = false) {
  "worklet";
  if (reduceMotion) {
    return {
      innerBloomOpacity: 0,
      innerBloomScale: 1,
      diffusionOpacity: 0,
      diffusionScale: 1,
      lensHazeOpacity: 0,
      lensHazeScale: 1,
    };
  }
  const p = finiteUnit(progress);
  return {
    innerBloomOpacity: smooth(0.14, 0.45, p) * (1 - smooth(0.72, 0.94, p)) * 0.64,
    innerBloomScale: 0.62 + smooth(0.14, 0.82, p) * 0.56,
    diffusionOpacity: smooth(0.28, 0.62, p) * (1 - smooth(0.76, 0.98, p)) * 0.46,
    diffusionScale: 0.64 + smooth(0.28, 0.88, p) * 0.72,
    lensHazeOpacity: smooth(0.44, 0.72, p) * (1 - smooth(0.84, 1, p)) * 0.22,
    lensHazeScale: 0.74 + smooth(0.44, 0.96, p) * 0.64,
  };
}

export function sampleGachaRevealLighting(progress: number, reduceMotion = false) {
  "worklet";
  const p = finiteUnit(progress);
  if (reduceMotion) {
    return { seal: 0, opening: 0, whiteout: 0, prizeOpacity: p >= 1 ? 1 : 0, shellOpacity: 0, innerLight: 0 };
  }
  return {
    seal: smooth(0.16, 0.32, p),
    opening: smooth(0.18, 0.84, p),
    innerLight: smooth(0.18, 0.78, p),
    whiteout: smooth(0.68, 0.96, p),
    prizeOpacity: smooth(0.84, 1, p),
    shellOpacity: 1 - smooth(0.74, 0.90, p),
  };
}
