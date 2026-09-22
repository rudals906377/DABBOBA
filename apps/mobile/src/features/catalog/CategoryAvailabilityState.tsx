import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { productCategoryDescription, productCategoryLabel, type ProductCategory } from "@/features/catalog/product-categories";
import { colors } from "@/theme";

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
  const description = productCategoryDescription(category);
  const isKuji = category === "kuji";
  return (
    <View
      accessible
      accessibilityLabel={`${label}샵 오픈 준비 중. ${isKuji ? "상품 구성과 이용 안내를 점검하고 있습니다." : description}`}
      style={[styles.container, expanded && styles.containerLargeText, style]}
    >
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.iconShell, isKuji && styles.iconShellKuji]}>
        <DecorativeIonicon name={isKuji ? "ticket-outline" : "cube-outline"} size={34} color={isKuji ? colors.kujiOrangeDark : colors.greenInk} />
      </View>
      <Text style={[styles.eyebrow, isKuji && styles.eyebrowKuji]}>OPENING SOON</Text>
      <KoreanPixelTitle
        variant="hero"
        numberOfLines={expanded ? 2 : 1}
        style={styles.title}
      >
        {expanded ? `${label}샵 오픈\n준비 중` : `${label}샵 오픈 준비 중`}
      </KoreanPixelTitle>
      <Text style={styles.body}>
        {isKuji
          ? "당첨 상품과 이용 방식을 꼼꼼히 준비하고 있어요. 오픈 소식은 공지로 알려드릴게요."
          : description || `${label} 상품은 준비가 끝나는 대로 공개할게요.`}
      </Text>
      <View style={[styles.statusPill, expanded && styles.statusPillLargeText]}>
        <View style={[styles.statusDot, isKuji && styles.statusDotKuji]} />
        <Text style={styles.statusText}>{isKuji ? "상품 구성·이용 안내 점검 중" : "상품 공개 준비 중"}</Text>
      </View>
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
    borderRadius: 36,
    backgroundColor: seed.color.background.brandWeak,
  },
  iconShellKuji: { backgroundColor: "#FFF1E9" },
  eyebrow: {
    marginBottom: seed.spacing.x2,
    color: colors.greenInk,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  eyebrowKuji: { color: colors.kujiOrangeDark },
  title: {
    width: "100%",
    textAlign: "center",
  },
  body: {
    marginTop: seed.spacing.x3_5,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  statusPill: {
    minHeight: 38,
    marginTop: seed.spacing.x5,
    paddingHorizontal: seed.spacing.x3_5,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
    borderRadius: seed.radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  statusPillLargeText: {
    width: "100%",
    paddingVertical: seed.spacing.x2,
    justifyContent: "center",
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.greenInk },
  statusDotKuji: { backgroundColor: colors.kujiOrangeDark },
  statusText: {
    flexShrink: 1,
    textAlign: "center",
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
});
