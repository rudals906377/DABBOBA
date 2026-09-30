import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { productCategoryDescription, productCategoryLabel, type ProductCategory } from "@/features/catalog/product-categories";

export const CATEGORY_COMING_SOON_TITLE = "준비중입니다.";

export function CategoryAvailabilityState({
  category,
  style,
}: {
  category: ProductCategory;
  style?: StyleProp<ViewStyle>;
}) {
  useStorefrontCategorySettings();
  const { fontScale } = useWindowDimensions();
  const expanded = fontScale >= 1.6;
  const label = productCategoryLabel(category);
  const isKuji = category === "kuji";
  const guidance = productCategoryDescription(category).trim()
    || `${label} 상품은 준비가 끝나는 대로 공개할게요.`;
  return (
    <View
      accessible
      accessibilityLabel={`${label} 상품은 아직 준비 중이에요. ${guidance}`}
      style={[styles.container, expanded && styles.containerLargeText, style]}
    >
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.iconShell, isKuji && styles.iconShellKuji]}>
        <DecorativeIonicon
          name={isKuji ? "ticket-outline" : "cube-outline"}
          size={34}
          color={isKuji ? seed.color.kuji.ink : seed.color.foreground.brand}
        />
      </View>
      <KoreanPixelTitle
        variant="hero"
        numberOfLines={expanded ? 2 : 1}
        style={styles.title}
      >
        {CATEGORY_COMING_SOON_TITLE}
      </KoreanPixelTitle>
      <SeedInlineGuidance style={styles.guidance}>{guidance}</SeedInlineGuidance>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 420,
    marginHorizontal: seed.spacing.globalGutter,
    paddingHorizontal: seed.spacing.x5,
    alignItems: "center",
    justifyContent: "center",
  },
  containerLargeText: {
    minHeight: 540,
    paddingHorizontal: seed.spacing.x2,
    paddingVertical: seed.spacing.x6,
  },
  iconShell: {
    width: 72,
    height: 72,
    marginBottom: seed.spacing.x4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.background.brandWeak,
  },
  iconShellKuji: { backgroundColor: seed.color.kuji.weak },
  title: {
    width: "100%",
    textAlign: "center",
  },
  guidance: {
    marginTop: seed.spacing.x3,
    width: "100%",
    textAlign: "center",
  },
});
