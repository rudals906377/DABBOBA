import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { getTickerOverflowDistance } from "@/features/home/home-feed";
import { colors } from "@/theme";

const TICKER_ROW_HEIGHT = 44;
const SHORT_MESSAGE_HOLD_MS = 3_000;

export type AnnouncementTickerProps = {
  messages: readonly string[];
  onPress?: (message: string, index: number) => void;
};

export function AnnouncementTicker({ messages, onPress }: AnnouncementTickerProps) {
  const safeMessages = useMemo(() => messages.map((message) => message.trim()).filter(Boolean), [messages]);
  const [index, setIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [textWidths, setTextWidths] = useState<Record<string, number>>({});
  const [reduceMotion, setReduceMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const ledOpacity = useRef(new Animated.Value(1)).current;
  const currentMessage = safeMessages[index % Math.max(safeMessages.length, 1)] ?? "DABBOBA 안내를 준비하고 있어요.";
  const nextMessage = safeMessages[(index + 1) % Math.max(safeMessages.length, 1)] ?? currentMessage;
  const currentTextWidth = textWidths[currentMessage] ?? 0;
  const nextTextWidth = textWidths[nextMessage] ?? 0;

  const rememberTextWidth = useCallback((message: string, width: number) => {
    if (width <= 0) return;
    setTextWidths((current) => current[message] === width ? current : { ...current, [message]: width });
  }, []);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!safeMessages.length || !viewportWidth || !currentTextWidth) return undefined;
    translateX.stopAnimation();
    translateY.stopAnimation();
    translateX.setValue(0);
    translateY.setValue(0);

    if (reduceMotion || paused) return undefined;

    const overflow = getTickerOverflowDistance(viewportWidth, currentTextWidth);
    const horizontalAnimation = overflow > 0
      ? Animated.sequence([
        Animated.delay(900),
        Animated.timing(translateX, {
          toValue: -overflow,
          duration: Math.max(2_800, overflow * 26),
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(650),
      ])
      : Animated.delay(SHORT_MESSAGE_HOLD_MS);
    if (safeMessages.length === 1) {
      if (overflow <= 0) return undefined;
      const singleMessageAnimation = Animated.loop(Animated.sequence([
        horizontalAnimation,
        Animated.timing(translateX, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]));
      singleMessageAnimation.start();
      return () => singleMessageAnimation.stop();
    }

    const animation = Animated.sequence([horizontalAnimation, Animated.timing(translateY, {
      toValue: -TICKER_ROW_HEIGHT,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })]);
    animation.start(({ finished }) => {
      if (finished) setIndex((current) => (current + 1) % safeMessages.length);
    });
    return () => animation.stop();
  }, [currentMessage, currentTextWidth, paused, reduceMotion, safeMessages.length, translateX, translateY, viewportWidth]);

  useEffect(() => {
    ledOpacity.stopAnimation();
    ledOpacity.setValue(1);
    if (reduceMotion || paused) return undefined;

    const animation = Animated.loop(Animated.sequence([
      Animated.timing(ledOpacity, {
        toValue: 0.38,
        duration: 640,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(ledOpacity, {
        toValue: 1,
        duration: 640,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [ledOpacity, paused, reduceMotion]);

  const messageContent = (
    <>
      <View style={styles.signal}>
        <Animated.View style={[styles.led, { opacity: ledOpacity }]} />
        <Text style={styles.labelText}>공지</Text>
      </View>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.measureLayer}
      >
        <TickerMeasure message={currentMessage} onMeasured={rememberTextWidth} />
        {nextMessage !== currentMessage ? <TickerMeasure message={nextMessage} onMeasured={rememberTextWidth} /> : null}
      </View>
      <View
        style={styles.viewport}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        <Animated.View style={[styles.messageStack, { transform: [{ translateY }] }]}>
          <TickerRow message={currentMessage} width={Math.max(currentTextWidth, viewportWidth)} translateX={translateX} />
          <TickerRow message={nextMessage} width={Math.max(nextTextWidth, viewportWidth)} />
        </Animated.View>
      </View>
      {onPress ? <DecorativeIonicon name="chevron-forward" size={14} color={colors.muted} /> : null}
    </>
  );
  const hasAutomaticMotion = !reduceMotion && (
    safeMessages.length > 1 || getTickerOverflowDistance(viewportWidth, currentTextWidth) > 0
  );
  const accessibilityLabel = `공지사항: ${currentMessage}`;

  return (
    <View style={styles.container}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={() => onPress(currentMessage, index % safeMessages.length)}
          style={({ pressed }) => [styles.messageTarget, pressed && styles.pressed]}
        >
          {messageContent}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={accessibilityLabel}
          style={styles.messageTarget}
        >
          {messageContent}
        </View>
      )}
      {hasAutomaticMotion ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? "공지 자동 전환 재생" : "공지 자동 전환 일시 정지"}
          accessibilityState={{ selected: paused }}
          onPress={() => setPaused((current) => !current)}
          style={({ pressed }) => [styles.playbackButton, pressed && styles.pressed]}
        >
          <DecorativeIonicon name={paused ? "play" : "pause"} size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TickerMeasure({ message, onMeasured }: { message: string; onMeasured: (message: string, width: number) => void }) {
  return (
    <Text
      variant="caption"
      numberOfLines={1}
      style={[styles.message, styles.measureMessage]}
      onTextLayout={(event) => onMeasured(message, event.nativeEvent.lines[0]?.width ?? 0)}
    >
      {message}
    </Text>
  );
}

function TickerRow({ message, width, translateX }: { message: string; width: number; translateX?: Animated.Value }) {
  return (
    <View style={styles.row}>
      <Animated.View style={translateX ? { transform: [{ translateX }] } : undefined}>
        <Text variant="caption" numberOfLines={1} style={[styles.message, { width }]}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: TICKER_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  messageTarget: {
    minWidth: 0,
    flex: 1,
    height: TICKER_ROW_HEIGHT,
    paddingLeft: seed.spacing.globalGutter,
    paddingRight: seed.spacing.x2,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  signal: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x1_5 },
  led: { width: 6, height: 6, borderRadius: seed.radius.full, backgroundColor: colors.brand, shadowColor: colors.brand, shadowOpacity: 0.55, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  labelText: { color: colors.greenInk, fontFamily: "Galmuri11", fontSize: 11, lineHeight: 16, fontWeight: "400" },
  viewport: { flex: 1, height: TICKER_ROW_HEIGHT, overflow: "hidden" },
  measureLayer: { position: "absolute", width: 10_000, opacity: 0 },
  measureMessage: { width: 10_000 },
  messageStack: { height: TICKER_ROW_HEIGHT * 2 },
  row: { height: TICKER_ROW_HEIGHT, justifyContent: "center", overflow: "hidden" },
  message: { color: colors.ink, fontWeight: "700" },
  playbackButton: {
    width: seed.size.touchTarget,
    height: seed.size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: seed.state.pressedOpacity,
    transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }],
  },
});
