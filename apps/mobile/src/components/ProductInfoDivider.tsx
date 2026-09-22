import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { seed } from "@/design-system/seed";

export function ProductInfoDivider({
  orientation = "horizontal",
  style,
}: {
  orientation?: "horizontal" | "vertical";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={[styles.base, styles[orientation], style]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    flexShrink: 0,
    backgroundColor: seed.color.stroke.muted,
  },
  horizontal: {
    alignSelf: "stretch",
    height: StyleSheet.hairlineWidth,
  },
  vertical: {
    alignSelf: "stretch",
    width: StyleSheet.hairlineWidth,
  },
});
