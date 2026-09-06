import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { seed } from "@/design-system/seed";
import {
  GACHA_PICKUP_GEOMETRY,
  sampleGachaCameraMotion,
  sampleGachaPickupMotion,
} from "@/features/draw/gacha-camera-motion";
import { sampleGachaCapsuleAtlasFrame } from "@/features/draw/gacha-capsule-frames-motion";

type CapsuleAtlasManifest = {
  schemaVersion: number;
  tone: "lime";
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  closedFrameIndex: number;
  revealProgressMin: number;
  revealProgressMax: number;
  projection: { diameter: number };
};

const ATLAS = require("../../../assets/gacha-capsule-reveal-atlas-v1.json") as CapsuleAtlasManifest;
const ATLAS_IMAGE = require("../../../assets/gacha-capsule-reveal-atlas-v1.png");

type GachaCapsuleFramesProps = {
  progress: SharedValue<number>;
  dispenseProgress: SharedValue<number>;
  active: SharedValue<number>;
  viewportSize: { width: number; height: number };
  reduceMotion: boolean;
  tone: "lime" | "ivory";
  onReady?: () => void;
  onUnavailable?: (reason?: string) => void;
};

/**
 * The approved hollow-sphere shader is baked into one finite native image atlas.
 * One image load and UI-thread tile transforms preserve the exact 3D model,
 * canonical curved wordmark and inner light without an unreliable GL swapchain.
 * Native camera/pickup progress still drives the stationary capsule projection.
 */
export function GachaCapsuleFrames({
  progress,
  dispenseProgress,
  active,
  viewportSize,
  reduceMotion,
  tone,
  onReady,
  onUnavailable,
}: GachaCapsuleFramesProps) {
  const loaded = useSharedValue(0);
  const mounted = useRef(true);
  const readyNotified = useRef(false);
  const failed = useRef(false);
  const callbacks = useRef({ onReady, onUnavailable });
  callbacks.current = { onReady, onUnavailable };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loaded.value = 0;
    };
  }, [loaded]);

  useEffect(() => {
    if (tone !== ATLAS.tone && !failed.current) {
      loaded.value = 0;
      failed.current = true;
      callbacks.current.onUnavailable?.("Capsule atlas tone unavailable");
    }
  }, [loaded, tone]);

  const handleLoad = useCallback(() => {
    if (!mounted.current || readyNotified.current || failed.current || tone !== ATLAS.tone) return;
    loaded.value = 1;
    readyNotified.current = true;
    callbacks.current.onReady?.();
  }, [loaded, tone]);

  const handleError = useCallback(() => {
    if (!mounted.current || failed.current) return;
    loaded.value = 0;
    failed.current = true;
    callbacks.current.onUnavailable?.("Capsule atlas image unavailable");
  }, [loaded]);

  const apertureStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(progress.value, viewportSize.width, viewportSize.height, reduceMotion);
    const pickup = sampleGachaPickupMotion(dispenseProgress.value, reduceMotion);
    const box = GACHA_PICKUP_GEOMETRY;
    const worldScale = camera.presentationScale * camera.scale;
    const clipped = dispenseProgress.value < 1;
    return {
      left: clipped ? viewportSize.width / 2 + (box.left - box.machineWidth / 2) * worldScale + camera.translateX : 0,
      top: clipped ? viewportSize.height / 2 + (box.top - box.machineHeight / 2) * worldScale + camera.translateY : 0,
      width: clipped ? box.width * worldScale : viewportSize.width,
      height: clipped ? box.height * worldScale : viewportSize.height,
      // The atlas already contains the shader's shell fade; do not apply it twice.
      opacity: !reduceMotion && tone === ATLAS.tone && active.value > 0 ? loaded.value * pickup.opacity : 0,
    };
  });

  const capsuleStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(progress.value, viewportSize.width, viewportSize.height, reduceMotion);
    const pickup = sampleGachaPickupMotion(dispenseProgress.value, reduceMotion);
    const box = GACHA_PICKUP_GEOMETRY;
    const worldScale = camera.presentationScale * camera.scale;
    const clipped = dispenseProgress.value < 1;
    const clipLeft = clipped ? viewportSize.width / 2 + (box.left - box.machineWidth / 2) * worldScale + camera.translateX : 0;
    const clipTop = clipped ? viewportSize.height / 2 + (box.top - box.machineHeight / 2) * worldScale + camera.translateY : 0;
    return {
      transform: [
        { translateX: camera.capsuleX + pickup.x * worldScale - clipLeft - ATLAS.frameWidth / 2 },
        { translateY: camera.capsuleY + pickup.y * worldScale - clipTop - ATLAS.frameHeight / 2 },
        { rotate: `${pickup.rotation}deg` },
        { scale: camera.capsuleDiameter / ATLAS.projection.diameter },
      ],
    };
  });

  const sheetStyle = useAnimatedStyle(() => {
    const tile = sampleGachaCapsuleAtlasFrame(progress.value, ATLAS, reduceMotion);
    return { transform: [{ translateX: tile.translateX }, { translateY: tile.translateY }] };
  });

  return (
    <View pointerEvents="none" collapsable={false} style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.aperture, apertureStyle]}>
        <Animated.View testID="gacha-capsule-frames" style={[styles.frame, capsuleStyle]}>
          <Animated.Image
            source={ATLAS_IMAGE}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode="stretch"
            fadeDuration={0}
            onLoad={handleLoad}
            onError={handleError}
            style={[styles.sheet, sheetStyle]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  aperture: { position: "absolute", overflow: "hidden", backgroundColor: seed.color.background.transparent },
  frame: {
    position: "absolute",
    left: 0,
    top: 0,
    width: ATLAS.frameWidth,
    height: ATLAS.frameHeight,
    overflow: "hidden",
  },
  sheet: {
    position: "absolute",
    left: 0,
    top: 0,
    width: ATLAS.columns * ATLAS.frameWidth,
    height: ATLAS.rows * ATLAS.frameHeight,
  },
});
