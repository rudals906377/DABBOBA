import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import { seed } from "@/design-system/seed";

export type RootPageHeaderProps = { children: ReactNode };

export function RootPageHeader({ children }: RootPageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.titleSlot}>{children}</View>
      <RootHeaderActions />
    </View>
  );
}

export type RootPageScaffoldProps = {
  header: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
};

/**
 * Keeps every root title/action bar fixed while its screen body scrolls below it.
 * The root tabs own bottom insets; callers only provide the body and its header.
 */
export function RootPageScaffold({ header, children, style, bodyStyle }: RootPageScaffoldProps) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.screen, style]}>
      {header}
      <View style={[styles.body, bodyStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    height: seed.size.rootTopNavigation,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.basement,
  },
  titleSlot: {
    minWidth: 0,
    flex: 1,
    justifyContent: "center",
    paddingRight: seed.spacing.x2,
  },
  screen: {
    flex: 1,
    backgroundColor: seed.color.layer.basement,
  },
  body: {
    flex: 1,
  },
});
