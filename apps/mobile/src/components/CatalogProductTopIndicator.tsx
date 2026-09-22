import type { CatalogProduct } from "@dabboba/contracts";
import { StyleSheet, View } from "react-native";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

/**
 * Shared category cue for customer-facing discovery cards.
 *
 * The percentage width keeps the cue restrained on compact Home/Gacha cards
 * and lets it grow proportionally with the full-width Kuji Shop card.
 */
export function CatalogProductTopIndicator({
  category,
}: {
  category: CatalogProduct["category"];
}) {
  if (category !== "gacha" && category !== "kuji") return null;

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.indicator, category === "kuji" && styles.kuji]}
    />
  );
}

const styles = StyleSheet.create({
  indicator: { position: "absolute", top: 0, left: "36%", width: "28%", height: 2, zIndex: 3, opacity: 0.68, borderBottomLeftRadius: seed.radius.r1, borderBottomRightRadius: seed.radius.r1, backgroundColor: colors.brand },
  kuji: { backgroundColor: colors.kujiOrange },
});
