import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppText as Text } from "@/components/Typography";
import { PpobaMachineIcon } from "@/components/PpobaMachineIcon";
import { seed } from "@/design-system/seed";

type NavigationMode = "expanded" | "compact";

type RootNavigationMotion = {
  mode: NavigationMode;
  progress: Animated.Value;
  reducedMotion: boolean;
  expand: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

const ROOT_NAVIGATION_TOP_THRESHOLD = 12;
const ROOT_NAVIGATION_COLLAPSE_THRESHOLD = 18;
const ROOT_NAVIGATION_EXPAND_THRESHOLD = 10;

export const ROOT_NAVIGATION_CONTENT_INSET = seed.size.bottomNavigation + seed.spacing.screenBottom;

const RootNavigationMotionContext = createContext<RootNavigationMotion | null>(null);

export function RootNavigationMotionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<NavigationMode>("expanded");
  const [reducedMotion, setReducedMotion] = useState(false);
  const modeRef = useRef<NavigationMode>("expanded");
  const lastScrollYRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const updateMode = useCallback((nextMode: NavigationMode) => {
    if (modeRef.current === nextMode) return;
    modeRef.current = nextMode;
    setMode(nextMode);
    const toValue = nextMode === "compact" ? 1 : 0;
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(toValue);
      return;
    }
    Animated.spring(progress, {
      toValue,
      damping: 25,
      stiffness: 175,
      mass: 0.95,
      overshootClamping: true,
      restDisplacementThreshold: 0.002,
      restSpeedThreshold: 0.002,
      useNativeDriver: false,
    }).start();
  }, [progress, reducedMotion]);

  const expand = useCallback(() => {
    lastScrollYRef.current = 0;
    directionDistanceRef.current = 0;
    updateMode("expanded");
  }, [updateMode]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nextScrollY = Math.max(0, contentOffset.y);

    if (contentSize.height <= layoutMeasurement.height + 2) {
      lastScrollYRef.current = 0;
      directionDistanceRef.current = 0;
      updateMode("expanded");
      return;
    }

    const delta = nextScrollY - lastScrollYRef.current;
    lastScrollYRef.current = nextScrollY;

    if (nextScrollY <= ROOT_NAVIGATION_TOP_THRESHOLD) {
      directionDistanceRef.current = 0;
      updateMode("expanded");
      return;
    }

    if (delta === 0) return;

    if (modeRef.current === "expanded") {
      directionDistanceRef.current = Math.max(0, directionDistanceRef.current + delta);
      if (directionDistanceRef.current >= ROOT_NAVIGATION_COLLAPSE_THRESHOLD) {
        directionDistanceRef.current = 0;
        updateMode("compact");
      }
      return;
    }

    directionDistanceRef.current = Math.min(0, directionDistanceRef.current + delta);
    if (directionDistanceRef.current <= -ROOT_NAVIGATION_EXPAND_THRESHOLD) {
      directionDistanceRef.current = 0;
      updateMode("expanded");
    }
  }, [updateMode]);

  const value = useMemo(
    () => ({ mode, progress, reducedMotion, expand, onScroll }),
    [expand, mode, onScroll, progress, reducedMotion],
  );
  return <RootNavigationMotionContext.Provider value={value}>{children}</RootNavigationMotionContext.Provider>;
}

export function useRootNavigationScroll() {
  const motion = useContext(RootNavigationMotionContext);
  if (!motion) throw new Error("useRootNavigationScroll must be used inside RootNavigationMotionProvider");
  return { onScroll: motion.onScroll, scrollEventThrottle: 16 as const };
}

const TAB_LABELS: Record<string, string> = {
  exchange: "교환방",
  ppoba: "뽀바",
  index: "홈",
  dukroom: "보관함",
  profile: "내정보",
};

const TAB_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  exchange: "swap-horizontal-outline",
  index: "home-outline",
  dukroom: "cube-outline",
  profile: "person-circle-outline",
};

export function RootFloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const motion = useContext(RootNavigationMotionContext);
  if (!motion) throw new Error("RootFloatingTabBar must be used inside RootNavigationMotionProvider");

  const { width: windowWidth } = useWindowDimensions();
  const selection = useRef(new Animated.Value(state.index)).current;
  const previousIndexRef = useRef(state.index);
  const expandedWidth = Math.min(windowWidth - seed.spacing.globalGutter * 2, 520);
  const compactWidth = Math.max(260, Math.min(windowWidth - seed.spacing.x14, 304));
  const routeCount = Math.max(1, state.routes.length);
  const expandedTabWidth = expandedWidth / routeCount;
  const compactTabWidth = compactWidth / routeCount;
  const animatedTabWidth = motion.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [expandedTabWidth, compactTabWidth],
  });
  const animatedTrackWidth = motion.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      Math.max(seed.size.touchTarget, expandedTabWidth - seed.spacing.x2),
      Math.max(seed.size.touchTarget, compactTabWidth - seed.spacing.x2),
    ],
  });

  useEffect(() => {
    if (previousIndexRef.current === state.index) {
      selection.setValue(state.index);
      return;
    }
    previousIndexRef.current = state.index;
    motion.expand();
    if (motion.reducedMotion) {
      selection.setValue(state.index);
      return;
    }
    Animated.spring(selection, {
      toValue: state.index,
      damping: 23,
      stiffness: 230,
      mass: 0.8,
      useNativeDriver: false,
    }).start();
  }, [motion.expand, motion.reducedMotion, selection, state.index]);

  const animatedBarStyle = {
    width: motion.progress.interpolate({ inputRange: [0, 1], outputRange: [expandedWidth, compactWidth] }),
    height: motion.progress.interpolate({ inputRange: [0, 1], outputRange: [66, 54] }),
    borderRadius: motion.progress.interpolate({ inputRange: [0, 1], outputRange: [22, 27] }),
    transform: [
      { translateY: motion.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
    ],
  };

  const labelAnimatedStyle = {
    height: motion.progress.interpolate({ inputRange: [0, 0.78, 1], outputRange: [17, 6, 0] }),
    opacity: motion.progress.interpolate({ inputRange: [0, 0.68, 1], outputRange: [1, 0.45, 0] }),
    transform: [
      { translateY: motion.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 2] }) },
    ],
  };

  const trackAnimatedStyle = {
    width: animatedTrackWidth,
    transform: [{ translateX: Animated.multiply(selection, animatedTabWidth) }],
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.footer,
        {
          height: seed.size.bottomNavigation + insets.bottom + 16,
          paddingBottom: Math.max(insets.bottom, seed.spacing.x2),
        },
      ]}
    >
      <Animated.View
        style={[styles.bar, animatedBarStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.selectionTrack,
            { left: seed.spacing.x1 },
            trackAnimatedStyle,
          ]}
        />

        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options ?? {};
          const selected = state.index === index;
          const color = selected ? seed.color.foreground.brand : seed.color.foreground.muted;
          const label = TAB_LABELS[route.name] ?? (typeof options.title === "string" ? options.title : route.name);

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!selected && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityState={{ selected }}
              onFocus={motion.expand}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              {route.name === "ppoba" ? (
                <PpobaMachineIcon color={color} size={25} />
              ) : (
                <Ionicons name={TAB_ICONS[route.name] ?? "ellipse-outline"} size={25} color={color} />
              )}
              <Animated.View style={[styles.labelClip, labelAnimatedStyle]}>
                <Text numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: seed.color.background.transparent,
  },
  bar: {
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17, 20, 17, 0.13)",
    backgroundColor: "rgba(252, 252, 248, 0.94)",
    shadowColor: "#111411",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 10,
  },
  selectionTrack: {
    position: "absolute",
    top: seed.spacing.x1,
    bottom: seed.spacing.x1,
    alignItems: "center",
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(17, 20, 17, 0.07)",
  },
  tab: {
    zIndex: 1,
    flex: 1,
    minWidth: seed.size.touchTarget,
    minHeight: seed.size.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x1,
  },
  tabPressed: { opacity: seed.state.pressedOpacity },
  labelClip: { overflow: "hidden", justifyContent: "flex-end" },
  label: {
    color: seed.color.foreground.muted,
    fontFamily: "NotoSansKR_700Bold",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "400",
  },
  selectedLabel: { color: seed.color.foreground.brand },
});
