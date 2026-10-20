export type KujiPeelPaperMotion = {
  peelBoundaryRatio: number;
  foldScaleX: number;
  foldOpacity: number;
  foldShadowOpacity: number;
  edgeLightOpacity: number;
  foldRotateYDeg: number;
  foldLiftRatio: number;
  foldSkewYDeg: number;
  foldFlightXRatio: number;
  foldFlightYRatio: number;
  foldRotateZDeg: number;
  coverClipInsetRatio: number;
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
  flightProgress = 0,
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
      foldFlightXRatio: 0,
      foldFlightYRatio: 0,
      foldRotateZDeg: 0,
      coverClipInsetRatio: 0,
    };
  }

  // A detached curl continues from the exact edge pose on its own UI-thread clock.
  const flight = p >= 1 ? clampProgress(flightProgress) : 0;
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
  const flutter = Math.sin(2 * Math.PI * flight) * Math.exp(-3.2 * flight);
  // A soft release envelope starts with zero extra velocity at the seam.
  // The rolled paper tightens, springs back, then loses its small torsion to air drag.
  const releaseFlex = Math.sin(4 * Math.PI * flight) * Math.exp(-4.5 * flight)
    * (1 - Math.exp(-18 * flight));
  const foldScaleX = (0.06 + 0.94 * foldIn) * (1 - 0.32 * foldNarrowing)
    * (1 + 0.12 * Math.sin(Math.PI * flight) * Math.exp(-1.5 * flight) - 0.13 * releaseFlex);

  return {
    peelBoundaryRatio: p,
    // Keep a substantial, opaque curl at the edge, then carry that same paper away.
    foldScaleX,
    foldOpacity: (p > 0 || activelyDragging) && flight < 1 ? 1 : 0,
    foldShadowOpacity: 0.3 * foldIn * (1 - foldExit),
    edgeLightOpacity: (activelyDragging ? 0.5 : 0.38) * Math.min(edgePresence, edgeOut),
    foldRotateYDeg: -12 - 24 * bend + 18 * flight + 5 * flutter + 8 * releaseFlex,
    foldLiftRatio: 0.025 * bend,
    foldSkewYDeg: -3.8 * bend + 3 * releaseFlex,
    // Linear time drives a release impulse, gentle air drag and gravity.
    foldFlightXRatio: flight * (1 + 0.15 * (1 - flight)),
    foldFlightYRatio: -0.85 * flight + 1.65 * flight * flight,
    foldRotateZDeg: 56 * (1 - Math.exp(-3 * flight)) + 8 * flutter - 4 * releaseFlex,
    // The SVG's left contour bows inward. Hide the flat cover underneath the
    // solid curl center so that contour/projection cannot expose a printed sliver.
    coverClipInsetRatio: 0.42 * foldScaleX * Math.min(1, foldIn * 5),
  };
}
