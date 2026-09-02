import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { seed } from "@/design-system/seed";
import {
  GACHA_AGITATION_DURATION_MS,
  GACHA_CHAMBER_CAPSULES,
  GACHA_CHAMBER_HEIGHT,
  GACHA_CHAMBER_WIDTH,
  resolveGachaAgitationPulseCount,
  sampleGachaAgitatorMotion,
  sampleGachaCapsuleDispenseMotion,
  sampleGachaCapsuleMotion,
  type GachaChamberCapsuleConfig,
} from "@/features/draw/gacha-capsule-motion";
import {
  GACHA_LEVER_TARGET_RADIANS,
  advanceGachaLeverRadians,
  createGachaLeverMotionState,
  isGachaLeverComplete,
  resolveGachaLeverPointAngle,
  resolveGachaLeverTouchStart,
  transitionGachaLeverMotion,
  type GachaLeverMotionEvent,
  type GachaLeverMotionPhase,
} from "@/features/draw/gacha-lever-motion";
import { colors } from "@/theme";

type GachaLeverMachineProps = {
  disabled?: boolean;
  reduceMotion: boolean;
  resultReady: boolean;
  requestSignal?: number;
  resetSignal?: number;
  onRequestOpen: () => void;
  onRevealSettled: () => void;
};

const MACHINE_WIDTH = 190;
const MACHINE_HEIGHT = 338;
const MACHINE_PRESENTATION_SCALE = 1.58;
const MACHINE_SLOT_HEIGHT = 390;
const LEVER_CENTER_X = MACHINE_WIDTH * 0.5;
const LEVER_CENTER_Y = MACHINE_HEIGHT * 0.6365;
const GESTURE_SIZE = 160;
const GESTURE_CENTER = GESTURE_SIZE / 2;
const GESTURE_MIN_RADIUS = 28;
const GESTURE_MAX_RADIUS = 78;
const CRANK_PLATE_SIZE = 41;
const LEVER_CUE_ICON_SIZE = 34;
const LEVER_CUE_ROTATION_DURATION_MS = 2600;
const smoothEasing = Easing.bezier(0.16, 0.82, 0.28, 1);

const GACHA_MACHINE = require("../../../assets/capsule-machine-front-empty.png");
const DABBOBA_WORDMARK = require("../../../assets/dabboba-wordmark.png");
const GACHA_CRANK_PLATE = require("../../../../../public/assets/dabboba/capsule-crank-plate-pixel.png");
const GACHA_CRANK_HANDLE = require("../../../../../public/assets/dabboba/capsule-crank-pixel.png");

export function GachaLeverMachine({
  disabled = false,
  reduceMotion,
  resultReady,
  requestSignal = 0,
  resetSignal = 0,
  onRequestOpen,
  onRevealSettled,
}: GachaLeverMachineProps) {
  const [phase, setPhase] = useState<GachaLeverMotionPhase>("ready");
  const leverRadians = useSharedValue(0);
  const previousAngle = useSharedValue(Number.NaN);
  const gestureCompleted = useSharedValue(0);
  const waitingPulse = useSharedValue(0);
  const dispenseProgress = useSharedValue(0);
  const entryProgress = useSharedValue(reduceMotion ? 1 : 0);
  const agitationProgress = useSharedValue(1);
  const triggeredPulseCount = useSharedValue(0);
  const clockwiseCueRotation = useSharedValue(0);
  const clockwiseCueOpacity = useSharedValue(1);
  const motionStateRef = useRef(createGachaLeverMotionState(reduceMotion));
  const dispatchRef = useRef<(event: GachaLeverMotionEvent) => void>(() => undefined);
  const requestOpenRef = useRef(onRequestOpen);
  const revealSettledRef = useRef(onRevealSettled);
  const requestSignalRef = useRef(requestSignal);
  const resetSignalRef = useRef(resetSignal);
  const mountedRef = useRef(true);

  requestOpenRef.current = onRequestOpen;
  revealSettledRef.current = onRevealSettled;

  const handleDispenseSettled = useCallback((finished: boolean) => {
    if (!mountedRef.current) return;
    dispatchRef.current({ type: "dispense-settled", finished });
  }, []);

  const dispatchMotion = useCallback((event: GachaLeverMotionEvent) => {
    const transition = transitionGachaLeverMotion(motionStateRef.current, event);
    motionStateRef.current = transition.state;
    setPhase(transition.state.phase);

    if (transition.effect === "request-result") {
      requestOpenRef.current();
      return;
    }

    if (transition.effect === "start-dispense") {
      cancelAnimation(waitingPulse);
      waitingPulse.value = 0;
      dispenseProgress.value = 0;
      dispenseProgress.value = withTiming(
        1,
        { duration: 940, easing: smoothEasing },
        (finished) => {
          "worklet";
          scheduleOnRN(handleDispenseSettled, Boolean(finished));
        },
      );
      return;
    }

    if (transition.effect === "notify-settled") {
      cancelAnimation(waitingPulse);
      cancelAnimation(dispenseProgress);
      waitingPulse.value = 0;
      dispenseProgress.value = 1;
      revealSettledRef.current();
      return;
    }

    if (transition.effect === "reset") {
      cancelAnimation(leverRadians);
      cancelAnimation(waitingPulse);
      cancelAnimation(dispenseProgress);
      cancelAnimation(agitationProgress);
      cancelAnimation(clockwiseCueRotation);
      leverRadians.value = 0;
      previousAngle.value = Number.NaN;
      gestureCompleted.value = 0;
      waitingPulse.value = 0;
      dispenseProgress.value = 0;
      agitationProgress.value = 1;
      triggeredPulseCount.value = 0;
      clockwiseCueRotation.value = 0;
      clockwiseCueOpacity.value = 1;
    }
  }, [agitationProgress, clockwiseCueOpacity, clockwiseCueRotation, dispenseProgress, gestureCompleted, handleDispenseSettled, leverRadians, previousAngle, triggeredPulseCount, waitingPulse]);

  dispatchRef.current = dispatchMotion;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    dispatchRef.current({ type: "reduce-motion", enabled: reduceMotion });
    if (!reduceMotion) return;
    cancelAnimation(agitationProgress);
    agitationProgress.value = 1;
    triggeredPulseCount.value = 0;
  }, [agitationProgress, reduceMotion, triggeredPulseCount]);

  useAnimatedReaction(
    () => ({
      radians: leverRadians.value,
      pulseCount: resolveGachaAgitationPulseCount(leverRadians.value),
    }),
    (drive) => {
      if (reduceMotion) return;
      if (drive.radians <= 0.001) {
        triggeredPulseCount.value = 0;
        return;
      }
      if (drive.pulseCount <= triggeredPulseCount.value) return;
      triggeredPulseCount.value = drive.pulseCount;
      cancelAnimation(agitationProgress);
      agitationProgress.value = 0;
      agitationProgress.value = withTiming(1, {
        duration: GACHA_AGITATION_DURATION_MS,
        easing: Easing.linear,
      });
    },
    [reduceMotion],
  );

  useEffect(() => {
    if (resultReady) dispatchRef.current({ type: "result-ready" });
  }, [resultReady]);

  useEffect(() => {
    if (resetSignalRef.current === resetSignal) return;
    resetSignalRef.current = resetSignal;
    motionStateRef.current = createGachaLeverMotionState(reduceMotion);
    setPhase("ready");
    cancelAnimation(leverRadians);
    cancelAnimation(waitingPulse);
    cancelAnimation(dispenseProgress);
    cancelAnimation(agitationProgress);
    cancelAnimation(clockwiseCueRotation);
    leverRadians.value = 0;
    previousAngle.value = Number.NaN;
    gestureCompleted.value = 0;
    waitingPulse.value = 0;
    dispenseProgress.value = 0;
    agitationProgress.value = 1;
    triggeredPulseCount.value = 0;
    clockwiseCueRotation.value = 0;
    clockwiseCueOpacity.value = 1;
  }, [agitationProgress, clockwiseCueOpacity, clockwiseCueRotation, dispenseProgress, gestureCompleted, leverRadians, previousAngle, reduceMotion, resetSignal, triggeredPulseCount, waitingPulse]);

  useEffect(() => {
    cancelAnimation(entryProgress);
    if (reduceMotion) {
      entryProgress.value = 1;
      return;
    }
    entryProgress.value = 0;
    entryProgress.value = withTiming(1, { duration: 340, easing: smoothEasing });
    return () => cancelAnimation(entryProgress);
  }, [entryProgress, reduceMotion, resetSignal]);

  useEffect(() => {
    cancelAnimation(clockwiseCueRotation);
    clockwiseCueRotation.value = 0;
    if (reduceMotion || phase !== "ready" || clockwiseCueOpacity.value <= 0) return;
    clockwiseCueRotation.value = withRepeat(
      withTiming(1, { duration: LEVER_CUE_ROTATION_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(clockwiseCueRotation);
  }, [clockwiseCueOpacity, clockwiseCueRotation, phase, reduceMotion, resetSignal]);

  useEffect(() => {
    cancelAnimation(waitingPulse);
    if (reduceMotion || phase !== "waiting-result") {
      waitingPulse.value = 0;
      return;
    }
    waitingPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 180, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1, { duration: 360, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 180, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(waitingPulse);
  }, [phase, reduceMotion, waitingPulse]);

  useEffect(() => () => {
    cancelAnimation(leverRadians);
    cancelAnimation(waitingPulse);
    cancelAnimation(dispenseProgress);
    cancelAnimation(entryProgress);
    cancelAnimation(agitationProgress);
    cancelAnimation(clockwiseCueRotation);
  }, [agitationProgress, clockwiseCueRotation, dispenseProgress, entryProgress, leverRadians, waitingPulse]);

  const beginOpen = useCallback(() => {
    if (disabled || motionStateRef.current.phase !== "ready") return;
    leverRadians.value = GACHA_LEVER_TARGET_RADIANS;
    dispatchRef.current({ type: "request" });
  }, [disabled, leverRadians]);

  const autoCompleteLever = useCallback(() => {
    if (disabled || motionStateRef.current.phase !== "ready" || gestureCompleted.value) return;
    cancelAnimation(clockwiseCueRotation);
    clockwiseCueOpacity.value = 0;
    gestureCompleted.value = 1;
    if (reduceMotion) {
      leverRadians.value = GACHA_LEVER_TARGET_RADIANS;
      beginOpen();
      return;
    }
    leverRadians.value = withTiming(GACHA_LEVER_TARGET_RADIANS,
      { duration: 1180, easing: smoothEasing },
      (finished) => {
        "worklet";
        if (finished) scheduleOnRN(beginOpen);
      },
    );
  }, [beginOpen, clockwiseCueOpacity, clockwiseCueRotation, disabled, gestureCompleted, leverRadians, reduceMotion]);

  useEffect(() => {
    if (requestSignalRef.current === requestSignal) return;
    requestSignalRef.current = requestSignal;
    autoCompleteLever();
  }, [autoCompleteLever, requestSignal]);

  const interactionGesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled && phase === "ready")
    .manualActivation(true)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) {
        manager.fail();
        return;
      }
      const start = resolveGachaLeverTouchStart(
        touch.x,
        touch.y,
        GESTURE_CENTER,
        GESTURE_CENTER,
        GESTURE_MIN_RADIUS,
        GESTURE_MAX_RADIUS,
      );
      if (!start.accepted) {
        manager.fail();
        return;
      }
      cancelAnimation(clockwiseCueRotation);
      clockwiseCueOpacity.value = 0;
      previousAngle.value = start.angle ?? Number.NaN;
      gestureCompleted.value = 0;
      manager.activate();
    })
    .onUpdate((event) => {
      if (gestureCompleted.value) return;
      const nextAngle = resolveGachaLeverPointAngle(event.x, event.y, GESTURE_CENTER, GESTURE_CENTER, GESTURE_MIN_RADIUS, GESTURE_MAX_RADIUS);
      if (nextAngle === null) {
        previousAngle.value = Number.NaN;
        return;
      }
      if (!Number.isFinite(previousAngle.value)) {
        previousAngle.value = nextAngle;
        return;
      }
      const nextRadians = advanceGachaLeverRadians(
        leverRadians.value,
        previousAngle.value,
        nextAngle,
      );
      previousAngle.value = nextAngle;
      leverRadians.value = nextRadians;
      if (isGachaLeverComplete(nextRadians)) {
        gestureCompleted.value = 1;
        leverRadians.value = withTiming(GACHA_LEVER_TARGET_RADIANS,
          { duration: reduceMotion ? 0 : 130, easing: smoothEasing },
          (finished) => {
            "worklet";
            if (finished) scheduleOnRN(beginOpen);
          },
        );
      }
    })
    .onFinalize(() => {
      previousAngle.value = Number.NaN;
      if (gestureCompleted.value) return;
      leverRadians.value = reduceMotion
        ? 0
        : withTiming(0, { duration: 220, easing: smoothEasing });
    }), [beginOpen, clockwiseCueOpacity, clockwiseCueRotation, disabled, gestureCompleted, leverRadians, phase, previousAngle, reduceMotion]);

  const clockwiseCueStyle = useAnimatedStyle(() => ({
    opacity: clockwiseCueOpacity.value * 0.9,
    transform: [{ rotate: `${clockwiseCueRotation.value * 360}deg` }],
  }));
  const leverStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(leverRadians.value * 180) / Math.PI}deg` }],
  }));
  const entryStyle = useAnimatedStyle(() => ({
    opacity: interpolate(entryProgress.value, [0, 0.24, 1], [0.45, 1, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(entryProgress.value, [0, 1], [10, 0], Extrapolation.CLAMP) },
      { scale: interpolate(entryProgress.value, [0, 1], [0.97, 1], Extrapolation.CLAMP) },
    ],
  }));
  const machineMotionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: waitingPulse.value * 1.5 },
      { rotate: `${waitingPulse.value * 0.22}deg` },
      { scale: MACHINE_PRESENTATION_SCALE },
    ],
  }));
  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dispenseProgress.value,
      [0, 0.56, 0.62, 0.88, 1],
      [0, 0, 1, 1, 0],
      Extrapolation.CLAMP,
    ),
    transform: [
      { translateY: interpolate(dispenseProgress.value, [0, 0.56, 0.8, 1], [-24, -24, 13, 15], Extrapolation.CLAMP) },
      { rotate: `${interpolate(dispenseProgress.value, [0.56, 0.8], [-18, 4], Extrapolation.CLAMP)}deg` },
      { scale: interpolate(dispenseProgress.value, [0, 0.56, 0.65, 0.8, 1], [0.82, 0.82, 1, 1, 1.08], Extrapolation.CLAMP) },
    ],
  }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dispenseProgress.value, [0.68, 0.82, 1], [0, 0.42, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(dispenseProgress.value, [0.68, 1], [0.75, 1.35], Extrapolation.CLAMP) }],
  }));

  const busy = phase !== "ready" && phase !== "revealed";
  const statusLabel = phase === "waiting-result"
    ? "결과 확인 중"
    : phase === "dispensing"
      ? "캡슐 배출 중"
      : "레버 돌리기";

  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={busy ? `가챠 레버, ${statusLabel}` : "가챠 레버 돌리기"}
      accessibilityHint="레버 둘레를 시계 방향으로 두 바퀴 돌립니다"
      accessibilityState={{ disabled, busy }}
      onAccessibilityTap={autoCompleteLever}
      style={[styles.container, entryStyle]}
    >
      <View style={styles.machineSlot}>
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.machine, machineMotionStyle]}
        >
          <Image source={GACHA_MACHINE} resizeMode="contain" style={styles.machineArt} />
          <View pointerEvents="none" style={styles.machineMarquee}>
            <Image
              source={DABBOBA_WORDMARK}
              resizeMode="contain"
              style={styles.machineMarqueeWordmark}
            />
          </View>
          <View pointerEvents="none" style={styles.capsuleChamber}>
            <View style={styles.chamberBackDepth} />
            <View style={styles.chamberTopDepth} />
            <View style={styles.chamberSideDepthLeft} />
            <View style={styles.chamberSideDepthRight} />
            <View style={styles.chamberFloorDepth} />
            <GachaChamberAgitator
              impulseProgress={agitationProgress}
              reduceMotion={reduceMotion}
            />
            {GACHA_CHAMBER_CAPSULES.map((capsule) => (
              <GachaCapsuleContactShadow
                key={`${capsule.id}-shadow`}
                capsule={capsule}
                impulseProgress={agitationProgress}
                dispenseProgress={dispenseProgress}
                reduceMotion={reduceMotion}
              />
            ))}
            {GACHA_CHAMBER_CAPSULES.map((capsule) => (
              <GachaChamberCapsule
                key={capsule.id}
                capsule={capsule}
                impulseProgress={agitationProgress}
                dispenseProgress={dispenseProgress}
                reduceMotion={reduceMotion}
              />
            ))}
            <View style={styles.chamberGlassTint} />
            <View style={styles.chamberGlassReflection} />
            <View style={styles.chamberGlassReflectionThin} />
            <View style={styles.chamberFrontLip} />
            <View style={styles.chamberInnerStroke} />
          </View>
          <View pointerEvents="none" style={styles.dispenseTrack}>
            <Animated.View style={[styles.dispenseBloom, bloomStyle]} />
            <Animated.View style={[styles.dispensedCapsule, capsuleStyle]}>
              <View style={styles.capsuleUpper} />
              <View style={styles.capsuleLower} />
              <View style={styles.capsuleSeam} />
            </Animated.View>
          </View>
          <View pointerEvents="none" style={styles.receivingLip} />

          <GestureDetector gesture={interactionGesture}>
            <Animated.View style={styles.leverTouchTarget}>
              <Image source={GACHA_CRANK_PLATE} resizeMode="contain" style={styles.crankPlate} />
              <Animated.Image
                source={GACHA_CRANK_HANDLE}
                resizeMode="contain"
                style={[styles.crankHandle, leverStyle]}
              />
              {phase === "ready" ? (
                <Animated.View
                  testID="gacha-lever-clockwise-cue"
                  pointerEvents="none"
                  accessible={false}
                  style={[styles.leverRotationCue, clockwiseCueStyle]}
                >
                  <Ionicons name="refresh-outline" size={LEVER_CUE_ICON_SIZE} color={colors.brand} />
                </Animated.View>
              ) : null}
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function GachaChamberAgitator({
  impulseProgress,
  reduceMotion,
}: {
  impulseProgress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const agitatorStyle = useAnimatedStyle(() => {
    const frame = sampleGachaAgitatorMotion(
      impulseProgress.value,
      reduceMotion,
    );
    return {
      opacity: frame.opacity,
      transform: [
        { translateX: frame.translateX },
        { translateY: frame.translateY },
        { rotate: `${frame.rotateDeg}deg` },
        { scaleX: frame.scaleX },
      ],
    };
  });

  return (
    <Animated.View style={[styles.chamberAgitator, agitatorStyle]}>
      <View style={styles.chamberAgitatorRidge} />
      <View style={styles.chamberAgitatorHub} />
    </Animated.View>
  );
}

function GachaCapsuleContactShadow({
  capsule,
  impulseProgress,
  dispenseProgress,
  reduceMotion,
}: {
  capsule: GachaChamberCapsuleConfig;
  impulseProgress: SharedValue<number>;
  dispenseProgress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const baseShadowOpacity = capsule.depth === 2
    ? 0.24
    : capsule.depth === 1
      ? 0.15
      : 0.08;
  const shadowStyle = useAnimatedStyle(() => {
    const agitationFrame = sampleGachaCapsuleMotion(
      impulseProgress.value,
      capsule.index,
      capsule.size,
      capsule.rollDistance,
      capsule.liftHeight,
      capsule.impulseDelayMs,
      capsule.responseDurationMs,
      capsule.restRotation,
      reduceMotion,
    );
    const dispenseFrame = sampleGachaCapsuleDispenseMotion(
      dispenseProgress.value,
      capsule.isDispenseCapsule,
      capsule.dispenseX,
      capsule.dispenseY,
      capsule.settleX,
      capsule.settleY,
      reduceMotion,
    );
    const selectedShadowOpacity = capsule.isDispenseCapsule
      ? Math.max(0, 1 - dispenseProgress.value / 0.22)
      : 1;
    const lift = Math.min(Math.max(-agitationFrame.translateY, 0) / 1.4, 1);
    return {
      opacity: baseShadowOpacity * selectedShadowOpacity * (1 - lift * 0.48),
      transform: [
        {
          translateX: agitationFrame.translateX
            + (capsule.isDispenseCapsule ? 0 : dispenseFrame.translateX),
        },
        { translateY: 1.25 + (capsule.isDispenseCapsule ? 0 : dispenseFrame.translateY) + lift * 0.6 },
        { scaleX: capsule.visualScale * (1 - lift * 0.16) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.capsuleContactShadow,
        {
          left: capsule.left + capsule.size * 0.27,
          top: capsule.top + capsule.size * 0.82,
          width: capsule.size * 0.7,
          zIndex: 19 + capsule.stackOrder * 2,
        },
        shadowStyle,
      ]}
    />
  );
}

function GachaChamberCapsule({
  capsule,
  impulseProgress,
  dispenseProgress,
  reduceMotion,
}: {
  capsule: GachaChamberCapsuleConfig;
  impulseProgress: SharedValue<number>;
  dispenseProgress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const palette = capsule.tone === "lime"
    ? {
      upper: "#C9F45A",
      lower: "#78B727",
      seam: "#E9FDB0",
      border: "#3D571C",
    }
    : {
      upper: "#FFF2D0",
      lower: "#D7BB83",
      seam: "#FFF8E7",
      border: "#806F51",
    };
  const depthOpacity = capsule.depth === 2 ? 1 : capsule.depth === 1 ? 0.96 : 0.89;
  const depthShadeOpacity = capsule.depth === 2 ? 0.01 : capsule.depth === 1 ? 0.05 : 0.13;
  const highlightOpacity = capsule.depth === 2 ? 0.9 : capsule.depth === 1 ? 0.72 : 0.5;
  const motionStyle = useAnimatedStyle(() => {
    const frame = sampleGachaCapsuleMotion(
      impulseProgress.value,
      capsule.index,
      capsule.size,
      capsule.rollDistance,
      capsule.liftHeight,
      capsule.impulseDelayMs,
      capsule.responseDurationMs,
      capsule.restRotation,
      reduceMotion,
    );
    const dispenseFrame = sampleGachaCapsuleDispenseMotion(
      dispenseProgress.value,
      capsule.isDispenseCapsule,
      capsule.dispenseX,
      capsule.dispenseY,
      capsule.settleX,
      capsule.settleY,
      reduceMotion,
    );
    return {
      opacity: dispenseFrame.opacity * depthOpacity,
      transform: [
        { translateX: frame.translateX + dispenseFrame.translateX },
        { translateY: frame.translateY + dispenseFrame.translateY },
        { rotate: `${frame.rotateDeg + dispenseFrame.rotateDeltaDeg}deg` },
        { scaleX: frame.scaleX * capsule.visualScale },
        { scaleY: frame.scaleY * capsule.visualScale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.chamberCapsuleShell,
        {
          left: capsule.left,
          top: capsule.top,
          width: capsule.size,
          height: capsule.size,
          borderRadius: capsule.size / 2,
          zIndex: 20 + capsule.stackOrder * 2,
        },
        motionStyle,
      ]}
    >
      <View style={[styles.chamberCapsule, { borderColor: palette.border }]}>
        <View style={[styles.capsuleUpperHalf, { backgroundColor: palette.upper }]} />
        <View style={[styles.capsuleLowerHalf, { backgroundColor: palette.lower }]} />
        <View style={styles.chamberCapsuleLowerShade} />
        <View style={[styles.chamberCapsuleSeamShadow, { backgroundColor: palette.border }]} />
        <View style={[styles.chamberCapsuleSeam, { backgroundColor: palette.seam }]} />
        <View style={[styles.chamberCapsuleHighlight, { opacity: highlightOpacity }]} />
        <View style={[styles.chamberCapsuleHighlightPixel, { opacity: highlightOpacity * 0.72 }]} />
        <View style={styles.chamberCapsuleSideShade} />
        <View style={styles.chamberCapsuleBottomShade} />
        <View style={styles.chamberCapsuleInnerRim} />
        <View
          style={[
            styles.chamberCapsuleDepthShade,
            { opacity: depthShadeOpacity },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  machineSlot: { width: "100%", height: MACHINE_SLOT_HEIGHT, alignItems: "center", justifyContent: "center" },
  machine: { width: MACHINE_WIDTH, height: MACHINE_HEIGHT, position: "relative" },
  machineArt: { width: "100%", height: "100%" },
  machineMarquee: {
    position: "absolute",
    zIndex: 4,
    left: 55,
    top: 58,
    width: 80,
    height: 18,
    borderRadius: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#252725",
  },
  machineMarqueeWordmark: {
    width: 68,
    height: 10,
    tintColor: "#F5F5F1",
  },
  capsuleChamber: {
    position: "absolute",
    left: 46,
    top: 91,
    width: GACHA_CHAMBER_WIDTH,
    height: GACHA_CHAMBER_HEIGHT,
    overflow: "hidden",
  },
  chamberBackDepth: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    backgroundColor: "rgba(3, 8, 6, 0.2)",
  },
  chamberTopDepth: {
    position: "absolute",
    zIndex: 1,
    left: 0,
    right: 0,
    top: 0,
    height: 11,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
    backgroundColor: "rgba(1, 4, 3, 0.28)",
  },
  chamberSideDepthLeft: {
    position: "absolute",
    zIndex: 2,
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: "rgba(0, 3, 2, 0.24)",
  },
  chamberSideDepthRight: {
    position: "absolute",
    zIndex: 2,
    right: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: "rgba(0, 3, 2, 0.3)",
  },
  chamberFloorDepth: {
    position: "absolute",
    zIndex: 2,
    left: 0,
    right: 0,
    bottom: 0,
    height: 13,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "rgba(1, 5, 3, 0.34)",
  },
  chamberAgitator: {
    position: "absolute",
    zIndex: 4,
    left: 5,
    right: 5,
    bottom: 4,
    height: 7,
    borderRadius: 2,
    borderTopWidth: 1,
    borderTopColor: "rgba(145, 233, 142, 0.42)",
    backgroundColor: "rgba(26, 31, 27, 0.96)",
    overflow: "hidden",
  },
  chamberAgitatorRidge: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 2,
    height: 1,
    backgroundColor: "rgba(218, 231, 219, 0.13)",
  },
  chamberAgitatorHub: {
    position: "absolute",
    left: "50%",
    top: 1,
    width: 12,
    height: 4,
    marginLeft: -6,
    borderRadius: 2,
    backgroundColor: "rgba(9, 13, 10, 0.82)",
  },
  capsuleContactShadow: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(1, 4, 2, 0.86)",
  },
  chamberCapsuleShell: {
    position: "absolute",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 1.4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  chamberCapsule: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    borderWidth: 0.75,
    overflow: "hidden",
  },
  capsuleUpperHalf: { position: "absolute", left: 0, right: 0, top: 0, height: "52%" },
  capsuleLowerHalf: { position: "absolute", left: 0, right: 0, bottom: 0, height: "52%" },
  chamberCapsuleSeam: {
    position: "absolute",
    left: 1,
    right: 1,
    top: 8,
    height: 1,
    borderRadius: 0.5,
  },
  chamberCapsuleSeamShadow: {
    position: "absolute",
    left: 1,
    right: 1,
    top: 9,
    height: 1,
    opacity: 0.48,
  },
  chamberCapsuleHighlight: {
    position: "absolute",
    left: 4,
    top: 3,
    width: 3,
    height: 2,
    borderRadius: 0.5,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
  },
  chamberCapsuleHighlightPixel: {
    position: "absolute",
    left: 3,
    top: 6,
    width: 2,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  chamberCapsuleSideShade: {
    position: "absolute",
    right: 0,
    top: 4,
    width: 2,
    height: 8,
    backgroundColor: "rgba(9, 13, 10, 0.18)",
  },
  chamberCapsuleBottomShade: {
    position: "absolute",
    left: 3,
    right: 2,
    bottom: 0,
    height: 2,
    backgroundColor: "rgba(8, 12, 9, 0.2)",
  },
  chamberCapsuleLowerShade: {
    position: "absolute",
    right: -2,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(15, 20, 16, 0.14)",
  },
  chamberCapsuleInnerRim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: 999,
    borderColor: "rgba(255, 255, 255, 0.17)",
  },
  chamberCapsuleDepthShade: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: "#08100B",
  },
  chamberGlassTint: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    backgroundColor: "rgba(16, 22, 18, 0.09)",
  },
  chamberGlassReflection: {
    position: "absolute",
    zIndex: 201,
    left: 18,
    top: -18,
    width: 13,
    height: 132,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    transform: [{ rotate: "11deg" }],
  },
  chamberGlassReflectionThin: {
    position: "absolute",
    zIndex: 201,
    left: 38,
    top: -12,
    width: 3,
    height: 118,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    transform: [{ rotate: "11deg" }],
  },
  chamberFrontLip: {
    position: "absolute",
    zIndex: 203,
    left: 0,
    right: 0,
    bottom: 0,
    height: 7,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    backgroundColor: "rgba(5, 9, 7, 0.72)",
  },
  chamberInnerStroke: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 204,
    borderWidth: 1,
    borderColor: "rgba(236, 244, 237, 0.09)",
  },
  leverTouchTarget: {
    position: "absolute",
    left: LEVER_CENTER_X - GESTURE_CENTER,
    top: LEVER_CENTER_Y - GESTURE_CENTER,
    width: GESTURE_SIZE,
    height: GESTURE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  leverRotationCue: {
    position: "absolute",
    zIndex: 4,
    left: GESTURE_CENTER - CRANK_PLATE_SIZE / 2,
    top: GESTURE_CENTER - CRANK_PLATE_SIZE / 2,
    width: CRANK_PLATE_SIZE,
    height: CRANK_PLATE_SIZE,
    borderRadius: seed.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  crankPlate: {
    position: "absolute",
    left: GESTURE_CENTER - CRANK_PLATE_SIZE / 2,
    top: GESTURE_CENTER - CRANK_PLATE_SIZE / 2,
    width: CRANK_PLATE_SIZE,
    height: CRANK_PLATE_SIZE,
  },
  crankHandle: {
    position: "absolute",
    left: GESTURE_CENTER - 15.5,
    top: GESTURE_CENTER - 6,
    width: 31,
    height: 12,
  },
  dispenseTrack: {
    position: "absolute",
    zIndex: 2,
    left: 116,
    top: 244,
    width: 32,
    height: 44,
    overflow: "hidden",
  },
  dispensedCapsule: {
    position: "absolute",
    zIndex: 2,
    left: 5,
    top: 21,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 0.75,
    borderColor: "#3D571C",
    overflow: "hidden",
  },
  capsuleUpper: { flex: 1, backgroundColor: "#C9F45A" },
  capsuleLower: { flex: 1, backgroundColor: "#78B727" },
  capsuleSeam: { position: "absolute", left: 0, right: 0, top: 8, height: 1, backgroundColor: "#E9FDB0" },
  receivingLip: {
    position: "absolute",
    zIndex: 3,
    left: 111,
    top: 288,
    width: 39,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#151815",
    borderTopWidth: 1,
    borderTopColor: "#3A403A",
  },
  dispenseBloom: {
    position: "absolute",
    zIndex: 1,
    left: 14,
    top: 13,
    width: 4,
    height: 4,
    borderRadius: 0.5,
    backgroundColor: colors.brand,
  },
});
