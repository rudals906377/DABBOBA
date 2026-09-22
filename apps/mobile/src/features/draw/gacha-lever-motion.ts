export const GACHA_LEVER_REQUIRED_TURNS = 1;
export const GACHA_LEVER_TARGET_RADIANS = Math.PI * 2 * GACHA_LEVER_REQUIRED_TURNS;
export const GACHA_LEVER_COMPLETION_RADIANS = GACHA_LEVER_TARGET_RADIANS * 0.95;
export const GACHA_LEVER_REQUIRED_TAPS = 6;
const GACHA_LEVER_TAP_RADIANS = GACHA_LEVER_TARGET_RADIANS / GACHA_LEVER_REQUIRED_TAPS;

const MAX_SAMPLE_DELTA = Math.PI / 2;

export type GachaLeverMotionPhase =
  | "ready"
  | "waiting-result"
  | "dispensing"
  | "revealed";

export type GachaLeverMotionEffect =
  | "none"
  | "request-result"
  | "start-dispense"
  | "notify-settled"
  | "reset";

export type GachaLeverMotionState = {
  phase: GachaLeverMotionPhase;
  resultReady: boolean;
  reduceMotion: boolean;
};

export type GachaLeverMotionEvent =
  | { type: "request" }
  | { type: "result-ready" }
  | { type: "dispense-settled"; finished: boolean }
  | { type: "reduce-motion"; enabled: boolean }
  | { type: "reset" };

export type GachaLeverMotionTransition = {
  state: GachaLeverMotionState;
  effect: GachaLeverMotionEffect;
};

export type GachaLeverTouchStart = {
  accepted: boolean;
  angle: number | null;
};

export function resolveGachaLeverPointAngle(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  minimumRadius: number,
  maximumRadius: number,
): number | null {
  "worklet";
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(centerX)
    || !Number.isFinite(centerY)
  ) return null;

  const distanceX = x - centerX;
  const distanceY = y - centerY;
  const radius = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
  if (radius < minimumRadius || radius > maximumRadius) return null;
  return Math.atan2(distanceY, distanceX);
}

export function resolveGachaLeverTouchStart(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  minimumTrackingRadius: number,
  maximumTrackingRadius: number,
): GachaLeverTouchStart {
  "worklet";
  const outerAngle = resolveGachaLeverPointAngle(
    x,
    y,
    centerX,
    centerY,
    0,
    maximumTrackingRadius,
  );
  if (outerAngle === null) return { accepted: false, angle: null };

  return {
    accepted: true,
    angle: resolveGachaLeverPointAngle(
      x,
      y,
      centerX,
      centerY,
      minimumTrackingRadius,
      maximumTrackingRadius,
    ),
  };
}

export function normalizeGachaLeverDelta(delta: number): number {
  "worklet";
  if (!Number.isFinite(delta)) return 0;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

export function advanceGachaLeverRadians(
  currentRadians: number,
  previousAngle: number | null,
  nextAngle: number | null,
): number {
  "worklet";
  if (previousAngle === null || nextAngle === null) return Math.max(0, currentRadians);
  const delta = normalizeGachaLeverDelta(nextAngle - previousAngle);
  if (Math.abs(delta) > MAX_SAMPLE_DELTA) return Math.max(0, currentRadians);
  return Math.max(0, Math.min(currentRadians + delta, GACHA_LEVER_TARGET_RADIANS));
}

export function advanceGachaLeverTapRadians(currentRadians: number): number {
  "worklet";
  const boundedCurrent = Number.isFinite(currentRadians)
    ? Math.max(0, currentRadians)
    : 0;
  return Math.min(
    boundedCurrent + GACHA_LEVER_TAP_RADIANS,
    GACHA_LEVER_TARGET_RADIANS,
  );
}

export function resolveGachaLeverProgress(radians: number): number {
  "worklet";
  if (!Number.isFinite(radians)) return 0;
  return Math.max(0, Math.min(radians / GACHA_LEVER_TARGET_RADIANS, 1));
}

export function isGachaLeverComplete(radians: number): boolean {
  "worklet";
  return Number.isFinite(radians) && radians >= GACHA_LEVER_COMPLETION_RADIANS;
}

export function createGachaLeverMotionState(
  reduceMotion = false,
): GachaLeverMotionState {
  "worklet";
  return { phase: "ready", resultReady: false, reduceMotion };
}

export function transitionGachaLeverMotion(
  state: GachaLeverMotionState,
  event: GachaLeverMotionEvent,
): GachaLeverMotionTransition {
  "worklet";
  if (event.type === "reset") {
    return {
      state: createGachaLeverMotionState(state.reduceMotion),
      effect: "reset",
    };
  }

  if (event.type === "reduce-motion") {
    const next = { ...state, reduceMotion: event.enabled };
    if (!event.enabled || state.phase === "ready" || state.phase === "revealed") {
      return { state: next, effect: "none" };
    }
    return state.resultReady
      ? { state: { ...next, phase: "revealed" }, effect: "notify-settled" }
      : { state: { ...next, phase: "waiting-result" }, effect: "none" };
  }

  if (event.type === "request") {
    if (state.phase !== "ready") return { state, effect: "none" };
    if (state.resultReady) {
      return state.reduceMotion
        ? { state: { ...state, phase: "revealed" }, effect: "notify-settled" }
        : { state: { ...state, phase: "dispensing" }, effect: "start-dispense" };
    }
    return {
      state: { ...state, phase: "waiting-result" },
      effect: "request-result",
    };
  }

  if (event.type === "result-ready") {
    const next = { ...state, resultReady: true };
    if (state.phase !== "waiting-result") return { state: next, effect: "none" };
    return state.reduceMotion
      ? { state: { ...next, phase: "revealed" }, effect: "notify-settled" }
      : { state: { ...next, phase: "dispensing" }, effect: "start-dispense" };
  }

  if (event.type === "dispense-settled") {
    if (!event.finished || state.phase !== "dispensing") {
      return { state, effect: "none" };
    }
    return {
      state: { ...state, phase: "revealed" },
      effect: "notify-settled",
    };
  }

  return { state, effect: "none" };
}
