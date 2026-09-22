import { StyleSheet, type ViewStyle } from "react-native";
import { seed } from "@/design-system/seed";

/** A quiet boundary beneath title/count/action rows. */
export const subtleSectionHeaderRule = {
  paddingBottom: seed.spacing.x2_5,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: seed.color.stroke.muted,
} satisfies ViewStyle;
