import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER,
  catalogQuantityLabel,
  remainingInventoryLabel,
  remainingInventoryRatio,
  shouldStackCompactInventoryMeter,
} from "@/features/catalog/remaining-inventory";
import { colors } from "@/theme";

type RemainingInventoryMeterProps = {
  category: CatalogProduct["category"];
  availableQuantity: number;
  totalQuantity: number | null;
  compact?: boolean;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  quantityTextStyle?: StyleProp<TextStyle>;
};

export function RemainingInventoryMeter({
  category,
  availableQuantity,
  totalQuantity,
  compact = false,
  dark = false,
  style,
  quantityTextStyle,
}: RemainingInventoryMeterProps) {
  const { fontScale } = useWindowDimensions();
  const inventory = { availableQuantity, totalQuantity };
  const label = remainingInventoryLabel(category);
  const quantity = catalogQuantityLabel(inventory);
  const ratio = remainingInventoryRatio(inventory);
  const stackForLargeText = shouldStackCompactInventoryMeter(compact, fontScale);

  return (
    <View
      accessible
      accessibilityLabel={`${label} ${quantity}`}
      accessibilityRole={ratio === null ? "text" : "progressbar"}
      accessibilityValue={ratio === null || totalQuantity === null ? undefined : {
        min: 0,
        max: Math.max(0, totalQuantity),
        now: Math.max(0, Math.min(availableQuantity, totalQuantity)),
        text: quantity,
      }}
      style={[styles.container, style]}
    >
      <View style={[styles.quantityAndBar, stackForLargeText && styles.quantityAndBarLargeText]}>
        <Text
          variant="catalogMetadata"
          maxFontSizeMultiplier={compact ? COMPACT_INVENTORY_MAX_FONT_SIZE_MULTIPLIER : undefined}
          style={[styles.quantity, dark && styles.quantityDark, quantityTextStyle]}
        >
          {quantity}
        </Text>
        {ratio === null ? null : (
          <View style={[
            styles.track,
            compact && styles.trackCompact,
            dark && styles.trackDark,
            stackForLargeText && styles.trackLargeText,
          ]}>
            <View
              testID="remaining-inventory-fill"
              style={[styles.fill, category === "kuji" && styles.fillKuji, { width: `${ratio * 100}%` }]}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: seed.spacing.x1_5,
    rowGap: seed.spacing.x1,
  },
  quantityAndBar: {
    minWidth: 64,
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: seed.spacing.x1_5,
    rowGap: seed.spacing.x1,
  },
  quantityAndBarLargeText: {
    flexDirection: "column",
    flexWrap: "nowrap",
    alignItems: "stretch",
  },
  quantity: {
    flexShrink: 0,
    color: colors.ink,
    ...seed.typography.catalogMetadata,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  quantityDark: { color: colors.white },
  track: {
    minWidth: 20,
    height: 5,
    flex: 1,
    overflow: "hidden",
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.background.neutralWeak,
  },
  trackCompact: { height: 4 },
  trackLargeText: { width: "100%", flex: 0 },
  trackDark: { backgroundColor: "#434A43" },
  fill: {
    height: "100%",
    borderRadius: seed.radius.full,
    backgroundColor: colors.brand,
  },
  fillKuji: { backgroundColor: colors.kujiOrange },
});
