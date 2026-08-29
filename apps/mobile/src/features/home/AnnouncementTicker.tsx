import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { getTickerOverflowDistance } from "@/features/home/home-feed";
import { colors } from "@/theme";

const TICKER_ROW_HEIGHT = 36;
const SHORT_MESSAGE_HOLD_MS = 3_000;

export function AnnouncementTicker({ messages, onPress }: { messages: readonly string[]; onPress: () => void }) {
  const safeMessages = useMemo(() => messages.map((message) => message.trim()).filter(Boolean), [messages]);
  const [index, setIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [textWidths, setTextWidths] = useState<Record<string, number>>({});
  const [reduceMotion, setReduceMotion] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
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
    translateX.setValue(0);
    translateY.setValue(0);

    if (reduceMotion) {
      const timer = setTimeout(() => setIndex((current) => (current + 1) % safeMessages.length), 5_000);
      return () => clearTimeout(timer);
    }

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
    const animation = Animated.sequence([
      horizontalAnimation,
      Animated.timing(translateY, {
        toValue: -TICKER_ROW_HEIGHT,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setIndex((current) => (current + 1) % safeMessages.length);
    });
    return () => animation.stop();
  }, [currentMessage, currentTextWidth, reduceMotion, safeMessages.length, translateX, translateY, viewportWidth]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`공지사항: ${currentMessage}`}
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.label}><Text style={styles.labelText}>공지</Text></View>
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
      <Ionicons name="chevron-forward" size={14} color={colors.muted} />
    </Pressable>
  );
}

function TickerMeasure({ message, onMeasured }: { message: string; onMeasured: (message: string, width: number) => void }) {
  return (
    <Text
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
        <Text numberOfLines={1} style={[styles.message, { width }]}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: TICKER_ROW_HEIGHT,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.background.brandWeak,
  },
  label: { borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: 3, backgroundColor: colors.ink },
  labelText: { color: colors.white, fontSize: 9, fontWeight: "900" },
  viewport: { flex: 1, height: TICKER_ROW_HEIGHT, overflow: "hidden" },
  measureLayer: { position: "absolute", width: 10_000, opacity: 0 },
  measureMessage: { width: 10_000 },
  messageStack: { height: TICKER_ROW_HEIGHT * 2 },
  row: { height: TICKER_ROW_HEIGHT, justifyContent: "center", overflow: "hidden" },
  message: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  pressed: { opacity: seed.state.pressedOpacity },
});
