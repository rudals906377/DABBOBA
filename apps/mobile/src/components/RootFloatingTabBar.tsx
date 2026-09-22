import type { BottomTabBarProps } from "expo-router/js-tabs";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppText as Text } from "@/components/Typography";
import { GachaCapsuleIcon } from "@/components/GachaCapsuleIcon";
import { KujiTicketIcon } from "@/components/KujiTicketIcon";
import {
  HomeTabIcon,
  ProfileTabIcon,
  StorageTabIcon,
} from "@/components/RootObjectTabIcon";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

type RootNavigationMotion = {
  reducedMotion: boolean;
  expand: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

export const ROOT_NAVIGATION_CONTENT_INSET = seed.size.bottomNavigation + seed.spacing.screenBottom;
export const ROOT_TAB_LABEL_MAX_FONT_SIZE_MULTIPLIER = 2;

const RootNavigationMotionContext = createContext<RootNavigationMotion | null>(null);

export function RootNavigationMotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);

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

  const expand = useCallback(() => undefined, []);
  const onScroll = useCallback((_event: NativeSyntheticEvent<NativeScrollEvent>) => undefined, []);

  const value = useMemo(
    () => ({ reducedMotion, expand, onScroll }),
    [expand, onScroll, reducedMotion],
  );
  return <RootNavigationMotionContext.Provider value={value}>{children}</RootNavigationMotionContext.Provider>;
}

export function useRootNavigationScroll() {
  const motion = useContext(RootNavigationMotionContext);
  if (!motion) throw new Error("useRootNavigationScroll must be used inside RootNavigationMotionProvider");
  return { onScroll: motion.onScroll, scrollEventThrottle: 16 as const };
}

const TAB_LABELS: Record<string, string> = {
  gacha: "가챠샵",
  kuji: "쿠지샵",
  index: "홈",
  storage: "보관함",
  profile: "내정보",
};

export function RootFloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const motion = useContext(RootNavigationMotionContext);
  if (!motion) throw new Error("RootFloatingTabBar must be used inside RootNavigationMotionProvider");

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.footer,
        {
          height: seed.size.bottomNavigation + insets.bottom,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options ?? {};
          const selected = state.index === index;
          const activeColor = route.name === "kuji" ? colors.kujiOrangeDark : seed.color.foreground.brand;
          const color = selected ? activeColor : seed.color.foreground.muted;
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
              <View style={styles.iconSlot}>
                {route.name === "gacha" ? (
                  <GachaCapsuleIcon color={color} size={25} />
                ) : route.name === "kuji" ? (
                  <KujiTicketIcon color={color} size={25} />
                ) : route.name === "index" ? (
                  <HomeTabIcon color={color} size={25} />
                ) : route.name === "storage" ? (
                  <StorageTabIcon color={color} size={25} />
                ) : route.name === "profile" ? (
                  <ProfileTabIcon color={color} size={25} />
                ) : (
                  <View style={{ width: 25, height: 25 }} />
                )}
              </View>
              <View style={styles.labelClip}>
                <Text
                  variant="finePrint"
                  maxFontSizeMultiplier={ROOT_TAB_LABEL_MAX_FONT_SIZE_MULTIPLIER}
                  numberOfLines={1}
                  style={[styles.label, selected && { color }]}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
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
    alignItems: "stretch",
    justifyContent: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.muted,
    backgroundColor: seed.color.layer.default,
  },
  bar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: seed.color.background.transparent,
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
  tabPressed: {
    opacity: seed.state.pressedOpacity,
    transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }],
  },
  iconSlot: { height: 28, alignItems: "center", justifyContent: "center" },
  labelClip: {
    alignSelf: "stretch",
    minHeight: 32,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  label: {
    color: seed.color.foreground.muted,
    fontFamily: "NotoSansKR_700Bold",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "400",
    textAlign: "center",
  },
});
