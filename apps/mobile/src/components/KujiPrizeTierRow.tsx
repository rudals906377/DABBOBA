import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { AppText as Text } from "@/components/Typography";
import { CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { remainingKujiTierSummary } from "@/features/kuji/kuji-tier-availability";
import { colors } from "@/theme";

type KujiPrizeTierRowProps = {
  tiers: CatalogProduct["remainingKujiTiers"];
  variant?: "wide" | "overlay";
  style?: StyleProp<ViewStyle>;
};

export function KujiPrizeTierRow({ tiers, variant = "wide", style }: KujiPrizeTierRowProps) {
  const summary = remainingKujiTierSummary(
    tiers,
    variant === "overlay" ? 3 : 5,
    variant === "overlay",
  );
  if (!summary) return null;

  if (variant === "overlay") {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={summary.accessibilityLabel}
        pointerEvents="none"
        style={[styles.overlay, style]}
      >
        <Text variant="finePrint" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} style={styles.overlayText}>{summary.compactLabel}</Text>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={summary.accessibilityLabel}
      style={[styles.row, style]}
    >
      {summary.visible.map((tier) => (
        <View key={tier.tierCode} style={styles.chip}>
          <Text variant="finePrint" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} style={styles.chipText}>{tier.displayLabel}</Text>
        </View>
      ))}
      {summary.hiddenCount > 0 ? (
        <View style={styles.chip}>
          <Text variant="finePrint" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={styles.chipText}>+{summary.hiddenCount}</Text>
        </View>
      ) : null}
      <Text variant="finePrint" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={styles.remainingLabel}>남음</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 23,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x1,
  },
  chip: {
    flexShrink: 1,
    minWidth: 27,
    maxWidth: 92,
    minHeight: 23,
    paddingHorizontal: seed.spacing.x1_5,
    paddingVertical: seed.spacing.x0_5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: seed.color.kuji.stroke,
    borderRadius: seed.radius.r1_5,
    backgroundColor: seed.color.kuji.weak,
  },
  chipText: {
    flexShrink: 1,
    color: colors.kujiOrangeDark,
    fontWeight: "700",
  },
  remainingLabel: {
    flexShrink: 0,
    color: colors.muted,
  },
  overlay: {
    position: "absolute",
    left: seed.spacing.x1_5,
    right: seed.spacing.x1_5,
    bottom: seed.spacing.x1_5,
    minHeight: 23,
    paddingHorizontal: seed.spacing.x2,
    justifyContent: "center",
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: seed.color.kuji.stroke,
    borderRadius: seed.radius.r1_5,
    backgroundColor: seed.color.kuji.overlay,
  },
  overlayText: {
    color: colors.kujiOrangeDark,
    fontWeight: "700",
  },
});
