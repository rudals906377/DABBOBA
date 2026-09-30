export const GACHA_FIREFLY_COUNT = 36;
export const GACHA_FIREFLY_DURATION_MS = 12_000;

export type KujiFireflyConfig = {
  id: string;
  laneIndex: number;
  leftPercent: number;
  startTopPercent: number;
  size: number;
  curveAmplitude: number;
  curveDirection: -1 | 1;
  curveSkew: number;
  curvePhase: number;
  riseDistance: number;
  startOffset: number;
  durationMs: number;
  twinkleCycles: 2 | 3;
};

export type KujiFireflyMotionFrame = {
  translateX: number;
  translateY: number;
  opacity: number;
  rotateDeg: number;
  scale: number;
};

const TWO_PI = Math.PI * 2;

function seedFromText(value: string): number {
  let seed = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function createSeededUnitInterval(initialSeed: number): () => number {
  let state = initialSeed || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A full-width staggered field that stays dispersed across every loop. */
export function createGachaFireflyConfigs(
  seedText: string,
  stage: { width: number; height: number },
): KujiFireflyConfig[] {
  const { width, height } = stage;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const random = createSeededUnitInterval(seedFromText(`gacha:${seedText}`));
  const laneCount = GACHA_FIREFLY_COUNT / 3;
  const lanes = Array.from({ length: laneCount }, (_, index) => 4 + index * (92 / (laneCount - 1)));
  const phasePairs = Array.from({ length: laneCount / 2 }, (_, index) => index);
  for (let index = phasePairs.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [phasePairs[index], phasePairs[swapIndex]] = [phasePairs[swapIndex]!, phasePairs[index]!];
  }
  // Adjacent lanes alternate heights, including the two outermost pairs that
  // remain visible beside a wide cabinet. Seeded ordering avoids flat rows.
  const phaseRanks = phasePairs.flatMap((rank) => random() < 0.5
    ? [rank, rank + laneCount / 2]
    : [rank + laneCount / 2, rank]);
  return lanes.flatMap((centerPercent, laneIndex) => {
    const lanePitch = width * 0.92 / (laneCount - 1);
    const phaseOffset = (phaseRanks[laneIndex]! + 0.1 + random() * 0.25) / GACHA_FIREFLY_COUNT;
    // Three separated heights per lane: never launch a whole row together.
    // A shared period preserves this distribution after minutes of playback.
    return Array.from({ length: 3 }, (_, band): KujiFireflyConfig => {
      const size = Math.min(3 + Math.floor(random() * 3), lanePitch * 0.38, height * 0.01);
      const curveAmplitude = Math.min(6, lanePitch * (0.14 + random() * 0.04));
      const startY = height * (0.95 + random() * 0.025);
      const endY = height * (0.025 + random() * 0.025);
      return {
        id: `gacha-firefly-${laneIndex}-${band}`,
        laneIndex,
        leftPercent: centerPercent - size / 2 / width * 100,
        startTopPercent: (startY - size / 2) / height * 100,
        size,
        curveAmplitude,
        curveDirection: random() < 0.5 ? -1 : 1,
        curveSkew: (random() - 0.5) * 0.36,
        curvePhase: random() * TWO_PI,
        riseDistance: startY - endY,
        startOffset: phaseOffset + band / 3,
        durationMs: GACHA_FIREFLY_DURATION_MS,
        twinkleCycles: random() < 0.5 ? 2 : 3,
      };
    });
  });
}

export function sampleKujiFireflyMotion(
  particle: KujiFireflyConfig,
  progress: number,
): KujiFireflyMotionFrame {
  "worklet";
  const boundedProgress = Math.max(0, Math.min(progress, 1));
  const curvedProgress = boundedProgress
    + particle.curveSkew * boundedProgress * (1 - boundedProgress);
  const translateX = Math.sin(curvedProgress * Math.PI)
    * particle.curveAmplitude
    * particle.curveDirection;
  const translateY = -boundedProgress * particle.riseDistance;
  const shimmer = (Math.sin(
    boundedProgress * TWO_PI * particle.twinkleCycles + particle.curvePhase,
  ) + 1) / 2;

  let lifeOpacity = 1;
  if (boundedProgress < 0.08) {
    lifeOpacity = boundedProgress / 0.08;
  } else if (boundedProgress > 0.94) {
    lifeOpacity = (1 - boundedProgress) / 0.06;
  } else if (boundedProgress > 0.72) {
    lifeOpacity = 1 - ((boundedProgress - 0.72) / 0.22) * 0.36;
  }

  return {
    translateX,
    translateY,
    opacity: Math.max(0, lifeOpacity) * (0.68 + shimmer * 0.24),
    rotateDeg: particle.curveDirection * (2 + Math.sin(boundedProgress * Math.PI) * 7),
    scale: 0.72 + Math.sin(boundedProgress * Math.PI) * 0.28,
  };
}
