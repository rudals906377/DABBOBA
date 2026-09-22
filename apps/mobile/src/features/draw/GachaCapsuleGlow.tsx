import { StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { seed } from "@/design-system/seed";
import { sampleGachaCameraMotion } from "@/features/draw/gacha-camera-motion";
import { sampleGachaBowlProjection } from "@/features/draw/gacha-bowl-projection";
import { sampleGachaCapsuleGlow } from "@/features/draw/gacha-capsule-glow";
import { sampleGachaRevealLighting } from "@/features/draw/gacha-reveal-timeline";

const GLOW_TEXTURE = require("../../../assets/draw/gacha/gacha-capsule-glow-v1.png");
type Props = {
  progress: SharedValue<number>;
  active: SharedValue<number>;
  stageSize: { width: number; height: number };
  reduceMotion: boolean;
};

/** One static optical density texture behind the opaque, depth-tested shells. */
export function GachaCapsuleGlow({ progress, active, stageSize, reduceMotion }: Props) {
  const { width, height } = stageSize;
  const hero = sampleGachaCameraMotion(1, width, height);
  const imageSize = hero.capsuleDiameter * 2.8;
  const glowStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(progress.value, width, height, reduceMotion);
    const source = sampleGachaBowlProjection(progress.value, camera, false);
    const light = sampleGachaRevealLighting(progress.value, reduceMotion);
    const glow = sampleGachaCapsuleGlow(progress.value, light, reduceMotion);
    const scale = glow.scale * camera.capsuleDiameter / Math.max(1, hero.capsuleDiameter);
    return {
      opacity: active.value * glow.opacity,
      transform: [
        { translateX: source.x - width / 2 },
        { translateY: source.y - height / 2 },
        { scaleX: scale },
        { scaleY: scale * glow.verticalScale },
      ],
    };
  });
  if (reduceMotion || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={styles.container} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.Image
        testID="gacha-capsule-glow"
        source={GLOW_TEXTURE}
        resizeMode="stretch"
        fadeDuration={0}
        style={[styles.field, {
          left: (width - imageSize) / 2, top: (height - imageSize) / 2,
          width: imageSize, height: imageSize,
        }, glowStyle]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, zIndex: 1 },
  field: { position: "absolute", backgroundColor: seed.color.background.transparent },
});
