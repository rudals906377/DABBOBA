type CapsuleAtlasLayout = {
  frameCount: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  closedFrameIndex: number;
  revealProgressMin: number;
  revealProgressMax: number;
};

/** Deterministic tile selection; the existing reveal clock owns all timing. */
export function sampleGachaCapsuleAtlasFrame(
  progress: number,
  atlas: CapsuleAtlasLayout,
  reduceMotion = false,
) {
  "worklet";
  const p = Number.isFinite(progress) ? progress : 0;
  const normalized = Math.max(0, Math.min(1,
    (p - atlas.revealProgressMin) / Math.max(0.000001, atlas.revealProgressMax - atlas.revealProgressMin),
  ));
  const index = reduceMotion
    ? atlas.closedFrameIndex
    : Math.round(normalized * (atlas.frameCount - 1));
  return {
    index,
    translateX: -(index % atlas.columns) * atlas.frameWidth,
    translateY: -Math.floor(index / atlas.columns) * atlas.frameHeight,
  };
}
