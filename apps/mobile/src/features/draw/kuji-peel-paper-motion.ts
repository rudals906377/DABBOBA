export type KujiPeelPaperMotion = {
  peelBoundaryRatio: number;
  foldScaleX: number;
  foldOpacity: number;
  foldShadowOpacity: number;
  edgeLightOpacity: number;
  foldRotateYDeg: number;
  foldLiftRatio: number;
  foldSkewYDeg: number;
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
 * The flat printed cover stays registered to the ticket. Only its clipping
 * boundary and curled paper back advance from left to right.
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
      peelBoundaryRatio: p >= 1 ? 1 : 0,
      foldScaleX: 0,
      foldOpacity: 0,
      foldShadowOpacity: 0,
      edgeLightOpacity: 0,
      foldRotateYDeg: 0,
      foldLiftRatio: 0,
      foldSkewYDeg: 0,
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
  const bend = Math.sin(Math.PI * p);

  return {
    peelBoundaryRatio: p,
    foldScaleX: (0.06 + 0.94 * foldIn) * (1 - 0.44 * foldNarrowing),
    foldOpacity: foldIn * (1 - foldExit),
    foldShadowOpacity: 0.3 * foldIn * (1 - foldExit),
    edgeLightOpacity: (activelyDragging ? 0.5 : 0.38) * Math.min(edgePresence, edgeOut),
    foldRotateYDeg: -12 - 24 * bend,
    foldLiftRatio: 0.025 * bend,
    foldSkewYDeg: -3.8 * bend,
  };
}
