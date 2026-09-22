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
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { seed } from "@/design-system/seed";
import {
  GACHA_AGITATION_DURATION_MS,
  GACHA_CAPSULE_REVEAL_DURATION_MS,
  GACHA_CHAMBER_CAPSULES,
  GACHA_CHAMBER_HEIGHT,
  GACHA_CHAMBER_WIDTH,
  resolveGachaAgitationPulseCount,
  sampleGachaAgitatorMotion,
  sampleGachaCapsuleDispenseMotion,
  sampleGachaCapsuleMotion,
  sampleGachaCapsuleRevealMotion,
  type GachaChamberCapsuleConfig,
  type GachaCapsuleTone,
} from "@/features/draw/gacha-capsule-motion";
import { GachaCapsuleVisual } from "@/features/draw/GachaCapsuleVisual";
import { GachaCapsuleFrames } from "@/features/draw/GachaCapsuleFrames";
import { GachaPrizeReveal } from "@/features/draw/GachaPrizeReveal";
import { GachaCapsuleGlow } from "@/features/draw/GachaCapsuleGlow";
import { sampleGachaBowlProjection } from "@/features/draw/gacha-bowl-projection";
import {
  sampleGachaDropImpact,
  sampleGachaRevealLighting,
  sampleGachaRevealOptics,
} from "@/features/draw/gacha-reveal-timeline";
import type { DrawResult } from "@/features/draw/draw-reveal-api";
import {
  GACHA_CAPSULE_DISPENSE_DURATION_MS as CAPSULE_DISPENSE_DURATION_MS,
  GACHA_PICKUP_GEOMETRY,
  sampleGachaCameraMotion,
  sampleGachaPickupMotion,
} from "@/features/draw/gacha-camera-motion";
import {
  GACHA_LEVER_TARGET_RADIANS,
  advanceGachaLeverRadians,
  advanceGachaLeverTapRadians,
  createGachaLeverMotionState,
  isGachaLeverComplete,
  resolveGachaLeverPointAngle,
  resolveGachaLeverTouchStart,
  transitionGachaLeverMotion,
  type GachaLeverMotionEvent,
  type GachaLeverMotionPhase,
} from "@/features/draw/gacha-lever-motion";
import { useGachaRevealAudio } from "@/features/draw/useGachaRevealAudio";
import { colors } from "@/theme";

type GachaLeverMachineProps = {
  disabled?: boolean;
  settled?: boolean;
  reduceMotion: boolean;
  soundEnabled: boolean;
  resultReady: boolean;
  requestSignal?: number;
  resetSignal?: number;
  onRequestOpen: () => void;
  onRevealSettled: () => void;
  prize?: { result: DrawResult | null; imageUri?: string | null; ipName?: string; previewLabel?: string };
};

const MACHINE_WIDTH = 190;
const MACHINE_HEIGHT = 338;
const MACHINE_SLOT_HEIGHT = 390;
const LEVER_CENTER_X = MACHINE_WIDTH * 0.5;
const LEVER_CENTER_Y = MACHINE_HEIGHT * 0.6365;
const GESTURE_SIZE = 160;
const GESTURE_CENTER = GESTURE_SIZE / 2;
const GESTURE_MIN_RADIUS = 28;
const GESTURE_MAX_RADIUS = 78;
const GESTURE_TAP_SLOP = 8;
const CRANK_PLATE_SIZE = 41;
const CRANK_HANDLE_WIDTH = 31;
const CRANK_HANDLE_HEIGHT = 16;
const LEVER_CUE_ORBIT_SIZE = CRANK_PLATE_SIZE + 14;
const LEVER_CUE_ARROW_WIDTH = 12;
const LEVER_CUE_ARROW_HEIGHT = 8;
const LEVER_CUE_ROTATION_DURATION_MS = 2600;
const smoothEasing = Easing.bezier(0.16, 0.82, 0.28, 1);

const GACHA_MACHINE = require("../../../assets/draw/gacha/capsule-machine-front-empty.png");
const DABBOBA_WORDMARK = require("../../../assets/brand/dabboba-wordmark.png");
const GACHA_CRANK_PLATE = require("../../../../../public/assets/dabboba/draw/gacha/capsule-crank-plate-clean.png");
const GACHA_CRANK_HANDLE = require("../../../../../public/assets/dabboba/draw/gacha/capsule-crank-handle-thick-straight.png");
const DISPENSED_CAPSULE = GACHA_CHAMBER_CAPSULES.find((capsule) => capsule.isDispenseCapsule)
  ?? GACHA_CHAMBER_CAPSULES[GACHA_CHAMBER_CAPSULES.length - 1]!;

export function GachaLeverMachine({
  disabled = false,
  settled = false,
  reduceMotion,
  soundEnabled,
  resultReady,
  requestSignal = 0,
  resetSignal = 0,
  onRequestOpen,
  onRevealSettled,
  prize,
}: GachaLeverMachineProps) {
  const [phase, setPhase] = useState<GachaLeverMotionPhase>("ready");
  // Camera and capsule share the measured native stage, never a guessed size.
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const leverRadians = useSharedValue(0);
  const interactionRadians = useSharedValue(0);
  const previousAngle = useSharedValue(Number.NaN);
  const gestureStartRadians = useSharedValue(0);
  const gestureTravel = useSharedValue(0);
  const gestureAccepted = useSharedValue(0);
  const gestureEnded = useSharedValue(0);
  const gestureCompleted = useSharedValue(0);
  const waitingPulse = useSharedValue(0);
  const dispenseProgress = useSharedValue(0);
  const revealProgress = useSharedValue(0);
  const revealActive = useSharedValue(0);
  const capsuleRendererReady = useSharedValue(0);
  // The pre-rendered 3D shell and scenery use one native UI-thread clock.
  const cameraProgress = revealProgress;
  const animationRun = useSharedValue(0);
  const agitationProgress = useSharedValue(1);
  const triggeredPulseCount = useSharedValue(0);
  const clockwiseCueRotation = useSharedValue(0);
  const clockwiseCueOpacity = useSharedValue(1);
  const leverSoundPlayed = useSharedValue(0);
  const {
    cancelScheduled: cancelRevealSounds,
    playLever: playLeverSound,
    scheduleDispense: scheduleDispenseSounds,
  } = useGachaRevealAudio(soundEnabled);
  const motionStateRef = useRef(createGachaLeverMotionState(reduceMotion));
  const dispatchRef = useRef<(event: GachaLeverMotionEvent) => void>(() => undefined);
  const requestOpenRef = useRef(onRequestOpen);
  const revealSettledRef = useRef(onRevealSettled);
  const requestSignalRef = useRef(requestSignal);
  const resetSignalRef = useRef(resetSignal);
  const mountedRef = useRef(true);

  requestOpenRef.current = onRequestOpen;
  revealSettledRef.current = onRevealSettled;

  const handleRevealSettled = useCallback((finished: boolean, run: number) => {
    if (!mountedRef.current || run !== animationRun.value) return;
    dispatchRef.current({ type: "dispense-settled", finished });
  }, [animationRun]);

  const dispatchMotion = useCallback((event: GachaLeverMotionEvent) => {
    const transition = transitionGachaLeverMotion(motionStateRef.current, event);
    motionStateRef.current = transition.state;
    setPhase(transition.state.phase);

    if (transition.effect === "request-result") {
      requestOpenRef.current();
      return;
    }

    if (transition.effect === "start-dispense") {
      const run = animationRun.value;
      scheduleDispenseSounds();
      cancelAnimation(waitingPulse);
      waitingPulse.value = 0;
      dispenseProgress.value = 0;
      revealProgress.value = 0;
      revealActive.value = 1;
      revealProgress.value = withDelay(
        CAPSULE_DISPENSE_DURATION_MS,
        withTiming(
          1,
          {
            duration: GACHA_CAPSULE_REVEAL_DURATION_MS,
            easing: Easing.linear,
          },
          (finished) => {
            "worklet";
            scheduleOnRN(handleRevealSettled, Boolean(finished), run);
          },
        ),
      );
      dispenseProgress.value = withTiming(
        1,
        { duration: CAPSULE_DISPENSE_DURATION_MS, easing: Easing.linear },
      );
      return;
    }

    if (transition.effect === "notify-settled") {
      cancelRevealSounds();
      cancelAnimation(waitingPulse);
      cancelAnimation(dispenseProgress);
      cancelAnimation(revealProgress);
      cancelAnimation(revealActive);
      waitingPulse.value = 0;
      dispenseProgress.value = 1;
      revealProgress.value = 1;
      revealSettledRef.current();
      return;
    }

    if (transition.effect === "reset") {
      cancelRevealSounds();
      animationRun.value += 1;
      cancelAnimation(leverRadians);
      cancelAnimation(waitingPulse);
      cancelAnimation(dispenseProgress);
      cancelAnimation(revealProgress);
      cancelAnimation(revealActive);
      cancelAnimation(agitationProgress);
      cancelAnimation(clockwiseCueRotation);
      leverRadians.value = 0;
      interactionRadians.value = 0;
      previousAngle.value = Number.NaN;
      gestureStartRadians.value = 0;
      gestureTravel.value = 0;
      gestureAccepted.value = 0;
      gestureEnded.value = 0;
      gestureCompleted.value = 0;
      waitingPulse.value = 0;
      dispenseProgress.value = 0;
      revealProgress.value = 0;
      revealActive.value = 0;
      agitationProgress.value = 1;
      triggeredPulseCount.value = 0;
      clockwiseCueRotation.value = 0;
      clockwiseCueOpacity.value = 1;
      leverSoundPlayed.value = 0;
    }
  }, [agitationProgress, animationRun, cancelRevealSounds, clockwiseCueOpacity, clockwiseCueRotation, dispenseProgress, gestureAccepted, gestureCompleted, gestureEnded, gestureStartRadians, gestureTravel, handleRevealSettled, interactionRadians, leverRadians, leverSoundPlayed, previousAngle, revealActive, revealProgress, scheduleDispenseSounds, triggeredPulseCount, waitingPulse]);

  dispatchRef.current = dispatchMotion;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRevealSounds();
      animationRun.value += 1;
    };
  }, [animationRun, cancelRevealSounds]);

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

  // Keep the same preloaded prize view alive through completion and SKIP.
  useEffect(() => {
    if (!settled) return;
    cancelRevealSounds();
    animationRun.value += 1;
    cancelAnimation(revealProgress);
    cancelAnimation(dispenseProgress);
    cancelAnimation(waitingPulse);
    revealActive.value = 0;
    revealProgress.value = 1;
    dispenseProgress.value = 1;
    waitingPulse.value = 0;
    motionStateRef.current = { ...motionStateRef.current, phase: "revealed" };
    setPhase("revealed");
  }, [animationRun, cancelRevealSounds, dispenseProgress, revealActive, revealProgress, settled, waitingPulse]);

  useEffect(() => {
    if (resetSignalRef.current === resetSignal) return;
    resetSignalRef.current = resetSignal;
    animationRun.value += 1;
    motionStateRef.current = createGachaLeverMotionState(reduceMotion);
    setPhase("ready");
    cancelAnimation(leverRadians);
    cancelAnimation(waitingPulse);
    cancelAnimation(dispenseProgress);
    cancelAnimation(revealProgress);
    cancelAnimation(revealActive);
    cancelAnimation(agitationProgress);
    cancelAnimation(clockwiseCueRotation);
    leverRadians.value = 0;
    interactionRadians.value = 0;
    previousAngle.value = Number.NaN;
    gestureStartRadians.value = 0;
    gestureTravel.value = 0;
    gestureAccepted.value = 0;
    gestureEnded.value = 0;
    gestureCompleted.value = 0;
    waitingPulse.value = 0;
    dispenseProgress.value = 0;
    revealProgress.value = 0;
    revealActive.value = 0;
    agitationProgress.value = 1;
    triggeredPulseCount.value = 0;
    clockwiseCueRotation.value = 0;
    clockwiseCueOpacity.value = 1;
    leverSoundPlayed.value = 0;
    cancelRevealSounds();
  }, [agitationProgress, animationRun, cancelRevealSounds, clockwiseCueOpacity, clockwiseCueRotation, dispenseProgress, gestureAccepted, gestureCompleted, gestureEnded, gestureStartRadians, gestureTravel, interactionRadians, leverRadians, leverSoundPlayed, previousAngle, reduceMotion, resetSignal, revealActive, revealProgress, triggeredPulseCount, waitingPulse]);

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
    cancelAnimation(revealProgress);
    cancelAnimation(revealActive);
    cancelAnimation(agitationProgress);
    cancelAnimation(clockwiseCueRotation);
  }, [agitationProgress, clockwiseCueRotation, dispenseProgress, leverRadians, revealActive, revealProgress, waitingPulse]);

  const beginOpen = useCallback((run: number) => {
    if (!mountedRef.current || run !== animationRun.value || disabled || motionStateRef.current.phase !== "ready") return;
    interactionRadians.value = GACHA_LEVER_TARGET_RADIANS;
    leverRadians.value = GACHA_LEVER_TARGET_RADIANS;
    dispatchRef.current({ type: "request" });
  }, [animationRun, disabled, interactionRadians, leverRadians]);

  const autoCompleteLever = useCallback(() => {
    if (disabled || motionStateRef.current.phase !== "ready" || gestureCompleted.value) return;
    const run = animationRun.value;
    cancelAnimation(clockwiseCueRotation);
    clockwiseCueOpacity.value = 0;
    leverSoundPlayed.value = 1;
    playLeverSound();
    gestureCompleted.value = 1;
    interactionRadians.value = GACHA_LEVER_TARGET_RADIANS;
    if (reduceMotion) {
      leverRadians.value = GACHA_LEVER_TARGET_RADIANS;
      beginOpen(run);
      return;
    }
    leverRadians.value = withTiming(GACHA_LEVER_TARGET_RADIANS,
      { duration: 1180, easing: smoothEasing },
      (finished) => {
        "worklet";
        if (finished) scheduleOnRN(beginOpen, run);
      },
    );
  }, [animationRun, beginOpen, clockwiseCueOpacity, clockwiseCueRotation, disabled, gestureCompleted, interactionRadians, leverRadians, leverSoundPlayed, playLeverSound, reduceMotion]);

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
      gestureAccepted.value = 0;
      gestureEnded.value = 0;
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
      cancelAnimation(leverRadians);
      clockwiseCueOpacity.value = 0;
      leverRadians.value = interactionRadians.value;
      gestureStartRadians.value = interactionRadians.value;
      gestureTravel.value = 0;
      gestureAccepted.value = 1;
      previousAngle.value = start.angle ?? Number.NaN;
      gestureCompleted.value = 0;
      if (leverSoundPlayed.value === 0) {
        leverSoundPlayed.value = 1;
        scheduleOnRN(playLeverSound);
      }
      manager.activate();
    })
    .onTouchesUp((_event, manager) => {
      if (gestureAccepted.value) manager.end();
    })
    .onUpdate((event) => {
      if (gestureCompleted.value) return;
      gestureTravel.value = Math.max(
        gestureTravel.value,
        Math.sqrt(event.translationX * event.translationX + event.translationY * event.translationY),
      );
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
        interactionRadians.value,
        previousAngle.value,
        nextAngle,
      );
      previousAngle.value = nextAngle;
      interactionRadians.value = nextRadians;
      leverRadians.value = nextRadians;
      if (isGachaLeverComplete(nextRadians)) {
        gestureCompleted.value = 1;
        const run = animationRun.value;
        leverRadians.value = withTiming(GACHA_LEVER_TARGET_RADIANS,
          { duration: reduceMotion ? 0 : 130, easing: smoothEasing },
          (finished) => {
            "worklet";
            if (finished) scheduleOnRN(beginOpen, run);
          },
        );
      }
    })
    .onFinalize((_event, success) => {
      previousAngle.value = Number.NaN;
      if (gestureEnded.value) return;
      gestureEnded.value = 1;
      const accepted = gestureAccepted.value;
      gestureAccepted.value = 0;
      if (!accepted || gestureCompleted.value) return;
      // A stationary manually activated iOS pan can end before ACTIVE, so its
      // successful finalization owns taps as well as the completed drag release.
      if (success && gestureTravel.value <= GESTURE_TAP_SLOP) {
        const nextRadians = advanceGachaLeverTapRadians(gestureStartRadians.value);
        interactionRadians.value = nextRadians;
        if (isGachaLeverComplete(nextRadians)) {
          gestureCompleted.value = 1;
          const run = animationRun.value;
          interactionRadians.value = GACHA_LEVER_TARGET_RADIANS;
          leverRadians.value = withTiming(
            GACHA_LEVER_TARGET_RADIANS,
            { duration: reduceMotion ? 0 : 130, easing: smoothEasing },
            (finished) => {
              "worklet";
              if (finished) scheduleOnRN(beginOpen, run);
            },
          );
          return;
        }
        leverRadians.value = reduceMotion
          ? nextRadians
          : withTiming(nextRadians, { duration: 110, easing: smoothEasing });
        return;
      }
      interactionRadians.value = gestureStartRadians.value;
      leverRadians.value = reduceMotion
        ? gestureStartRadians.value
        : withTiming(gestureStartRadians.value, { duration: 220, easing: smoothEasing });
    }), [animationRun, beginOpen, clockwiseCueOpacity, clockwiseCueRotation, disabled, gestureAccepted, gestureCompleted, gestureEnded, gestureStartRadians, gestureTravel, interactionRadians, leverRadians, leverSoundPlayed, phase, playLeverSound, previousAngle, reduceMotion]);

  const clockwiseCueStyle = useAnimatedStyle(() => ({
    opacity: clockwiseCueOpacity.value * 0.9,
    transform: [{ rotate: `${clockwiseCueRotation.value * 360}deg` }],
  }));
  const leverStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(leverRadians.value * 180) / Math.PI}deg` }],
  }));
  const machineMotionStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return {
      opacity: camera.machineOpacity,
      transform: [
        { translateX: camera.translateX + waitingPulse.value * 1.5 },
        { translateY: camera.translateY },
        { rotate: `${waitingPulse.value * 0.22}deg` },
        { scale: camera.presentationScale * camera.scale },
      ],
    };
  });
  const capsuleStyle = useAnimatedStyle(() => {
    const pickup = sampleGachaPickupMotion(dispenseProgress.value, reduceMotion);
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return {
      opacity: pickup.opacity * (1 - camera.overlayOpacity) * (1 - capsuleRendererReady.value),
      transform: [{ translateX: pickup.x }, { translateY: pickup.y }, { rotate: `${pickup.rotation}deg` }],
    };
  });
  const dispenseShadowStyle = useAnimatedStyle(() => {
    const pickup = sampleGachaPickupMotion(dispenseProgress.value, reduceMotion);
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return { opacity: pickup.shadowOpacity * (1 - camera.overlayOpacity), transform: [{ translateX: pickup.x }] };
  });

  const busy = phase !== "ready" && phase !== "revealed";
  const statusLabel = phase === "waiting-result"
    ? "결과 확인 중"
    : phase === "dispensing"
      ? "캡슐 배출 중"
      : "레버 돌리기";

  return (
    <View collapsable={false} style={styles.container}>
      <View collapsable={false} style={styles.machineSlot} onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setStageSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}>
        <Animated.View
          pointerEvents={settled ? "none" : "auto"}
          accessibilityElementsHidden={settled}
          importantForAccessibility={settled ? "no-hide-descendants" : "auto"}
          style={[styles.machine, machineMotionStyle, settled && { opacity: 0 }]}
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
            <Animated.View style={[styles.dispenseCapsuleShadow, dispenseShadowStyle]} />
            <Animated.View style={[styles.dispensedCapsule, capsuleStyle]}>
              <GachaCapsuleVisual
                tone={DISPENSED_CAPSULE.tone}
                depth={DISPENSED_CAPSULE.depth}
                diameter={GACHA_PICKUP_GEOMETRY.capsuleSize}
                heroDetail
              />
            </Animated.View>
          </View>
          <GachaDropImpact progress={dispenseProgress} reduceMotion={reduceMotion} />

          <GestureDetector gesture={interactionGesture}>
            <Animated.View
              accessible
              accessibilityRole="button"
              accessibilityLabel={busy ? `가챠 레버, ${statusLabel}` : "가챠 레버 돌리기"}
              accessibilityHint="레버를 6회 연속 터치하거나 둘레를 시계 방향으로 한 바퀴 드래그합니다"
              accessibilityState={{ disabled, busy }}
              onAccessibilityTap={autoCompleteLever}
              style={styles.leverTouchTarget}
            >
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
                  <Svg
                    width={LEVER_CUE_ARROW_WIDTH}
                    height={LEVER_CUE_ARROW_HEIGHT}
                    viewBox="0 0 12 8"
                    style={styles.leverRotationArrow}
                  >
                    <Path d="M 0 2.5 H 7 V 0 L 12 4 L 7 8 V 5.5 H 0 Z" fill={colors.brand} />
                  </Svg>
                </Animated.View>
              ) : null}
            </Animated.View>
          </GestureDetector>
        </Animated.View>
        <GachaCapsuleCinematic
          revealProgress={revealProgress}
          revealActive={revealActive}
          dispenseProgress={dispenseProgress}
          capsuleRendererReady={capsuleRendererReady}
          cameraProgress={cameraProgress}
          reduceMotion={reduceMotion}
          tone={DISPENSED_CAPSULE.tone}
          stageSize={stageSize}
          prize={prize}
          settled={settled}
        />
      </View>
    </View>
  );
}

function GachaDropImpact({
  progress,
  reduceMotion,
}: {
  progress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const reflectionStyle = useAnimatedStyle(() => {
    const impact = sampleGachaDropImpact(progress.value, reduceMotion);
    return {
      opacity: impact.reflectionOpacity,
      transform: [{ scaleX: impact.reflectionScaleX }, { scaleY: impact.reflectionScaleY }],
    };
  });
  if (reduceMotion) return null;

  return (
    <View testID="gacha-drop-impact" pointerEvents="none" style={styles.dropImpactField}>
      <Animated.View style={[styles.dropImpactReflection, reflectionStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="gacha-floor-reflection" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#F7FFF2" stopOpacity="0.82" />
              <Stop offset="0.42" stopColor="#C9F7C7" stopOpacity="0.34" />
              <Stop offset="1" stopColor="#8BE38F" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="200" height="200" fill="url(#gacha-floor-reflection)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

function GachaCapsuleCinematic({
  revealProgress,
  revealActive,
  dispenseProgress,
  capsuleRendererReady,
  cameraProgress,
  reduceMotion,
  tone,
  stageSize,
  prize,
  settled,
}: {
  revealProgress: SharedValue<number>;
  revealActive: SharedValue<number>;
  dispenseProgress: SharedValue<number>;
  capsuleRendererReady: SharedValue<number>;
  cameraProgress: SharedValue<number>;
  reduceMotion: boolean;
  tone: GachaCapsuleTone;
  stageSize: { width: number; height: number };
  prize: GachaLeverMachineProps["prize"];
  settled: boolean;
}) {
  const [threeReady, setThreeReady] = useState(false);
  const [threeUnavailable, setThreeUnavailable] = useState(false);
  const handleThreeReady = useCallback(() => {
    setThreeReady(true);
    capsuleRendererReady.value = 1;
  }, [capsuleRendererReady]);
  const handleThreeUnavailable = useCallback(() => {
    setThreeReady(false);
    setThreeUnavailable(true);
    capsuleRendererReady.value = 0;
  }, [capsuleRendererReady]);
  useEffect(() => {
    if (reduceMotion) {
      capsuleRendererReady.value = 0;
      setThreeReady(false);
    }
    return () => { capsuleRendererReady.value = 0; };
  }, [capsuleRendererReady, reduceMotion]);
  const stageDimStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : revealActive.value * 0.84 * interpolate(
      cameraProgress.value, [0, 0.2, 0.52, 1], [0, 0, 1, 1], Extrapolation.CLAMP,
    ),
  }));
  const pickupForegroundStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return {
      opacity: revealActive.value * camera.machineOpacity,
      transform: [
        { translateX: camera.translateX },
        { translateY: camera.translateY },
        { scale: camera.presentationScale * camera.scale },
      ],
    };
  });
  const capsuleMotionStyle = useAnimatedStyle(() => {
    const frame = sampleGachaCapsuleRevealMotion(revealProgress.value, reduceMotion);
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return {
      opacity: revealActive.value * camera.overlayOpacity * sampleGachaRevealLighting(revealProgress.value, reduceMotion).shellOpacity,
      transform: [
        { translateX: camera.capsuleX - stageSize.width / 2 + frame.capsuleTranslateX },
        { translateY: camera.capsuleY - stageSize.height / 2 + frame.capsuleTranslateY },
        { rotate: `${frame.capsuleRotateDeg}deg` },
        { scale: camera.capsuleDiameter / 200 },
      ],
    };
  });
  const upperStyle = useAnimatedStyle(() => {
    const frame = sampleGachaCapsuleRevealMotion(revealProgress.value, reduceMotion);
    return {
      transform: [
        { translateX: frame.upperTranslateX },
        { translateY: frame.upperTranslateY },
        { rotate: `${frame.upperRotateDeg}deg` },
      ],
    };
  });
  const lowerStyle = useAnimatedStyle(() => {
    const frame = sampleGachaCapsuleRevealMotion(revealProgress.value, reduceMotion);
    return {
      transform: [
        { translateX: frame.lowerTranslateX },
        { translateY: frame.lowerTranslateY },
        { rotate: `${frame.lowerRotateDeg}deg` },
      ],
    };
  });
  const lightWashStyle = useAnimatedStyle(() => {
    const light = sampleGachaRevealLighting(revealProgress.value, reduceMotion);
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    const source = sampleGachaBowlProjection(revealProgress.value, camera, false);
    return {
      opacity: revealActive.value * light.whiteout,
      transform: [
        { translateX: source.x - stageSize.width / 2 },
        { translateY: source.y - stageSize.height / 2 },
        { scale: interpolate(light.whiteout, [0, 1], [0.04, Math.max(stageSize.width, stageSize.height) / 55], Extrapolation.CLAMP) },
      ],
    };
  });
  const heroShadowStyle = useAnimatedStyle(() => {
    const camera = sampleGachaCameraMotion(cameraProgress.value, stageSize.width, stageSize.height, reduceMotion);
    return {
      opacity: revealActive.value * interpolate(
        revealProgress.value,
        [0, 0.25, 0.34, 0.7, 0.8, 1],
        [0, 0, 0.48, 0.4, 0, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        { translateX: camera.capsuleX - stageSize.width / 2 },
        { translateY: camera.capsuleY - stageSize.height / 2 + camera.capsuleDiameter * 0.49 },
        { scaleX: camera.capsuleDiameter / 200 * 0.92 },
        { scaleY: interpolate(revealProgress.value, [0, 0.34, 0.8], [0.26, 1, 0.76], Extrapolation.CLAMP) },
      ],
    };
  });
  const closedCapsuleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      revealProgress.value,
      [0, 0.16, 0.20],
      [1, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const splitCapsuleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      revealProgress.value,
      [0, 0.16, 0.20],
      [0, 0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={styles.cinematicLayer}
    >
      <Animated.View style={[styles.cinematicDim, stageDimStyle]} />
      <GachaRevealOptics
        progress={revealProgress}
        active={revealActive}
        stageSize={stageSize}
        reduceMotion={reduceMotion}
      />
      <GachaCapsuleGlow
        progress={revealProgress}
        active={revealActive}
        stageSize={stageSize}
        reduceMotion={reduceMotion}
      />
      {/* Preload once and retain the decoded atlas through NEXT and completion. */}
      {!threeUnavailable && !reduceMotion && stageSize.width > 0 && stageSize.height > 0 ? (
        <View collapsable={false} style={styles.cinematicThree}>
          <GachaCapsuleFrames
            progress={revealProgress}
            dispenseProgress={dispenseProgress}
            active={revealActive}
            viewportSize={stageSize}
            reduceMotion={reduceMotion}
            tone={tone}
            onReady={handleThreeReady}
            onUnavailable={handleThreeUnavailable}
          />
        </View>
      ) : null}
      <View style={[styles.cinematicFallback, { opacity: threeReady || settled ? 0 : 1 }]}>
        <Animated.View style={[styles.cinematicShadowOuter, heroShadowStyle]} />
        <Animated.View style={[styles.cinematicShadowCore, heroShadowStyle]} />
        <Animated.View
          testID="gacha-capsule-cinematic"
          style={[styles.cinematicCapsule, capsuleMotionStyle]}
        >
          <Animated.View style={[styles.cinematicCapsuleLayer, closedCapsuleStyle]}>
            <GachaCapsuleVisual tone={tone} depth={2} heroDetail />
          </Animated.View>
          <Animated.View style={[styles.cinematicCapsuleLayer, splitCapsuleStyle]}>
            <GachaCapsuleVisual
              tone={tone}
              depth={2}
              split
              heroDetail
              upperStyle={upperStyle}
              lowerStyle={lowerStyle}
            />
          </Animated.View>
        </Animated.View>
      </View>
      <Animated.View style={[styles.pickupForegroundMachine, pickupForegroundStyle]}>
        <View style={styles.pickupForegroundCrop}>
          <Image source={GACHA_MACHINE} resizeMode="contain" style={styles.pickupForegroundArt} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.capsuleLightWash, lightWashStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="capsule-inside-light" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FCFCF8" stopOpacity="0.96" />
              <Stop offset="0.18" stopColor="#FCFCF8" stopOpacity="0.88" />
              <Stop offset="0.52" stopColor="#FCFCF8" stopOpacity="0.48" />
              <Stop offset="1" stopColor="#FCFCF8" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="200" height="200" fill="url(#capsule-inside-light)" />
        </Svg>
      </Animated.View>
      <View style={styles.prizeLayer}>
        <GachaPrizeReveal
          settled={settled}
          progress={revealProgress}
          reduceMotion={reduceMotion}
          result={prize?.result ?? null}
          imageUri={prize?.imageUri}
          ipName={prize?.ipName}
          previewLabel={prize?.previewLabel}
        />
      </View>
    </View>
  );
}

function GachaRevealOptics({
  progress,
  active,
  stageSize,
  reduceMotion,
}: {
  progress: SharedValue<number>;
  active: SharedValue<number>;
  stageSize: { width: number; height: number };
  reduceMotion: boolean;
}) {
  const { width, height } = stageSize;
  const sourceTransform = (scale: number) => {
    "worklet";
    const camera = sampleGachaCameraMotion(progress.value, width, height, false);
    const source = sampleGachaBowlProjection(progress.value, camera, false);
    return [
      { translateX: source.x - width / 2 },
      { translateY: source.y - height / 2 },
      { scale: camera.capsuleDiameter / 200 * scale },
    ];
  };
  const innerBloomStyle = useAnimatedStyle(() => {
    const effect = sampleGachaRevealOptics(progress.value, reduceMotion);
    return {
      opacity: active.value * effect.innerBloomOpacity,
      transform: sourceTransform(effect.innerBloomScale),
    };
  });
  const diffusionStyle = useAnimatedStyle(() => {
    const effect = sampleGachaRevealOptics(progress.value, reduceMotion);
    return {
      opacity: active.value * effect.diffusionOpacity,
      transform: sourceTransform(effect.diffusionScale),
    };
  });
  const lensHazeStyle = useAnimatedStyle(() => {
    const effect = sampleGachaRevealOptics(progress.value, reduceMotion);
    return {
      opacity: active.value * effect.lensHazeOpacity,
      transform: sourceTransform(effect.lensHazeScale),
    };
  });
  if (reduceMotion || width <= 0 || height <= 0) return null;

  return (
    <View testID="gacha-reveal-optics" pointerEvents="none" style={styles.revealOpticsField}>
      <Animated.View style={[styles.revealOpticalPlane, styles.revealLensHaze, lensHazeStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="gacha-lens-haze" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFDF2" stopOpacity="0.46" />
              <Stop offset="0.46" stopColor="#EEF8E7" stopOpacity="0.18" />
              <Stop offset="1" stopColor="#DFF2DA" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="200" height="200" fill="url(#gacha-lens-haze)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.revealOpticalPlane, styles.revealDiffusion, diffusionStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="gacha-light-diffusion" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.76" />
              <Stop offset="0.34" stopColor="#F2FFED" stopOpacity="0.46" />
              <Stop offset="0.72" stopColor="#B7EBB6" stopOpacity="0.12" />
              <Stop offset="1" stopColor="#B7EBB6" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="200" height="200" fill="url(#gacha-light-diffusion)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.revealOpticalPlane, styles.revealInnerBloom, innerBloomStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="gacha-inner-bloom" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
              <Stop offset="0.24" stopColor="#FBFFF5" stopOpacity="0.72" />
              <Stop offset="0.58" stopColor="#D4F7D0" stopOpacity="0.2" />
              <Stop offset="1" stopColor="#B1E8AF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="200" height="200" fill="url(#gacha-inner-bloom)" />
        </Svg>
      </Animated.View>
    </View>
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
    ? 0.36
    : capsule.depth === 1
      ? 0.23
      : 0.12;
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
          left: capsule.left + capsule.size * 0.20,
          top: capsule.top + capsule.size * 0.78,
          width: capsule.size * 0.78,
          height: capsule.depth === 2 ? 2.8 : capsule.depth === 1 ? 2.2 : 1.6,
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
      // Keep each simple shell opaque: front capsules occlude, not blend with,
      // the rear pile. Existing face shading and local contact shadows give depth.
      opacity: dispenseFrame.opacity,
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
          shadowOpacity: capsule.depth === 2 ? 0.34 : capsule.depth === 1 ? 0.22 : 0.12,
          shadowRadius: capsule.depth === 2 ? 1.5 : capsule.depth === 1 ? 1.1 : 0.7,
        },
        motionStyle,
      ]}
    >
      <GachaCapsuleVisual tone={capsule.tone} depth={capsule.depth} diameter={capsule.size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", flex: 1, minHeight: MACHINE_SLOT_HEIGHT, alignItems: "center", justifyContent: "center" },
  machineSlot: { width: "100%", flex: 1, minHeight: MACHINE_SLOT_HEIGHT, alignItems: "center", justifyContent: "center" },
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
    ...StyleSheet.absoluteFill,
    zIndex: 0,
    backgroundColor: "rgba(3, 8, 6, 0.28)",
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
    shadowOffset: { width: 0.65, height: 1.1 },
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
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderRadius: 999,
    borderColor: "rgba(255, 255, 255, 0.17)",
  },
  chamberCapsuleDepthShade: {
    ...StyleSheet.absoluteFill,
    borderRadius: 999,
    backgroundColor: "#08100B",
  },
  chamberGlassTint: {
    ...StyleSheet.absoluteFill,
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
    borderRadius: seed.radius.r2,
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
    ...StyleSheet.absoluteFill,
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
    // Only the off-center arrow is visible; this box shares the crank's pivot.
    left: GESTURE_CENTER - LEVER_CUE_ORBIT_SIZE / 2,
    top: GESTURE_CENTER - LEVER_CUE_ORBIT_SIZE / 2,
    width: LEVER_CUE_ORBIT_SIZE,
    height: LEVER_CUE_ORBIT_SIZE,
  },
  leverRotationArrow: {
    position: "absolute",
    left: (LEVER_CUE_ORBIT_SIZE - LEVER_CUE_ARROW_WIDTH) / 2,
    top: -LEVER_CUE_ARROW_HEIGHT / 2,
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
    left: GESTURE_CENTER - CRANK_HANDLE_WIDTH / 2,
    top: GESTURE_CENTER - CRANK_HANDLE_HEIGHT / 2,
    width: CRANK_HANDLE_WIDTH,
    height: CRANK_HANDLE_HEIGHT,
  },
  dispenseTrack: {
    position: "absolute",
    zIndex: 2,
    left: GACHA_PICKUP_GEOMETRY.left,
    top: GACHA_PICKUP_GEOMETRY.top,
    width: GACHA_PICKUP_GEOMETRY.width,
    height: GACHA_PICKUP_GEOMETRY.height,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    overflow: "hidden",
  },
  dispensedCapsule: {
    position: "absolute",
    zIndex: 2,
    left: GACHA_PICKUP_GEOMETRY.restLeft,
    top: GACHA_PICKUP_GEOMETRY.restTop,
    width: GACHA_PICKUP_GEOMETRY.capsuleSize,
    height: GACHA_PICKUP_GEOMETRY.capsuleSize,
    borderRadius: 9,
  },
  dispenseCapsuleShadow: {
    position: "absolute",
    zIndex: 1,
    left: 2,
    top: 25,
    width: 20,
    height: 3,
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
  },
  dropImpactField: {
    position: "absolute",
    zIndex: 3,
    left: 101,
    top: 263,
    width: 42,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dropImpactReflection: {
    width: 42,
    height: 18,
  },
  cinematicLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  cinematicCapsule: {
    zIndex: 2,
    width: 200,
    height: 200,
  },
  cinematicThree: { ...StyleSheet.absoluteFill, zIndex: 3 },
  // Reuse the real artwork lip as foreground scenery above the GL shell.
  // A transparent GL surface alone cannot occlude itself behind machine art.
  pickupForegroundMachine: {
    position: "absolute", zIndex: 4, left: "50%", top: "50%",
    width: MACHINE_WIDTH, height: MACHINE_HEIGHT,
    marginLeft: -MACHINE_WIDTH / 2, marginTop: -MACHINE_HEIGHT / 2,
  },
  pickupForegroundCrop: {
    position: "absolute", left: 107, top: 267, width: 28, height: 11, overflow: "hidden",
  },
  pickupForegroundArt: {
    position: "absolute", left: -107, top: -267, width: MACHINE_WIDTH, height: MACHINE_HEIGHT,
  },
  cinematicFallback: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 2 },
  cinematicDim: {
    position: "absolute", left: -40, right: -40, top: -390, bottom: -390,
    backgroundColor: "#060906", zIndex: 0,
  },
  revealOpticsField: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  revealOpticalPlane: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 260,
    height: 260,
    marginLeft: -130,
    marginTop: -130,
  },
  revealLensHaze: {
    zIndex: 1,
    width: 560,
    height: 560,
    marginLeft: -280,
    marginTop: -280,
  },
  revealDiffusion: {
    zIndex: 2,
    width: 420,
    height: 420,
    marginLeft: -210,
    marginTop: -210,
  },
  revealInnerBloom: { zIndex: 3 },
  cinematicCapsuleLayer: {
    ...StyleSheet.absoluteFill,
  },
  cinematicShadowOuter: {
    position: "absolute",
    zIndex: 1,
    left: "50%",
    top: "50%",
    width: 108,
    height: 20,
    marginLeft: -54,
    marginTop: -10,
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(2, 6, 3, 0.28)",
  },
  cinematicShadowCore: {
    position: "absolute",
    zIndex: 1,
    left: "50%",
    top: "50%",
    width: 84,
    height: 12,
    marginLeft: -42,
    marginTop: -6,
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.52)",
  },
  capsuleLightWash: {
    position: "absolute", left: "50%", top: "50%", marginLeft: -100, marginTop: -100,
    width: 200, height: 200, zIndex: 5,
  },
  prizeLayer: { ...StyleSheet.absoluteFill, zIndex: 6 },
});
