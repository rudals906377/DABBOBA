export type KujiPeelRelease = "open" | "reset";

export type KujiOpenMotionPhase =
  | "sealed"
  | "finishing"
  | "waiting-result"
  | "revealing"
  | "revealed";

export type KujiOpenMotionEffect =
  | "none"
  | "request-and-animate"
  | "request-and-wait"
  | "start-impact"
  | "notify-settled"
  | "reset";

export type KujiOpenMotionState = {
  phase: KujiOpenMotionPhase;
  resultReady: boolean;
  reduceMotion: boolean;
};

export type KujiOpenMotionEvent =
  | { type: "request" }
  | { type: "travel-settled"; finished: boolean }
  | { type: "result-ready" }
  | { type: "impact-settled"; finished: boolean }
  | { type: "reduce-motion"; enabled: boolean }
  | { type: "reset" };

export type KujiOpenMotionTransition = {
  state: KujiOpenMotionState;
  effect: KujiOpenMotionEffect;
};

export const DRAW_MOTION = {
  kujiTravelMinMs: 0,
  kujiTravelMaxMs: 890,
  kujiAutoHoldMs: 280,
  kujiSlowTearMs: 540,
  kujiFastTearMs: 350,
  kujiTearSplitProgress: 0.55,
  kujiResultHoldMs: 70,
  kujiImpactMs: 330,
  kujiCueHalfCycleMs: 720,
  kujiEntryMs: 240,
  resultEnterMs: 520,
  resultImageFadeMs: 360,
  resultAuraMs: 560,
} as const;

export type KujiTravelSegments = {
  holdMs: number;
  slowTearMs: number;
  fastTearMs: number;
  splitProgress: number;
};

export function resolveKujiDragProgress(distanceX: number, ticketWidth: number): number {
  "worklet";
  if (!Number.isFinite(distanceX) || !Number.isFinite(ticketWidth) || ticketWidth <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(distanceX / ticketWidth, 1));
}

export function resolveKujiTravelDuration(progress: number): number {
  "worklet";
  const boundedProgress = resolveKujiDragProgress(progress, 1);
  const split = DRAW_MOTION.kujiTearSplitProgress;
  if (boundedProgress < split) {
    const slowRemaining = (split - boundedProgress) / split;
    return Math.round(
      DRAW_MOTION.kujiSlowTearMs * slowRemaining + DRAW_MOTION.kujiFastTearMs,
    );
  }
  const fastRemaining = (1 - boundedProgress) / (1 - split);
  return Math.round(DRAW_MOTION.kujiFastTearMs * fastRemaining);
}

export function resolveKujiTravelSegments(progress: number): KujiTravelSegments {
  "worklet";
  const boundedProgress = resolveKujiDragProgress(progress, 1);
  const splitProgress = DRAW_MOTION.kujiTearSplitProgress;
  return {
    holdMs: boundedProgress <= 0.02 ? DRAW_MOTION.kujiAutoHoldMs : 0,
    slowTearMs: boundedProgress < splitProgress
      ? Math.round(
          DRAW_MOTION.kujiSlowTearMs
          * ((splitProgress - boundedProgress) / splitProgress),
        )
      : 0,
    fastTearMs: boundedProgress < 1
      ? Math.round(
          DRAW_MOTION.kujiFastTearMs
          * ((1 - Math.max(boundedProgress, splitProgress)) / (1 - splitProgress)),
        )
      : 0,
    splitProgress,
  };
}

export function resolveKujiPeelRelease(
  distanceX: number,
  ticketWidth: number,
  velocityX = 0,
): KujiPeelRelease {
  "worklet";
  const progress = resolveKujiDragProgress(distanceX, ticketWidth);
  const intentionalFling = progress >= 0.18 && Number.isFinite(velocityX) && velocityX >= 0.65;
  return progress >= 0.58 || intentionalFling ? "open" : "reset";
}

export function createKujiOpenMotionState(reduceMotion = false): KujiOpenMotionState {
  "worklet";
  return { phase: "sealed", resultReady: false, reduceMotion };
}

export function transitionKujiOpenMotion(
  state: KujiOpenMotionState,
  event: KujiOpenMotionEvent,
): KujiOpenMotionTransition {
  "worklet";
  if (event.type === "reset") {
    return {
      state: createKujiOpenMotionState(state.reduceMotion),
      effect: "reset",
    };
  }

  if (event.type === "reduce-motion") {
    const next = { ...state, reduceMotion: event.enabled };
    if (!event.enabled || state.phase === "sealed" || state.phase === "revealed") {
      return { state: next, effect: "none" };
    }
    return state.resultReady
      ? { state: { ...next, phase: "revealed" }, effect: "notify-settled" }
      : { state: { ...next, phase: "waiting-result" }, effect: "none" };
  }

  if (event.type === "request") {
    if (state.phase !== "sealed") return { state, effect: "none" };
    if (state.reduceMotion && state.resultReady) {
      return { state: { ...state, phase: "revealed" }, effect: "notify-settled" };
    }
    return state.reduceMotion
      ? {
          state: { ...state, phase: "waiting-result" },
          effect: "request-and-wait",
        }
      : {
          state: { ...state, phase: "finishing" },
          effect: "request-and-animate",
        };
  }

  if (event.type === "travel-settled") {
    if (!event.finished) return { state, effect: "none" };
    if (state.phase !== "finishing") return { state, effect: "none" };
    if (!state.resultReady) {
      return { state: { ...state, phase: "waiting-result" }, effect: "none" };
    }
    return state.reduceMotion
      ? { state: { ...state, phase: "revealed" }, effect: "notify-settled" }
      : { state: { ...state, phase: "revealing" }, effect: "start-impact" };
  }

  if (event.type === "result-ready") {
    const next = { ...state, resultReady: true };
    if (state.phase !== "waiting-result") return { state: next, effect: "none" };
    return state.reduceMotion
      ? { state: { ...next, phase: "revealed" }, effect: "notify-settled" }
      : { state: { ...next, phase: "revealing" }, effect: "start-impact" };
  }

  if (event.type === "impact-settled") {
    if (!event.finished) return { state, effect: "none" };
    if (state.phase !== "revealing") return { state, effect: "none" };
    return { state: { ...state, phase: "revealed" }, effect: "notify-settled" };
  }

  return { state, effect: "none" };
}
