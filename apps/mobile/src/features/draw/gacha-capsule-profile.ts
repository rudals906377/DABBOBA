/** Exact sphere used by the premium hero; the chamber keeps its simple cup shape. */
export const GACHA_CAPSULE_PROFILE = {
  radius: 1,
  halfHeight: 1,
  upperStraight: 0,
  lowerStraight: 0,
  lowerBaseRadius: 0,
  curveSegments: 16,
} as const;

export type CapsuleProfileRing = { height: number; radius: number };

/** Cross-sections for regression checks; production uses exact sphere roots. */
export function createCapsuleProfileRings(_side: 1 | -1): CapsuleProfileRing[] {
  return Array.from({ length: GACHA_CAPSULE_PROFILE.curveSegments + 1 }, (_, index) => {
    const angle = index / GACHA_CAPSULE_PROFILE.curveSegments * Math.PI / 2;
    return { height: Math.sin(angle), radius: Math.cos(angle) };
  });
}
