export type KujiPeelPaperMotion = {
  coverTravelRatio: number;
  coverRotationDeg: number;
  coverOpacity: number;
  foldScaleX: number;
  foldOpacity: number;
  foldShadowOpacity: number;
  edgeLightOpacity: number;
};

function clampProgress(progress: number) {
  "worklet";
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
}

function smootherStep(start: number, end: number, value: number) {
  "worklet";
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Keeps the result ticket fixed while only the cover and its folded paper back
 * travel from left to right. Values mirror the supplied 2.17 s reference clip
 * without coupling the visual motion to a particular prize or server result.
 */
export function sampleKujiPeelPaperMotion(
  progress: number,
  activelyDragging = false,
  reduceMotion = false,
): KujiPeelPaperMotion {
  "worklet";
  const p = clampProgress(progress);
  if (reduceMotion) {
    return {
      coverTravelRatio: p >= 1 ? 1.12 : 0,
      coverRotationDeg: 0,
      coverOpacity: p >= 1 ? 0 : 1,
      foldScaleX: 0,
      foldOpacity: 0,
      foldShadowOpacity: 0,
      edgeLightOpacity: 0,
    };
  }

  const foldIn = Math.max(
    activelyDragging ? 0.2 : 0,
    smootherStep(0, 0.55, p),
  );
  const foldNarrowing = smootherStep(0.84, 1, p);
  const foldExit = smootherStep(0.94, 1, p);
  const edgeIn = smootherStep(0.04, 0.18, p);
  const edgeOut = 1 - smootherStep(0.9, 1, p);
  const edgePresence = Math.max(edgeIn, activelyDragging ? 0.55 : 0);

  return {
    coverTravelRatio: p * 1.12,
    coverRotationDeg: -0.8 * smootherStep(0.52, 1, p),
    coverOpacity: 1 - 0.9 * foldExit,
    foldScaleX: (0.06 + 0.94 * foldIn) * (1 - 0.44 * foldNarrowing),
    foldOpacity: foldIn * (1 - foldExit),
    foldShadowOpacity: 0.3 * foldIn * (1 - foldExit),
    edgeLightOpacity: (activelyDragging ? 0.5 : 0.38) * Math.min(edgePresence, edgeOut),
  };
}
