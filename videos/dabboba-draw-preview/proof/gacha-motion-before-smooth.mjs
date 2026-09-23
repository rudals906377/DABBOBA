/** Pure, seek-safe motion shared by the player and frame captures. */
export const GACHA_DURATION = 4.2;
export const GACHA_CONTACT_TIMES = Object.freeze([0.50, 0.89, 1.10]);
export const GACHA_SEAL_TIME = 1.8;
export const KUJI_COMPLETE_DURATION = 0.72;
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const smooth = (value) => { const t = clamp(value); return t * t * t * (t * (t * 6 - 15) + 10); };
export const range = (time, start, end) => clamp((time - start) / (end - start));

export function sampleGacha(seconds, reducedMotion = false) {
  const time = clamp(seconds, 0, GACHA_DURATION);
  // Extend only the push-in by 0.20 s; shift the intact opening/reveal after it.
  // Fall, bounces, framing and the shell separation remain unchanged.
  const opening = smooth(range(time, 1.86, 3.30));
  const bounce = (start, end, height) => { const u = range(time, start, end); return height * 4 * u * (1 - u); };
  const dropHeight = time < 0.50 ? 2.8 * (1 - (time / 0.50) ** 2)
    : time < 0.89 ? bounce(0.50, 0.89, 0.30)
      : time < 1.10 ? bounce(0.89, 1.10, 0.08) : 0;
  // A small damped settling tilt, not a spin or deformation of the artwork.
  const settle = range(time, 0.50, 1.20);
  const rattle = time >= 0.50 && time < 1.20
    ? Math.sin(settle * Math.PI * 4) * (1 - settle) ** 2 * 0.035 : 0;
  return {
    time, dropHeight: reducedMotion ? 0 : dropHeight,
    focus: reducedMotion ? 0 : smooth(range(time, 1.20, 1.80)),
    seal: reducedMotion ? 0 : smooth(range(time, 1.80, 1.92)),
    rattle: reducedMotion ? 0 : rattle,
    opening: reducedMotion ? 0 : opening,
    light: reducedMotion ? 0 : smooth(range(time, 1.88, 3.65)) * 0.78,
    whiteout: reducedMotion ? Number(time > 0) : smooth(range(time, 3.30, 4.00)),
    resultOpacity: reducedMotion ? Number(time > 0) : 1 - (1 - range(time, 4.00, 4.20)) ** 3,
    reducedMotion,
    phase: time < 0.50 ? '낙하' : time < 1.10 ? '착지' : time < 1.20 ? '잠깐 멈춤' : time < 1.80 ? '가까이 보기' : time < 3.30 ? '개봉' : '결과 공개',
  };
}

export function dragProgress(distance, width) { return width > 0 ? clamp(distance / width) : 0; }
export function shouldOpen(progress, velocityPxPerSecond) {
  return progress >= 0.58 || (progress >= 0.18 && velocityPxPerSecond >= 650);
}
export function kujiCompletionDuration(startProgress) {
  return 0.36 + 0.36 * (1 - clamp(startProgress));
}
export function sampleKujiCompletion(startProgress, seconds, reducedMotion = false) {
  const start = clamp(startProgress);
  const duration = kujiCompletionDuration(start);
  const t = clamp(seconds, 0, duration);
  const peelEnd = duration - 0.24;
  const easeOut = value => 1 - (1 - clamp(value)) ** 3;
  return {
    progress: reducedMotion ? 0 : start + (1 - start) * easeOut(t / peelEnd),
    settle: reducedMotion ? 0 : smooth(range(t, peelEnd - 0.06, peelEnd + 0.14)),
    resultOpacity: reducedMotion ? 1 : easeOut(range(t, peelEnd, peelEnd + 0.20)),
    reducedMotion,
  };
}

export function sampleKujiDemo(seconds) {
  const t = clamp(seconds, 0, 1.62);
  return t <= 0.9
    ? { progress: 0.65 * smooth(range(t, 0.12, 0.9)), settle: 0, resultOpacity: 0, reducedMotion: false }
    : sampleKujiCompletion(0.65, t - 0.9);
}
