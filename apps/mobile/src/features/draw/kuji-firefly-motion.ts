export const KUJI_FIREFLY_COUNT = 12;
export const KUJI_FIREFLY_MIN_STAGE_WIDTH = 320;

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
const FIREFLY_LANES = [
  7,
  14.82,
  22.64,
  30.45,
  38.27,
  46.09,
  53.91,
  61.73,
  69.55,
  77.36,
  85.18,
  93,
] as const;

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

const roundToHundredth = (value: number) => Math.round(value * 100) / 100;
const roundToHundredThousandth = (value: number) => Math.round(value * 100_000) / 100_000;

export function createKujiFireflyConfigs(seedText: string): KujiFireflyConfig[] {
  const random = createSeededUnitInterval(seedFromText(seedText));
  const phaseRanks = FIREFLY_LANES.map((_, index) => index);

  for (let index = phaseRanks.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [phaseRanks[index], phaseRanks[swapIndex]] = [phaseRanks[swapIndex]!, phaseRanks[index]!];
  }

  return FIREFLY_LANES.map((leftPercent, index) => {
    const verticalUnit = random();
    const phaseRank = phaseRanks[index]!;
    return {
      id: `kuji-firefly-${index}`,
      laneIndex: index,
      leftPercent: roundToHundredth(leftPercent + (random() - 0.5) * 0.8),
      startTopPercent: roundToHundredth(93 + verticalUnit * 5),
      size: 3 + Math.floor(random() * 3),
      curveAmplitude: roundToHundredth(4 + random() * 3),
      curveDirection: random() < 0.5 ? -1 : 1,
      curveSkew: roundToHundredth((random() - 0.5) * 0.36),
      curvePhase: roundToHundredth(random() * TWO_PI),
      riseDistance: roundToHundredth(438 + verticalUnit * 30),
      startOffset: roundToHundredThousandth((phaseRank + 0.1 + random() * 0.25) / KUJI_FIREFLY_COUNT),
      durationMs: 6_600 + phaseRank * 135 + Math.round(random() * 100),
      twinkleCycles: random() < 0.5 ? 2 : 3,
    };
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
