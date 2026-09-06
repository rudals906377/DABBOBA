import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  DRAW_MOTION,
  createKujiOpenMotionState,
  resolveKujiDragProgress,
  resolveKujiPeelRelease,
  resolveKujiTravelDuration,
  transitionKujiOpenMotion,
  type KujiOpenMotionEvent,
  type KujiOpenMotionPhase,
} from "@/features/draw/draw-reveal-state";
import {
  isKujiResultGateOpen,
  sampleKujiTicketRevealMotion,
} from "@/features/draw/kuji-ticket-reveal-motion";
import { colors } from "@/theme";

type KujiPeelTicketProps = {
  ticketNumber?: string;
  total?: number;
  disabled?: boolean;
  reduceMotion: boolean;
  resultReady: boolean;
  resultLabel?: string;
  settled?: boolean;
  resultContent?: ReactNode;
  requestSignal?: number;
  resetSignal?: number;
  onRequestOpen: () => void;
  onRevealSettled: () => void;
};

const smoothFinishEasing = Easing.bezier(0.2, 0, 0, 1);
const smoothEmphasisEasing = Easing.bezier(0.16, 0.82, 0.28, 1);
const returnSpring = {
  damping: 23,
  stiffness: 230,
  mass: 0.8,
  overshootClamping: true,
} as const;
const DABBOBA_WORDMARK = require("../../../assets/dabboba-wordmark.png");
const KUJI_TICKET_OUTER_LAYER = require("../../../assets/kuji-ticket-outer-layer.png");
const KUJI_TICKET_PEEL_LAYER = require("../../../assets/kuji-ticket-peel-layer.png");
const KUJI_TICKET_GLOW = require("../../../assets/gacha-capsule-glow-v1.png");

export function KujiPeelTicket({
  ticketNumber,
  total,
  disabled = false,
  reduceMotion,
  resultReady,
  resultLabel = "RESULT",
  settled = false,
  resultContent,
  requestSignal = 0,
  resetSignal = 0,
  onRequestOpen,
  onRevealSettled,
}: KujiPeelTicketProps) {
  const [ticketWidth, setTicketWidth] = useState(0);
  const [phase, setPhase] = useState<KujiOpenMotionPhase>("sealed");
  const dragProgress = useSharedValue(0);
  const impactProgress = useSharedValue(0);
  const entryProgress = useSharedValue(reduceMotion ? 1 : 0);
  const pressed = useSharedValue(0);
  const cuePulse = useSharedValue(0);
  const gestureEnded = useSharedValue(0);
  const motionStateRef = useRef(createKujiOpenMotionState(reduceMotion));
  const runGenerationRef = useRef(0);
  const dispatchRef = useRef<(event: KujiOpenMotionEvent) => void>(() => undefined);
  const requestOpenRef = useRef(onRequestOpen);
  const revealSettledRef = useRef(onRevealSettled);
  const requestSignalRef = useRef(requestSignal);
  const resetSignalRef = useRef(resetSignal);

  requestOpenRef.current = onRequestOpen;
  revealSettledRef.current = onRevealSettled;

  const handleTravelSettled = useCallback((generation: number, finished: boolean) => {
    if (generation !== runGenerationRef.current) return;
    dispatchRef.current({ type: "travel-settled", finished });
  }, []);

  const handleImpactSettled = useCallback((generation: number, finished: boolean) => {
    if (generation !== runGenerationRef.current) return;
    dispatchRef.current({ type: "impact-settled", finished });
  }, []);

  const dispatchMotion = useCallback((event: KujiOpenMotionEvent) => {
    const transition = transitionKujiOpenMotion(motionStateRef.current, event);
    motionStateRef.current = transition.state;
    setPhase(transition.state.phase);

    if (transition.effect === "request-and-animate") {
      const generation = runGenerationRef.current + 1;
      runGenerationRef.current = generation;
      requestOpenRef.current();
      dragProgress.value = withTiming(
        1,
        {
          duration: resolveKujiTravelDuration(dragProgress.value),
          easing: smoothFinishEasing,
        },
        (finished) => {
          "worklet";
          scheduleOnRN(handleTravelSettled, generation, Boolean(finished));
        },
      );
      return;
    }

    if (transition.effect === "request-and-wait") {
      runGenerationRef.current += 1;
      dragProgress.value = 1;
      requestOpenRef.current();
      return;
    }

    if (transition.effect === "start-impact") {
      const generation = runGenerationRef.current;
      dragProgress.value = 1;
      impactProgress.value = 0;
      impactProgress.value = withTiming(
        1,
        { duration: DRAW_MOTION.kujiImpactMs, easing: Easing.linear },
        (finished) => {
          "worklet";
          scheduleOnRN(handleImpactSettled, generation, Boolean(finished));
        },
      );
      return;
    }

    if (transition.effect === "notify-settled") {
      impactProgress.value = 1;
      revealSettledRef.current();
      return;
    }

    if (transition.effect === "reset") {
      runGenerationRef.current += 1;
      cancelAnimation(dragProgress);
      cancelAnimation(impactProgress);
      dragProgress.value = withSpring(0, returnSpring);
      impactProgress.value = 0;
    }
  }, [dragProgress, handleImpactSettled, handleTravelSettled, impactProgress]);

  dispatchRef.current = dispatchMotion;

  useEffect(() => {
    dispatchRef.current({ type: "reduce-motion", enabled: reduceMotion });
  }, [reduceMotion]);

  useEffect(() => {
    if (resultReady) dispatchRef.current({ type: "result-ready" });
  }, [resultReady]);

  useEffect(() => {
    if (resetSignalRef.current === resetSignal) return;
    resetSignalRef.current = resetSignal;
    runGenerationRef.current += 1;
    motionStateRef.current = createKujiOpenMotionState(reduceMotion);
    setPhase("sealed");
    cancelAnimation(dragProgress);
    cancelAnimation(impactProgress);
    dragProgress.value = 0;
    impactProgress.value = 0;
  }, [dragProgress, impactProgress, reduceMotion, resetSignal]);

  useEffect(() => {
    cancelAnimation(entryProgress);
    if (reduceMotion) {
      entryProgress.value = 1;
      return;
    }
    entryProgress.value = 0;
    entryProgress.value = withTiming(1, {
      duration: DRAW_MOTION.kujiEntryMs,
      easing: smoothEmphasisEasing,
    });
    return () => cancelAnimation(entryProgress);
  }, [entryProgress, reduceMotion, resetSignal]);

  useEffect(() => () => {
    runGenerationRef.current += 1;
    cancelAnimation(dragProgress);
    cancelAnimation(impactProgress);
    cancelAnimation(cuePulse);
    cancelAnimation(entryProgress);
  }, [cuePulse, dragProgress, entryProgress, impactProgress]);

  useEffect(() => {
    cancelAnimation(cuePulse);
    if (reduceMotion || phase !== "sealed") {
      cuePulse.value = 0;
      return;
    }
    cuePulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: DRAW_MOTION.kujiCueHalfCycleMs, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: DRAW_MOTION.kujiCueHalfCycleMs, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    return () => cancelAnimation(cuePulse);
  }, [cuePulse, phase, reduceMotion]);

  const beginOpen = useCallback(() => {
    if (disabled || motionStateRef.current.phase !== "sealed") return;
    dispatchRef.current({ type: "request" });
  }, [disabled]);

  useEffect(() => {
    if (requestSignalRef.current === requestSignal) return;
    requestSignalRef.current = requestSignal;
    beginOpen();
  }, [beginOpen, requestSignal]);

  const interactionGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(!disabled && phase === "sealed")
      .activeOffsetX(8)
      .failOffsetY([-14, 14])
      .onBegin(() => {
        gestureEnded.value = 0;
        pressed.value = 1;
      })
      .onUpdate((event) => {
        dragProgress.value = resolveKujiDragProgress(event.translationX, ticketWidth);
      })
      .onEnd((event) => {
        gestureEnded.value = 1;
        const decision = resolveKujiPeelRelease(
          event.translationX,
          ticketWidth,
          event.velocityX / 1000,
        );
        if (decision === "open") scheduleOnRN(beginOpen);
        else dragProgress.value = withSpring(0, returnSpring);
      })
      .onFinalize(() => {
        pressed.value = 0;
        if (!gestureEnded.value) dragProgress.value = withSpring(0, returnSpring);
      });
    const tap = Gesture.Tap()
      .enabled(!disabled && phase === "sealed")
      .onBegin(() => {
        pressed.value = 1;
      })
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(beginOpen);
      })
      .onFinalize(() => {
        pressed.value = 0;
      });
    return Gesture.Race(pan, tap);
  }, [beginOpen, disabled, dragProgress, gestureEnded, phase, pressed, ticketWidth]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: interpolate(entryProgress.value, [0, 0.22, 1], [0.62, 1, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(entryProgress.value, [0, 1], [8, 0], Extrapolation.CLAMP) },
      { scale: interpolate(entryProgress.value, [0, 1], [0.975, 1], Extrapolation.CLAMP) },
    ],
  }));

  const peelLayerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragProgress.value, [0.82, 1], [1, 0.12], Extrapolation.CLAMP),
    transform: [
      { translateX: dragProgress.value * (ticketWidth + 34) },
      { rotate: `${interpolate(dragProgress.value, [0, 1], [0, 2])}deg` },
      { scale: interpolate(pressed.value, [0, 1], [1, 0.99]) },
    ],
  }));
  const resultGateOpen = isKujiResultGateOpen(phase, resultReady, settled);
  const ticketRevealStyle = useAnimatedStyle(() => ({
    opacity: sampleKujiTicketRevealMotion(
      impactProgress.value,
      resultGateOpen,
      reduceMotion,
    ).ticketOpacity,
  }));
  const resultRevealStyle = useAnimatedStyle(() => ({
    opacity: sampleKujiTicketRevealMotion(
      impactProgress.value,
      resultGateOpen,
      reduceMotion,
    ).resultOpacity,
  }));
  const glowStyle = useAnimatedStyle(() => {
    const frame = sampleKujiTicketRevealMotion(
      impactProgress.value,
      resultGateOpen,
      reduceMotion,
    );
    return {
      opacity: frame.glowOpacity,
      transform: [{ scale: frame.glowScale }],
    };
  });
  const peelEdgeGlowStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? 0
      : interpolate(
          dragProgress.value,
          [0, 0.04, 0.72, 1],
          [0, 0.34, 0.46, 0],
          Extrapolation.CLAMP,
        ),
    transform: [{
      translateX: dragProgress.value * (ticketWidth + 34) - 18,
    }],
  }));
  const pullArrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(cuePulse.value, [0, 1], [0, 5]) }],
  }));

  const primaryLabel = total
    ? `${total} TICKETS`
    : ticketNumber
      ? `NO. ${ticketNumber}`
      : "SEALED";
  const accessibilityLabel = total
    ? `선택한 쿠지 ${total}장 열기`
    : ticketNumber
      ? `${ticketNumber}번 쿠지 열기`
      : "쿠지 열기";
  const busy = phase !== "sealed" && phase !== "revealed";
  const resultAccessible = resultGateOpen && settled;

  return (
    <View style={styles.revealStage}>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden={!resultAccessible}
        importantForAccessibility={resultAccessible ? "auto" : "no-hide-descendants"}
        style={[styles.resultContentLayer, resultRevealStyle]}
      >
        {resultContent ?? (
          <View style={styles.resultFallback}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.resultFallbackLabel}>
              {resultLabel}
            </Text>
            <Text style={styles.resultFallbackSerial}>{primaryLabel}</Text>
          </View>
        )}
      </Animated.View>

      <GestureDetector gesture={interactionGesture}>
        <Animated.View
          accessible={!settled}
          accessibilityRole="button"
          accessibilityLabel={busy ? `${accessibilityLabel}, 결과 확인 중` : accessibilityLabel}
          accessibilityHint="두 번 탭하거나 왼쪽 손잡이를 오른쪽으로 밀어 엽니다"
          accessibilityState={{ disabled, busy }}
          onAccessibilityTap={beginOpen}
          style={[styles.pressTarget, entryStyle]}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={(event) => setTicketWidth(event.nativeEvent.layout.width)}
            style={styles.ticketFrame}
          >
            <View collapsable={false} pointerEvents="none" style={styles.ticketGlowClip}>
              <Animated.Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={KUJI_TICKET_GLOW}
                style={[styles.ticketPayoffGlow, {
                  left: ticketWidth * 0.14,
                  top: (ticketWidth / 1.46 - ticketWidth * 0.72) / 2,
                  width: ticketWidth * 0.72,
                  height: ticketWidth * 0.72,
                }, glowStyle]}
              />
              <Animated.Image
                accessibilityIgnoresInvertColors
                resizeMode="stretch"
                source={KUJI_TICKET_GLOW}
                style={[styles.ticketPeelEdgeGlow, {
                  top: -ticketWidth / 1.46 * 0.05,
                  height: ticketWidth / 1.46 * 1.1,
                }, peelEdgeGlowStyle]}
              />
            </View>
            <Animated.View collapsable={false} pointerEvents="none" style={[styles.ticketSurface, ticketRevealStyle]}>
              <View style={styles.ticketShell}>
                <View pointerEvents="none" style={styles.ticketOuterLayer}>
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="stretch"
                    source={KUJI_TICKET_OUTER_LAYER}
                    style={styles.ticketLayerImage}
                  />
                  <View style={styles.tearEdge}>
                    {Array.from({ length: 10 }, (_, index) => (
                      <View key={index} style={styles.tearTooth} />
                    ))}
                  </View>
                </View>
                <Animated.View style={[styles.ticketPeelLayer, peelLayerStyle]}>
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="stretch"
                    source={KUJI_TICKET_PEEL_LAYER}
                    style={styles.ticketLayerImage}
                  />
                  <View style={styles.ticketCopy}>
                    <Image
                      accessibilityIgnoresInvertColors
                      resizeMode="contain"
                      source={DABBOBA_WORDMARK}
                      style={styles.ticketWordmark}
                    />
                    <Text style={styles.ticketNumber}>{primaryLabel}</Text>
                  </View>
                  <View pointerEvents="none" style={styles.pullArrowWindow}>
                    <View style={styles.pullArrowEraserShaft} />
                    <View style={styles.pullArrowEraserHead} />
                    <Animated.View style={[styles.pullArrowMotion, pullArrowStyle]}>
                      <View style={styles.pullArrowShaftOutline} />
                      <View style={styles.pullArrowHeadOutline} />
                      <View style={styles.pullArrowShaftFill} />
                      <View style={styles.pullArrowHeadFill} />
                    </Animated.View>
                  </View>
                </Animated.View>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const KUJI_ORANGE = "#F36B2C";
const KUJI_ORANGE_DARK = "#A83C15";

const styles = StyleSheet.create({
  revealStage: {
    flex: 1,
    width: "100%",
    minHeight: 432,
    alignItems: "center",
    justifyContent: "center",
  },
  resultContentLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  resultFallback: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  resultFallbackLabel: {
    maxWidth: "90%",
    color: colors.brand,
    fontFamily: "Galmuri11",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "400",
    textAlign: "center",
  },
  resultFallbackSerial: {
    marginTop: seed.spacing.x2,
    color: colors.white,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.7,
  },
  pressTarget: {
    width: "100%",
    maxWidth: 316,
    minHeight: seed.size.touchTarget,
    zIndex: 3,
  },
  ticketFrame: {
    width: "100%",
    aspectRatio: 1.46,
  },
  ticketGlowClip: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
    borderRadius: seed.radius.r3,
    zIndex: 3,
  },
  ticketPayoffGlow: {
    position: "absolute",
    tintColor: "#FFF8E7",
  },
  ticketPeelEdgeGlow: {
    position: "absolute",
    left: 0,
    width: 44,
    tintColor: "#FFF4DA",
  },
  ticketSurface: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  ticketShell: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: seed.radius.r3,
    borderWidth: 4,
    borderColor: KUJI_ORANGE_DARK,
    backgroundColor: KUJI_ORANGE,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  ticketOuterLayer: {
    ...StyleSheet.absoluteFill,
    margin: 4,
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
  ticketPeelLayer: {
    ...StyleSheet.absoluteFill,
    margin: 4,
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 7,
  },
  ticketLayerImage: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
  },
  tearEdge: {
    position: "absolute",
    left: -3,
    top: 10,
    bottom: 10,
    width: 11,
    justifyContent: "space-around",
  },
  tearTooth: {
    width: 9,
    height: 9,
    backgroundColor: "#FFF7E9",
    transform: [{ rotate: "45deg" }],
  },
  ticketCopy: {
    width: "58%",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateX: 4 }],
  },
  ticketWordmark: {
    width: 112,
    height: 17,
  },
  ticketNumber: {
    marginTop: seed.spacing.x2,
    color: colors.white,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.7,
  },
  pullArrowWindow: {
    position: "absolute",
    left: "3.5%",
    top: "36.5%",
    width: "14%",
    height: "19%",
    zIndex: 1,
  },
  pullArrowMotion: {
    ...StyleSheet.absoluteFill,
  },
  pullArrowEraserShaft: {
    position: "absolute",
    left: -1,
    top: 10,
    width: 27,
    height: 20,
    borderRadius: 5,
    backgroundColor: "#FFFFFF",
  },
  pullArrowEraserHead: {
    position: "absolute",
    left: 19,
    top: 1,
    width: 0,
    height: 0,
    borderTopWidth: 19,
    borderBottomWidth: 19,
    borderLeftWidth: 21,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#FFFFFF",
  },
  pullArrowShaftOutline: {
    position: "absolute",
    left: 0,
    top: 14,
    width: 25,
    height: 12,
    borderRadius: 2,
    backgroundColor: "#2B241F",
  },
  pullArrowHeadOutline: {
    position: "absolute",
    left: 21,
    top: 8,
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderLeftWidth: 14,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#2B241F",
  },
  pullArrowShaftFill: {
    position: "absolute",
    left: 1,
    top: 15,
    width: 23,
    height: 10,
    borderRadius: 1,
    backgroundColor: KUJI_ORANGE,
  },
  pullArrowHeadFill: {
    position: "absolute",
    left: 22,
    top: 10,
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 12,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: KUJI_ORANGE,
  },
});
