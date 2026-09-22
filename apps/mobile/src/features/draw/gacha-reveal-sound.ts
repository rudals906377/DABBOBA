import { GACHA_CAPSULE_DISPENSE_DURATION_MS } from "@/features/draw/gacha-camera-motion";

/**
 * The first capsule contact happens at 65% of the contained dispense motion.
 * The seam begins leaking light at 14% of the subsequent 3-second reveal.
 */
export const GACHA_REVEAL_SOUND_TIMING = Object.freeze({
  dropImpactMs: Math.round(GACHA_CAPSULE_DISPENSE_DURATION_MS * 0.65),
  seamOpenMs: GACHA_CAPSULE_DISPENSE_DURATION_MS + Math.round(3_000 * 0.14),
});
