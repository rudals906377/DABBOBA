import type { ViewStyle } from "react-native";
import { seed } from "@/design-system/seed";

export const CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER = 2;

/**
 * Shared surface for every customer-facing product summary.
 *
 * Product imagery and copy belong to one calm card: a single neutral outline,
 * one radius, no category-specific outer chrome, and no decorative shadow.
 */
export const catalogProductCardSurface = {
  overflow: "hidden",
  borderWidth: 1,
  borderColor: seed.color.stroke.neutral,
  borderRadius: seed.radius.r4,
  backgroundColor: seed.color.layer.default,
} satisfies ViewStyle;

export const catalogProductImageSurface = {
  overflow: "hidden",
  borderRadius: seed.radius.r3,
  backgroundColor: seed.color.background.neutralWeak,
} satisfies ViewStyle;
