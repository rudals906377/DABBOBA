/** Fixed material cues follow actual paper travel, including manual drags. */
export function resolveKujiFeedbackStage(progress: number, flight: number) {
  "worklet";
  if (!Number.isFinite(progress) || !Number.isFinite(flight) || progress <= 0.01) return 0;
  if (progress >= 1 && flight >= 0.2) return 4;
  if (progress >= 1 && flight > 0) return 3;
  if (progress >= 0.55) return 2;
  return 1;
}

/** Short recorded fibers follow forward travel instead of playing through a held drag. */
export function resolveKujiPeelGrain(progress: number) {
  "worklet";
  if (!Number.isFinite(progress) || progress <= 0.01) return 0;
  if (progress < 0.55) return Math.ceil(progress / 0.55 * 3);
  return Math.min(6, 4 + Math.floor((progress - 0.55) / 0.45 * 3 + 0.000001));
}
