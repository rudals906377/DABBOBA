export type KujiTicketRevealMotion = {
  glowOpacity: number;
  glowScale: number;
  ticketOpacity: number;
  resultOpacity: number;
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
      resultOpacity: 0,
    };
  }

  if (reduceMotion) {
    return {
      glowOpacity: 0,
      glowScale: 1,
      ticketOpacity: 0,
      resultOpacity: 1,
    };
  }

  const p = clampProgress(progress);
  const glowIn = smootherStep(0, 0.18, p);
  const glowOut = 1 - smootherStep(0.58, 0.88, p);

  return {
    glowOpacity: 0.78 * Math.min(glowIn, glowOut),
    glowScale: 0.78 + 0.3 * smootherStep(0, 0.72, p),
    ticketOpacity: 1 - smootherStep(0.2, 0.62, p),
    resultOpacity: smootherStep(0.48, 0.9, p),
  };
}
