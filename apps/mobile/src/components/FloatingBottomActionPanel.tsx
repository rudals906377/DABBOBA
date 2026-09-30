import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { seed } from "@/design-system/seed";

export const FLOATING_BOTTOM_ACTION_PANEL_HEIGHT = 70;
const FLOATING_BOTTOM_ACTION_BASE_CONTENT_INSET =
  FLOATING_BOTTOM_ACTION_PANEL_HEIGHT + seed.spacing.screenBottom;

export function useFloatingBottomActionContentInset(): number {
  const insets = useSafeAreaInsets();
  return FLOATING_BOTTOM_ACTION_BASE_CONTENT_INSET + insets.bottom;
}

export function FloatingBottomActionPanel({
  children,
  panelStyle,
}: {
  children: ReactNode;
  panelStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        { paddingBottom: Math.max(insets.bottom, seed.spacing.x2) },
      ]}
    >
      <View style={[styles.panel, panelStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: seed.spacing.globalGutter,
    backgroundColor: seed.color.background.transparent,
  },
  panel: {
    width: "100%",
    maxWidth: 520,
    minHeight: 70,
    padding: seed.spacing.x2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17, 20, 17, 0.13)",
    borderRadius: seed.radius.r5_5,
    backgroundColor: "rgba(252, 252, 248, 0.94)",
    shadowColor: seed.color.foreground.neutral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 10,
  },
});
