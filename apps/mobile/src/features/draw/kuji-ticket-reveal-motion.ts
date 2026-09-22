export type KujiTicketRevealMotion = {
  glowOpacity: number;
  glowScale: number;
  ticketOpacity: number;
  ticketTranslateY: number;
  resultOpacity: number;
  resultTranslateY: number;
};

export function isKujiResultGateOpen(
  phase: string,
  resultReady: boolean,
  settled: boolean,
) {
  "worklet";
  return settled || (resultReady && (phase === "revealing" || phase === "revealed"));
}

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
 * Samples the one-shot kuji payoff. The server gate is deliberately part of
 * the sampler so a pre-mounted prize cannot become visible from stale motion.
 */
export function sampleKujiTicketRevealMotion(
  progress: number,
  resultReady: boolean,
  reduceMotion = false,
): KujiTicketRevealMotion {
  "worklet";
  if (!resultReady) {
    return {
      glowOpacity: 0,
      glowScale: 1,
      ticketOpacity: 1,
      ticketTranslateY: 0,
      resultOpacity: 0,
      resultTranslateY: 18,
    };
  }

  if (reduceMotion) {
    return {
      glowOpacity: 0,
      glowScale: 1,
      ticketOpacity: 0,
      ticketTranslateY: 0,
      resultOpacity: 1,
      resultTranslateY: 0,
    };
  }

  const p = clampProgress(progress);
  return {
    glowOpacity: 0,
    glowScale: 1,
    ticketOpacity: 1 - smootherStep(0.52, 0.96, p),
    ticketTranslateY: -34 * smootherStep(0.08, 1, p),
    resultOpacity: smootherStep(0.24, 0.86, p),
    resultTranslateY: 18 * (1 - smootherStep(0.18, 1, p)),
  };
}
