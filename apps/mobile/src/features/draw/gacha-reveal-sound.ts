import { GACHA_CAPSULE_DISPENSE_DURATION_MS } from "./gacha-camera-motion.ts";
import { GACHA_CLOSEUP_DURATION_MS } from "./gacha-reveal-timeline.ts";
import { GACHA_LEVER_TARGET_RADIANS } from "./gacha-lever-motion.ts";

/** A short gear phrase per 60-degree forward sector, shared by taps, drags and auto motion. */
export function resolveGachaLeverSoundSegment(radians: number) {
  "worklet";
  if (!Number.isFinite(radians) || radians <= 0.001) return 0;
  return Math.min(6, Math.ceil(radians / GACHA_LEVER_TARGET_RADIANS * 6 - 0.00001));
}

/**
 * The first capsule contact happens at 65% of the contained dispense motion.
 * The seam begins leaking light at 18% of the subsequent 3-second reveal.
 * Both cues are fired from those native progress values, so they stay in
 * sync with the UI-thread timeline instead of a separate JS timer.
 */
export const GACHA_DROP_IMPACT_SOUND_PROGRESS = 0.65;
export const GACHA_SEAM_OPEN_SOUND_PROGRESS = 0.18;

export const GACHA_REVEAL_SOUND_TIMING = Object.freeze({
  dropImpactMs: Math.round(GACHA_CAPSULE_DISPENSE_DURATION_MS * GACHA_DROP_IMPACT_SOUND_PROGRESS),
  seamOpenMs: GACHA_CAPSULE_DISPENSE_DURATION_MS + Math.round(GACHA_CLOSEUP_DURATION_MS * GACHA_SEAM_OPEN_SOUND_PROGRESS),
});

/** 0 = before contact, 1 = contact, 2 = soft rebound, 3 = seam light leak. */
export type GachaRevealSoundStage = 0 | 1 | 2 | 3;

export function resolveGachaRevealSoundStage(
  active: number,
  dispenseProgress: number,
  revealProgress: number,
): GachaRevealSoundStage {
  "worklet";
  if (!Number.isFinite(active) || !Number.isFinite(dispenseProgress) || !Number.isFinite(revealProgress) || !(active > 0)) return 0;
  if (revealProgress >= GACHA_SEAM_OPEN_SOUND_PROGRESS) return 3;
  if (dispenseProgress >= 0.75) return 2;
  if (dispenseProgress >= GACHA_DROP_IMPACT_SOUND_PROGRESS) return 1;
  return 0;
}
