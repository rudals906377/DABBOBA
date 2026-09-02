import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
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
import { colors } from "@/theme";

type KujiPeelTicketProps = {
  ticketNumber?: string;
  total?: number;
  disabled?: boolean;
  reduceMotion: boolean;
  resultReady: boolean;
  resultLabel?: string;
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
const IMPACT_PARTICLES = [
  { x: -118, y: -62, rotate: -28, size: 8 },
  { x: -92, y: 76, rotate: 18, size: 6 },
  { x: -42, y: -104, rotate: -12, size: 5 },
  { x: 38, y: -112, rotate: 26, size: 7 },
  { x: 88, y: -72, rotate: 38, size: 5 },
  { x: 122, y: 12, rotate: 52, size: 8 },
  { x: 76, y: 88, rotate: 22, size: 6 },
  { x: 8, y: 116, rotate: -18, size: 5 },
] as const;
const DABBOBA_WORDMARK = require("../../../assets/dabboba-wordmark.png");
const KUJI_TICKET_OUTER_LAYER = require("../../../assets/kuji-ticket-outer-layer.png");
const KUJI_TICKET_PEEL_LAYER = require("../../../assets/kuji-ticket-peel-layer.png");

export function KujiPeelTicket({
  ticketNumber,
  total,
  disabled = false,
  reduceMotion,
  resultReady,
  resultLabel = "RESULT",
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
  const dispatchRef = useRef<(event: KujiOpenMotionEvent) => void>(() => undefined);
  const requestOpenRef = useRef(onRequestOpen);
  const revealSettledRef = useRef(onRevealSettled);
  const requestSignalRef = useRef(requestSignal);
  const resetSignalRef = useRef(resetSignal);

  requestOpenRef.current = onRequestOpen;
  revealSettledRef.current = onRevealSettled;

  const handleTravelSettled = useCallback((finished: boolean) => {
    dispatchRef.current({ type: "travel-settled", finished });
  }, []);

  const handleImpactSettled = useCallback((finished: boolean) => {
    dispatchRef.current({ type: "impact-settled", finished });
  }, []);

  const dispatchMotion = useCallback((event: KujiOpenMotionEvent) => {
    const transition = transitionKujiOpenMotion(motionStateRef.current, event);
    motionStateRef.current = transition.state;
    setPhase(transition.state.phase);

    if (transition.effect === "request-and-animate") {
      requestOpenRef.current();
      dragProgress.value = withTiming(
        1,
        {
          duration: resolveKujiTravelDuration(dragProgress.value),
          easing: smoothFinishEasing,
        },
        (finished) => {
          "worklet";
          scheduleOnRN(handleTravelSettled, Boolean(finished));
        },
      );
      return;
    }

    if (transition.effect === "request-and-wait") {
      dragProgress.value = 1;
      requestOpenRef.current();
      return;
    }

    if (transition.effect === "start-impact") {
      dragProgress.value = 1;
      impactProgress.value = 0;
      impactProgress.value = withTiming(
        1,
        { duration: DRAW_MOTION.kujiImpactMs, easing: smoothEmphasisEasing },
        (finished) => {
          "worklet";
          scheduleOnRN(handleImpactSettled, Boolean(finished));
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
  const neutralResultStyle = useAnimatedStyle(() => ({
    opacity: interpolate(impactProgress.value, [0, 0.12, 0.34], [1, 1, 0], Extrapolation.CLAMP),
  }));
  const committedResultStyle = useAnimatedStyle(() => ({
    opacity: interpolate(impactProgress.value, [0.12, 0.34, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [{
      scale: interpolate(impactProgress.value, [0, 0.38, 0.7, 1], [0.86, 1.025, 0.995, 1], Extrapolation.CLAMP),
    }],
  }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(impactProgress.value, [0, 0.08, 0.3, 1], [0, 0.92, 0.2, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(impactProgress.value, [0, 0.36], [0.58, 1.35], Extrapolation.CLAMP) }],
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

  return (
    <GestureDetector gesture={interactionGesture}>
      <Animated.View
        accessible
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
          style={styles.ticketShell}
        >
          <View style={styles.resultFace}>
            <Animated.View style={[styles.resultLayer, neutralResultStyle]}>
              <Text style={styles.resultEyebrow}>RESULT</Text>
              <View style={styles.resultPlate}>
                <Text style={styles.resultMark}>•••</Text>
              </View>
              <Text style={styles.resultSerial}>{primaryLabel}</Text>
            </Animated.View>
            <Animated.View style={[styles.resultLayer, committedResultStyle]}>
              <Text style={styles.resultEyebrow}>OPEN</Text>
              <View style={[styles.resultPlate, styles.resultPlateReady]}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.resultReadyLabel}>
                  {resultLabel}
                </Text>
              </View>
              <Text style={styles.resultSerial}>{primaryLabel}</Text>
            </Animated.View>
          </View>

          <Animated.View pointerEvents="none" style={[styles.impactFlash, flashStyle]} />
          {IMPACT_PARTICLES.map((particle, index) => (
            <ImpactParticle key={`${particle.x}-${particle.y}`} index={index} progress={impactProgress} />
          ))}

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
    </GestureDetector>
  );
}

function ImpactParticle({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const particle = IMPACT_PARTICLES[index]!;
  const animatedStyle = useAnimatedStyle(() => ({
    width: particle.size,
    height: particle.size,
    opacity: interpolate(progress.value, [0, 0.08, 0.46, 1], [0, 1, 0.82, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: progress.value * particle.x },
      { translateY: progress.value * particle.y },
      { rotate: `${progress.value * particle.rotate}deg` },
      { scale: interpolate(progress.value, [0, 0.16, 1], [0.2, 1, 0.55], Extrapolation.CLAMP) },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[styles.impactParticle, animatedStyle]} />;
}

const KUJI_ORANGE = "#F36B2C";
const KUJI_ORANGE_DARK = "#A83C15";
const KUJI_ORANGE_LIGHT = "#FFAA6B";

const styles = StyleSheet.create({
  pressTarget: {
    width: "100%",
    maxWidth: 316,
    minHeight: seed.size.touchTarget,
  },
  ticketShell: {
    width: "100%",
    aspectRatio: 1.46,
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
  resultFace: {
    ...StyleSheet.absoluteFillObject,
    margin: 7,
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    borderWidth: 1,
    borderColor: "#8F4D2D",
    backgroundColor: "#272421",
    alignItems: "center",
    justifyContent: "center",
  },
  resultLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  resultEyebrow: {
    color: KUJI_ORANGE_LIGHT,
    fontFamily: "Galmuri11",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "400",
    letterSpacing: 1,
  },
  resultPlate: {
    width: 112,
    height: 62,
    marginTop: seed.spacing.x2,
    borderRadius: seed.radius.r2,
    borderWidth: 2,
    borderColor: "#765442",
    backgroundColor: "#151413",
    alignItems: "center",
    justifyContent: "center",
  },
  resultPlateReady: {
    borderColor: colors.brand,
    backgroundColor: "#182219",
  },
  resultMark: {
    color: colors.white,
    fontFamily: "Galmuri11",
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "400",
    letterSpacing: 3,
  },
  resultReadyLabel: {
    maxWidth: 96,
    paddingHorizontal: seed.spacing.x1,
    color: colors.brand,
    fontFamily: "Galmuri11",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "400",
    textAlign: "center",
  },
  resultSerial: {
    marginTop: seed.spacing.x2,
    color: "#B9AAA1",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.7,
  },
  impactFlash: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 220,
    height: 220,
    marginLeft: -110,
    marginTop: -110,
    borderRadius: seed.radius.full,
    backgroundColor: "#FFF7DF",
    zIndex: 4,
  },
  impactParticle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -4,
    marginTop: -4,
    borderRadius: 2,
    backgroundColor: colors.brand,
    zIndex: 5,
  },
  ticketOuterLayer: {
    ...StyleSheet.absoluteFillObject,
    margin: 4,
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
  ticketPeelLayer: {
    ...StyleSheet.absoluteFillObject,
    margin: 4,
    overflow: "hidden",
    borderRadius: seed.radius.r2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 7,
  },
  ticketLayerImage: {
    ...StyleSheet.absoluteFillObject,
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
    ...StyleSheet.absoluteFillObject,
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
