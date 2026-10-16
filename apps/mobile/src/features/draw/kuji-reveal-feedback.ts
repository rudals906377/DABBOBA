/** Fixed material cues follow actual paper travel, including manual drags. */
export function resolveKujiFeedbackStage(progress: number, flight: number) {
  "worklet";
  if (!Number.isFinite(progress) || !Number.isFinite(flight) || progress <= 0.01) return 0;
  if (progress >= 1 && flight > 0) return 3;
  if (progress >= 0.55) return 2;
  return 1;
}
