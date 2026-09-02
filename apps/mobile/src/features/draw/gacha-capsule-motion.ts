export const GACHA_CHAMBER_WIDTH = 98;
export const GACHA_CHAMBER_HEIGHT = 96;

export type GachaCapsuleTone = "lime" | "ivory";
export type GachaMechanicalRow = "upper" | "middle" | "lower";

export type GachaChamberCapsuleConfig = {
  id: string;
  index: number;
  left: number;
  top: number;
  size: number;
  tone: GachaCapsuleTone;
  depth: number;
  visualScale: number;
  stackOrder: number;
  mechanicalRow: GachaMechanicalRow;
  rollDistance: number;
  liftHeight: number;
  impulseDelayMs: number;
  responseDurationMs: number;
  restRotation: number;
  isDispenseCapsule: boolean;
  dispenseX: number;
  dispenseY: number;
  settleX: number;
  settleY: number;
};

export type GachaCapsuleMotionFrame = {
  translateX: number;
  translateY: number;
  rotateDeg: number;
  scaleX: number;
  scaleY: number;
};

export type GachaCapsuleDispenseFrame = {
  translateX: number;
  translateY: number;
  rotateDeltaDeg: number;
  opacity: number;
};

export type GachaAgitatorMotionFrame = {
  translateX: number;
  translateY: number;
  rotateDeg: number;
  scaleX: number;
  opacity: number;
};

const CAPSULE_SIZE = 17;
export const GACHA_AGITATION_DURATION_MS = 480;
export const GACHA_AGITATION_PULSE_TURNS = [0.18, 1.18] as const;

export const GACHA_CHAMBER_CAPSULES: readonly GachaChamberCapsuleConfig[] = [
  { id: "upper-1", index: 0, left: 34.2, top: 23, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.92, stackOrder: 1, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 142, responseDurationMs: 188, restRotation: -8, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-2", index: 1, left: 48.9, top: 24.5, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.98, stackOrder: 7, mechanicalRow: "upper", rollDistance: -0.22, liftHeight: 0.1, impulseDelayMs: 136, responseDurationMs: 194, restRotation: 7, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-3", index: 2, left: 26.2, top: 36, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.97, stackOrder: 8, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 148, responseDurationMs: 180, restRotation: -5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-4", index: 3, left: 41, top: 37.5, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.93, stackOrder: 2, mechanicalRow: "upper", rollDistance: 0.38, liftHeight: 0.2, impulseDelayMs: 126, responseDurationMs: 206, restRotation: 6, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-5", index: 4, left: 55.7, top: 35, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.03, stackOrder: 14, mechanicalRow: "upper", rollDistance: -0.36, liftHeight: 0.2, impulseDelayMs: 132, responseDurationMs: 202, restRotation: -7, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-6", index: 5, left: 48.1, top: 50.5, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.98, stackOrder: 9, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 150, responseDurationMs: 180, restRotation: 5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },

  { id: "middle-1", index: 6, left: 18.7, top: 49.5, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.91, stackOrder: 4, mechanicalRow: "middle", rollDistance: 0.7, liftHeight: 0.35, impulseDelayMs: 92, responseDurationMs: 224, restRotation: 8, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-2", index: 7, left: 33.2, top: 48, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.04, stackOrder: 15, mechanicalRow: "middle", rollDistance: -0.85, liftHeight: 0.42, impulseDelayMs: 86, responseDurationMs: 230, restRotation: -6, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-3", index: 8, left: 62.7, top: 48.5, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.92, stackOrder: 3, mechanicalRow: "middle", rollDistance: 1.05, liftHeight: 0.5, impulseDelayMs: 78, responseDurationMs: 238, restRotation: 5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-4", index: 9, left: 11.2, top: 62, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.97, stackOrder: 10, mechanicalRow: "middle", rollDistance: -0.9, liftHeight: 0.45, impulseDelayMs: 84, responseDurationMs: 232, restRotation: -5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-5", index: 10, left: 25.9, top: 63.5, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.93, stackOrder: 5, mechanicalRow: "middle", rollDistance: -0.6, liftHeight: 0.32, impulseDelayMs: 98, responseDurationMs: 220, restRotation: 7, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-6", index: 11, left: 40.5, top: 61, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.05, stackOrder: 16, mechanicalRow: "middle", rollDistance: 1.4, liftHeight: 0.7, impulseDelayMs: 62, responseDurationMs: 246, restRotation: -7, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-7", index: 12, left: 55.3, top: 63.5, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.99, stackOrder: 11, mechanicalRow: "middle", rollDistance: -1.55, liftHeight: 0.72, impulseDelayMs: 54, responseDurationMs: 254, restRotation: 6, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-8", index: 13, left: 69.7, top: 61.5, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.03, stackOrder: 17, mechanicalRow: "middle", rollDistance: 1.7, liftHeight: 0.78, impulseDelayMs: 48, responseDurationMs: 260, restRotation: -5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 3, settleY: 7 },
  { id: "middle-9", index: 14, left: 18.5, top: 73.5, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.98, stackOrder: 12, mechanicalRow: "middle", rollDistance: -1.8, liftHeight: 0.8, impulseDelayMs: 58, responseDurationMs: 250, restRotation: 5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },

  { id: "lower-1", index: 15, left: 4.5, top: 75.5, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.04, stackOrder: 18, mechanicalRow: "lower", rollDistance: 3.2, liftHeight: 0.9, impulseDelayMs: 38, responseDurationMs: 264, restRotation: 4, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-2", index: 16, left: 33, top: 76.5, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.02, stackOrder: 19, mechanicalRow: "lower", rollDistance: -3.8, liftHeight: 1, impulseDelayMs: 34, responseDurationMs: 270, restRotation: -4, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-3", index: 17, left: 47.5, top: 74, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.92, stackOrder: 6, mechanicalRow: "lower", rollDistance: 4.8, liftHeight: 1.2, impulseDelayMs: 28, responseDurationMs: 278, restRotation: 5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-4", index: 18, left: 62, top: 76.5, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.99, stackOrder: 13, mechanicalRow: "lower", rollDistance: -4.2, liftHeight: 1.05, impulseDelayMs: 44, responseDurationMs: 268, restRotation: -5, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 4, settleY: 0.5 },
  { id: "lower-5", index: 19, left: 77, top: 74.5, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.04, stackOrder: 20, mechanicalRow: "lower", rollDistance: -3.4, liftHeight: 0.95, impulseDelayMs: 40, responseDurationMs: 272, restRotation: 4, isDispenseCapsule: true, dispenseX: -4, dispenseY: 18, settleX: 0, settleY: 0 },
];

function clampUnit(value: number): number {
  "worklet";
  return Math.max(0, Math.min(value, 1));
}

function smoothUnit(value: number): number {
  "worklet";
  const unit = clampUnit(value);
  return unit * unit * (3 - 2 * unit);
}

export function resolveGachaAgitationPulseCount(radians: number): number {
  "worklet";
  if (!Number.isFinite(radians) || radians <= 0) return 0;
  const turns = radians / (2 * Math.PI);
  if (turns >= GACHA_AGITATION_PULSE_TURNS[1]) return 2;
  if (turns >= GACHA_AGITATION_PULSE_TURNS[0]) return 1;
  return 0;
}

export function sampleGachaAgitatorMotion(
  impulseProgress: number,
  reduceMotion: boolean,
): GachaAgitatorMotionFrame {
  "worklet";
  const settled = {
    translateX: 0,
    translateY: 0,
    rotateDeg: 0,
    scaleX: 1,
    opacity: 0.7,
  };
  if (
    reduceMotion
    || !Number.isFinite(impulseProgress)
    || impulseProgress <= 0
    || impulseProgress >= 1
  ) return settled;

  const elapsedMs = impulseProgress * GACHA_AGITATION_DURATION_MS;
  const sweepUnit = clampUnit(elapsedMs / 260);
  if (sweepUnit >= 1) return settled;
  const sweep = Math.sin(Math.PI * sweepUnit);
  const contact = Math.sin(Math.PI * smoothUnit(sweepUnit));

  return {
    translateX: 3.4 * sweep,
    translateY: -0.55 * contact * contact,
    rotateDeg: 1.35 * sweep,
    scaleX: 1 + 0.04 * sweep,
    opacity: 0.7 + 0.26 * sweep,
  };
}

export function sampleGachaCapsuleMotion(
  impulseProgress: number,
  capsuleIndex: number,
  capsuleSizeInput: number,
  rollDistanceInput: number,
  liftHeightInput: number,
  impulseDelayMsInput: number,
  responseDurationMsInput: number,
  restRotation: number,
  reduceMotion: boolean,
): GachaCapsuleMotionFrame {
  "worklet";
  const settled = {
    translateX: 0,
    translateY: 0,
    rotateDeg: restRotation,
    scaleX: 1,
    scaleY: 1,
  };
  if (
    reduceMotion
    || !Number.isFinite(impulseProgress)
    || impulseProgress <= 0
    || impulseProgress >= 1
  ) return settled;

  const capsuleSize = Math.max(1, Math.min(capsuleSizeInput, 30));
  const rollDistance = Math.max(-5.2, Math.min(rollDistanceInput, 5.2));
  const liftHeight = Math.max(0, Math.min(liftHeightInput, 1.4));
  const impulseDelayMs = Math.max(0, Math.min(impulseDelayMsInput, 180));
  const responseDurationMs = Math.max(120, Math.min(responseDurationMsInput, 320));
  const elapsedMs = impulseProgress * GACHA_AGITATION_DURATION_MS;
  const localUnit = (elapsedMs - impulseDelayMs) / responseDurationMs;
  if (localUnit <= 0 || localUnit >= 1) return settled;

  const phase = clampUnit(localUnit);
  const envelope = Math.sin(Math.PI * phase);
  const variation = 0.88
    + 0.12 * Math.sin(Math.PI * (2 + (Math.max(0, capsuleIndex) % 3)) * phase);
  const translateX = rollDistance * envelope * variation;
  const translateY = -liftHeight * envelope * envelope;
  const radius = capsuleSize / 2;
  const rotateDeg = restRotation - (translateX / radius) * (180 / Math.PI);
  const impactUnit = clampUnit((phase - 0.66) / 0.28);
  const impact = Math.sin(Math.PI * impactUnit) * Math.min(Math.abs(rollDistance) / 4.8, 1);

  return {
    translateX,
    translateY,
    rotateDeg,
    scaleX: 1 + impact * 0.025,
    scaleY: 1 - impact * 0.035,
  };
}

export function sampleGachaCapsuleDispenseMotion(
  dispenseProgress: number,
  isDispenseCapsule: boolean,
  dispenseXInput: number,
  dispenseYInput: number,
  settleXInput: number,
  settleYInput: number,
  reduceMotion: boolean,
): GachaCapsuleDispenseFrame {
  "worklet";
  const settled = {
    translateX: 0,
    translateY: 0,
    rotateDeltaDeg: 0,
    opacity: 1,
  };
  if (
    reduceMotion
    || !Number.isFinite(dispenseProgress)
    || dispenseProgress <= 0
  ) return settled;

  const progress = clampUnit(dispenseProgress);
  if (isDispenseCapsule) {
    const alignUnit = smoothUnit(progress / 0.22);
    const fallUnit = smoothUnit((progress - 0.16) / 0.38);
    const fadeUnit = smoothUnit((progress - 0.38) / 0.18);
    return {
      translateX: Math.max(-8, Math.min(dispenseXInput, 8)) * alignUnit,
      translateY: Math.max(0, Math.min(dispenseYInput, 24)) * fallUnit,
      rotateDeltaDeg: -18 * fallUnit,
      opacity: 1 - fadeUnit,
    };
  }

  const settleUnit = smoothUnit((progress - 0.56) / 0.28);
  return {
    translateX: Math.max(-5, Math.min(settleXInput, 5)) * settleUnit,
    translateY: Math.max(0, Math.min(settleYInput, 9)) * settleUnit,
    rotateDeltaDeg: Math.max(-8, Math.min(settleXInput * 1.7, 8)) * settleUnit,
    opacity: 1,
  };
}
