export type PreviewRevealMode = "single" | "all";
export type PreviewRevealPhase = "sealed" | "revealed" | "summary";

export type PreviewRevealState = {
  mode: PreviewRevealMode;
  count: number;
  openedCount: number;
  phase: PreviewRevealPhase;
};

export type PreviewResultItem = {
  id: string;
  order: number;
  ticketNumber: string;
};

export type PreviewOpenActions = {
  nextLabel: string;
  openAllLabel: string | null;
};

export type PreviewNextTicketAction = "prepare" | "open" | "none";

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

export function createPreviewRevealState(mode: PreviewRevealMode, count: number): PreviewRevealState {
  return {
    mode,
    count: Math.max(1, Math.min(Math.trunc(count), 50)),
    openedCount: 0,
    phase: "sealed",
  };
}

export function advancePreviewRevealState(state: PreviewRevealState): PreviewRevealState {
  if (state.phase === "summary") return state;
  if (state.mode === "all") {
    return { ...state, openedCount: state.count, phase: "summary" };
  }
  if (state.phase === "sealed") {
    return {
      ...state,
      openedCount: Math.min(state.openedCount + 1, state.count),
      phase: "revealed",
    };
  }
  if (state.openedCount >= state.count) {
    return { ...state, phase: "summary" };
  }
  return { ...state, phase: "sealed" };
}

export function completePreviewRevealState(state: PreviewRevealState): PreviewRevealState {
  return { ...state, openedCount: state.count, phase: "summary" };
}

export function buildPreviewOpenActions(state: PreviewRevealState): PreviewOpenActions {
  const remainingCount = Math.max(0, state.count - state.openedCount);
  const nextPosition = Math.min(state.openedCount + 1, state.count);
  return {
    nextLabel: state.phase === "revealed"
      ? `${nextPosition}번째 쿠지 선택`
      : `${nextPosition}번째 쿠지 열기`,
    openAllLabel: state.mode === "single" && remainingCount > 1
      ? `${remainingCount}개 한 번에 열기`
      : null,
  };
}

export function resolvePreviewNextTicketAction(
  state: PreviewRevealState,
): PreviewNextTicketAction {
  if (state.mode !== "single" || state.phase === "summary" || state.openedCount >= state.count) {
    return "none";
  }
  return state.phase === "revealed" ? "prepare" : "open";
}

export function startPreviewOpenAll(state: PreviewRevealState): PreviewRevealState {
  const remainingCount = Math.max(0, state.count - state.openedCount);
  if (state.phase === "summary" || remainingCount <= 1) return state;
  return { ...state, mode: "all", phase: "sealed" };
}

export function currentPreviewTicketIndex(state: PreviewRevealState): number {
  if (state.phase === "sealed") return Math.min(state.openedCount, state.count - 1);
  return Math.max(0, Math.min(state.openedCount - 1, state.count - 1));
}

export function createPreviewResultItems(tickets: string[], count: number): PreviewResultItem[] {
  const boundedCount = Math.max(1, Math.min(Math.trunc(count), 50));
  return Array.from({ length: boundedCount }, (_, index) => ({
    id: `preview-result-${String(index + 1).padStart(2, "0")}`,
    order: index + 1,
    ticketNumber: tickets[index] ?? String(index + 1).padStart(2, "0"),
  }));
}

export function selectHighestRankedResultId<T extends { id: string; rarity: string }>(
  results: T[],
  tierRanks: Readonly<Record<string, number>>,
): string | null {
  // The server contract owns this order: a smaller tierRank means a higher prize.
  if (!results.length) return null;
  let featuredId = results[0]!.id;
  let featuredRank = normalizedRank(tierRanks[results[0]!.rarity]);
  for (const result of results.slice(1)) {
    const rank = normalizedRank(tierRanks[result.rarity]);
    if (rank < featuredRank) {
      featuredId = result.id;
      featuredRank = rank;
    }
  }
  return featuredId;
}

function normalizedRank(rank: number | undefined): number {
  return Number.isFinite(rank) ? rank! : Number.POSITIVE_INFINITY;
}
