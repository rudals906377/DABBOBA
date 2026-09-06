import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { seed } from "@/design-system/seed";
import { sampleGachaCameraMotion } from "@/features/draw/gacha-camera-motion";
import { sampleGachaBowlProjection } from "@/features/draw/gacha-bowl-projection";
import { sampleGachaPrismLight, sampleGachaPrismBeamScale } from "@/features/draw/gacha-prism-light";
import { sampleGachaRevealLighting } from "@/features/draw/gacha-reveal-timeline";

const PRISM_TEXTURE = require("../../../assets/gacha-prism-light-v1.png");
const PRISM_MANIFEST = require("../../../assets/gacha-prism-light-v1.json") as { reachRatio: number };

type Props = {
  progress: SharedValue<number>;
  active: SharedValue<number>;
  stageSize: { width: number; height: number };
  reduceMotion: boolean;
};

/**
 * One pre-rasterized optical field: only native transform/opacity changes.
 * The depth-tested white-hot mouth remains in the capsule atlas itself.
 */
export function GachaPrismLight({ progress, active, stageSize, reduceMotion }: Props) {
  const { width, height } = stageSize;
  const imageSize = Math.hypot(width, height) * 0.82 / PRISM_MANIFEST.reachRatio;
  const fieldStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(progress.value, width, height, reduceMotion);
    const hero = sampleGachaCameraMotion(1, width, height);
    const source = sampleGachaBowlProjection(progress.value, camera, false);
    const light = sampleGachaRevealLighting(progress.value, reduceMotion);
    const burst = sampleGachaPrismLight(progress.value, light, reduceMotion);
    const scale = sampleGachaPrismBeamScale(burst.scale, camera.capsuleDiameter, hero.capsuleDiameter);
    return {
      opacity: active.value * burst.opacity,
      transform: [
        { translateX: source.x - width / 2 },
        { translateY: source.y - height / 2 },
        { scale },
      ],
    };
  });
  if (reduceMotion || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={styles.container} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.Image
        testID="gacha-prism-light"
        source={PRISM_TEXTURE}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        resizeMode="stretch"
        fadeDuration={0}
        style={[styles.field, {
          left: (width - imageSize) / 2,
          top: (height - imageSize) / 2,
          width: imageSize,
          height: imageSize,
        }, fieldStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, zIndex: 1 },
  field: { position: "absolute", zIndex: 1, backgroundColor: seed.color.background.transparent },
});
