import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { BUSINESS_INFORMATION } from "@/features/profile/business-information";
import { colors } from "@/theme";

const BUSINESS_ROWS = [
  ["상호", BUSINESS_INFORMATION.businessName],
  ["대표자명", BUSINESS_INFORMATION.representativeName],
  ["사업자등록번호", BUSINESS_INFORMATION.businessRegistrationNumber],
  ["사업장 주소", BUSINESS_INFORMATION.businessAddress],
  ["대표전화", BUSINESS_INFORMATION.representativePhone],
  ["통신판매업 신고번호", BUSINESS_INFORMATION.mailOrderRegistrationNumber],
] as const;

export function BusinessInfoScreen() {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="사업자 정보" titleMode="pixel" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {BUSINESS_ROWS.map(([label, value], index) => (
          <View key={label} style={[styles.row, index < BUSINESS_ROWS.length - 1 && styles.rowBorder]}>
            <Text style={styles.label}>{label}</Text>
            <Text selectable style={styles.value}>{value}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3, paddingBottom: seed.spacing.screenBottom },
  row: { paddingVertical: seed.spacing.x4 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  label: { color: colors.muted, ...seed.typography.caption, fontWeight: "700" },
  value: { color: colors.ink, ...seed.typography.bodyStrong, lineHeight: 22, marginTop: seed.spacing.x1_5 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
