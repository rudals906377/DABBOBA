import { GACHA_CLOSEUP_DURATION_MS, sampleGachaRevealLighting, sampleGachaRevealRattle } from "./gacha-reveal-timeline.ts";

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

export type GachaCapsuleRevealFrame = {
  machineOpacity: number;
  machineScale: number;
  capsuleOpacity: number;
  capsuleTranslateX: number;
  capsuleTranslateY: number;
  capsuleScale: number;
  capsuleRotateDeg: number;
  upperTranslateX: number;
  upperTranslateY: number;
  upperRotateDeg: number;
  lowerTranslateX: number;
  lowerTranslateY: number;
  lowerRotateDeg: number;
  flashOpacity: number;
};

const CAPSULE_SIZE = 17;
export const GACHA_AGITATION_DURATION_MS = 480;
export const GACHA_CAPSULE_REVEAL_DURATION_MS = GACHA_CLOSEUP_DURATION_MS;
// Preserve the two cam beats at the same progress through the shorter one-turn action.
export const GACHA_AGITATION_PULSE_TURNS = [0.09, 0.59] as const;

// A fixed poured pile: uneven pockets and varied resting seams, never tidy rows.
// Keep the broad two-thirds fill with a lumpy left-high surface; mechanical
// response tiers are independent from the interleaved front/middle/back depth.
export const GACHA_CHAMBER_CAPSULES: readonly GachaChamberCapsuleConfig[] = [
  { id: "upper-1", index: 0, left: 6.2, top: 24.4, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.92, stackOrder: 1, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 142, responseDurationMs: 188, restRotation: -31, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-2", index: 1, left: 19.7, top: 29.8, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.98, stackOrder: 10, mechanicalRow: "upper", rollDistance: -0.22, liftHeight: 0.1, impulseDelayMs: 136, responseDurationMs: 194, restRotation: 26, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-3", index: 2, left: 35.6, top: 27.9, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.97, stackOrder: 11, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 148, responseDurationMs: 180, restRotation: -13, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-4", index: 3, left: 48, top: 35.2, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.93, stackOrder: 2, mechanicalRow: "upper", rollDistance: 0.38, liftHeight: 0.2, impulseDelayMs: 126, responseDurationMs: 206, restRotation: 38, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-5", index: 4, left: 62.7, top: 33.9, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.03, stackOrder: 19, mechanicalRow: "upper", rollDistance: -0.36, liftHeight: 0.2, impulseDelayMs: 132, responseDurationMs: 202, restRotation: -27, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-6", index: 5, left: 76.3, top: 38.8, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.98, stackOrder: 12, mechanicalRow: "upper", rollDistance: 0, liftHeight: 0, impulseDelayMs: 150, responseDurationMs: 180, restRotation: 17, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },

  { id: "middle-1", index: 6, left: 6, top: 53.2, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.91, stackOrder: 4, mechanicalRow: "middle", rollDistance: 0.7, liftHeight: 0.35, impulseDelayMs: 92, responseDurationMs: 224, restRotation: -22, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-2", index: 7, left: 21.4, top: 56, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.04, stackOrder: 20, mechanicalRow: "middle", rollDistance: -0.85, liftHeight: 0.42, impulseDelayMs: 86, responseDurationMs: 230, restRotation: 34, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-3", index: 8, left: 62.5, top: 58.4, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.92, stackOrder: 3, mechanicalRow: "middle", rollDistance: 1.05, liftHeight: 0.5, impulseDelayMs: 78, responseDurationMs: 238, restRotation: -36, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-4", index: 9, left: 8.8, top: 64.2, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.97, stackOrder: 13, mechanicalRow: "middle", rollDistance: -0.9, liftHeight: 0.45, impulseDelayMs: 84, responseDurationMs: 232, restRotation: 16, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-5", index: 10, left: 37.6, top: 53.1, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.93, stackOrder: 5, mechanicalRow: "middle", rollDistance: -0.6, liftHeight: 0.32, impulseDelayMs: 98, responseDurationMs: 220, restRotation: -8, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-6", index: 11, left: 40, top: 65.3, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.05, stackOrder: 21, mechanicalRow: "middle", rollDistance: 1.4, liftHeight: 0.7, impulseDelayMs: 62, responseDurationMs: 246, restRotation: 29, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-7", index: 12, left: 54.3, top: 65.2, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.99, stackOrder: 14, mechanicalRow: "middle", rollDistance: -1.55, liftHeight: 0.72, impulseDelayMs: 54, responseDurationMs: 254, restRotation: -24, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "middle-8", index: 13, left: 74.9, top: 63, size: CAPSULE_SIZE, tone: "ivory", depth: 2, visualScale: 1.03, stackOrder: 22, mechanicalRow: "middle", rollDistance: 1.7, liftHeight: 0.78, impulseDelayMs: 48, responseDurationMs: 260, restRotation: 31, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 3, settleY: 7 },
  { id: "middle-9", index: 14, left: 22, top: 75, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.98, stackOrder: 15, mechanicalRow: "middle", rollDistance: -1.8, liftHeight: 0.8, impulseDelayMs: 58, responseDurationMs: 250, restRotation: -39, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },

  { id: "lower-1", index: 15, left: 5.5, top: 75.2, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.04, stackOrder: 23, mechanicalRow: "lower", rollDistance: 3.2, liftHeight: 0.9, impulseDelayMs: 38, responseDurationMs: 264, restRotation: 33, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-2", index: 16, left: 35.3, top: 76.3, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.02, stackOrder: 24, mechanicalRow: "lower", rollDistance: -3.8, liftHeight: 1, impulseDelayMs: 34, responseDurationMs: 270, restRotation: -26, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-3", index: 17, left: 48.6, top: 74.3, size: CAPSULE_SIZE, tone: "lime", depth: 0, visualScale: 0.92, stackOrder: 6, mechanicalRow: "lower", rollDistance: 4.8, liftHeight: 1.2, impulseDelayMs: 28, responseDurationMs: 278, restRotation: 12, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "lower-4", index: 18, left: 62.2, top: 76.6, size: CAPSULE_SIZE, tone: "ivory", depth: 1, visualScale: 0.99, stackOrder: 16, mechanicalRow: "lower", rollDistance: -4.2, liftHeight: 1.05, impulseDelayMs: 44, responseDurationMs: 268, restRotation: -35, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 4, settleY: 0.5 },
  { id: "lower-5", index: 19, left: 77, top: 74.5, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 1.04, stackOrder: 26, mechanicalRow: "lower", rollDistance: -3.4, liftHeight: 0.95, impulseDelayMs: 40, responseDurationMs: 272, restRotation: 22, isDispenseCapsule: true, dispenseX: -8, dispenseY: 18, settleX: 0, settleY: 0 },

  // Interleaved rear/middle pockets fill the raised pile without enlarging faces.
  { id: "upper-7", index: 20, left: 7.4, top: 39.6, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.93, stackOrder: 7, mechanicalRow: "upper", rollDistance: 0.28, liftHeight: 0.12, impulseDelayMs: 128, responseDurationMs: 206, restRotation: 19, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-8", index: 21, left: 23, top: 43.7, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.98, stackOrder: 17, mechanicalRow: "upper", rollDistance: -0.24, liftHeight: 0.12, impulseDelayMs: 131, responseDurationMs: 203, restRotation: -37, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-9", index: 22, left: 37.5, top: 40.9, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.92, stackOrder: 8, mechanicalRow: "upper", rollDistance: 0.28, liftHeight: 0.12, impulseDelayMs: 134, responseDurationMs: 200, restRotation: 32, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-10", index: 23, left: 50.8, top: 49.7, size: CAPSULE_SIZE, tone: "lime", depth: 1, visualScale: 0.97, stackOrder: 18, mechanicalRow: "upper", rollDistance: -0.24, liftHeight: 0.12, impulseDelayMs: 137, responseDurationMs: 197, restRotation: -17, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-11", index: 24, left: 62.5, top: 47.6, size: CAPSULE_SIZE, tone: "ivory", depth: 0, visualScale: 0.91, stackOrder: 9, mechanicalRow: "upper", rollDistance: 0.28, liftHeight: 0.12, impulseDelayMs: 140, responseDurationMs: 194, restRotation: 39, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
  { id: "upper-12", index: 25, left: 76.2, top: 50.8, size: CAPSULE_SIZE, tone: "lime", depth: 2, visualScale: 0.97, stackOrder: 25, mechanicalRow: "upper", rollDistance: -0.24, liftHeight: 0.12, impulseDelayMs: 143, responseDurationMs: 191, restRotation: -12, isDispenseCapsule: false, dispenseX: 0, dispenseY: 0, settleX: 0, settleY: 0 },
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

function sampleRevealTrack(
  progress: number,
  input: readonly number[],
  output: readonly number[],
): number {
  "worklet";
  if (input.length === 0 || input.length !== output.length) return 0;
  if (progress <= input[0]!) return output[0]!;
  const lastIndex = input.length - 1;
  if (progress >= input[lastIndex]!) return output[lastIndex]!;
  for (let index = 1; index < input.length; index += 1) {
    const upperBound = input[index]!;
    if (progress > upperBound) continue;
    const lowerBound = input[index - 1]!;
    const segment = Math.max(upperBound - lowerBound, Number.EPSILON);
    const local = smoothUnit((progress - lowerBound) / segment);
    return output[index - 1]! + (output[index]! - output[index - 1]!) * local;
  }
  return output[lastIndex]!;
}

export function sampleGachaCapsuleRevealMotion(
  revealProgress: number,
  reduceMotion: boolean,
): GachaCapsuleRevealFrame {
  "worklet";
  const progress = clampUnit(Number.isFinite(revealProgress) ? revealProgress : 0);
  if (reduceMotion) {
    return {
      machineOpacity: progress >= 1 ? 0 : 1,
      machineScale: 1,
      capsuleOpacity: 1,
      capsuleTranslateX: 0,
      capsuleTranslateY: 0,
      capsuleScale: 1,
      capsuleRotateDeg: 0,
      upperTranslateX: 0,
      upperTranslateY: 0,
      upperRotateDeg: 0,
      lowerTranslateX: 0,
      lowerTranslateY: 0,
      lowerRotateDeg: 0,
      flashOpacity: 0,
    };
  }

  // The fallback shares the baked sphere's calm, symmetric opening.
  // Screen rotation has the opposite sign to the shader's world-space Z axis.
  const { opening, seal } = sampleGachaRevealLighting(progress);
  const rattle = sampleGachaRevealRattle(progress);
  return {
    machineOpacity: sampleRevealTrack(progress, [0, 0.26, 0.40, 1], [1, 1, 0, 0]),
    machineScale: 1,
    capsuleOpacity: 1,
    capsuleTranslateX: 0,
    capsuleTranslateY: 0,
    capsuleScale: 1,
    capsuleRotateDeg: -4.3 - rattle * 180 / Math.PI,
    upperTranslateX: 0,
    upperTranslateY: -3.5 * seal - 42 * opening,
    upperRotateDeg: 0,
    lowerTranslateX: 0,
    lowerTranslateY: 3.5 * seal + 42 * opening,
    lowerRotateDeg: 0,
    flashOpacity: 0,
  };
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
