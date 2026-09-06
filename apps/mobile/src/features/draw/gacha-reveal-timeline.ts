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

export function sampleGachaRevealLighting(progress: number, reduceMotion = false) {
  "worklet";
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
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
