import { router, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { ReadablePageTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { findProfilePolicy } from "@/features/profile/profile-policies";
import { resolvePublicAppLink } from "@/lib/public-app-links";
import { colors } from "@/theme";

export function ProfilePolicyDetailScreen() {
  const { policyId = "" } = useLocalSearchParams<{ policyId?: string }>();
  const policy = findProfilePolicy(policyId);
  let publicUrl: string | null = null;
  if (policy?.id === "terms") publicUrl = resolvePublicAppLink("terms");
  if (policy?.id === "privacy") publicUrl = resolvePublicAppLink("privacy");
  if (policy?.id === "exchange-request") publicUrl = "https://dabboba.net/community-operations";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header title={policy?.title ?? "운영정책"} />
      <ScrollView contentContainerStyle={styles.content}>
        {policy ? (
          <>
            <View style={styles.lead}>
              <ReadablePageTitle variant="subtitle" numberOfLines={2}>{policy.title}</ReadablePageTitle>
              <Text style={styles.summary}>{publicUrl ? `핵심 안내 · ${policy.summary}` : policy.summary}</Text>
              <Text style={styles.updated}>{publicUrl ? "공개 문서 시행일" : "최근 업데이트"} {policy.updatedAt}</Text>
            </View>
            {policy.sections.map((section) => (
              <View key={section.heading} style={styles.section}>
                <Text style={styles.heading}>{section.heading}</Text>
                {section.paragraphs.map((paragraph) => <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>)}
              </View>
            ))}
            {publicUrl ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${policy.title} 공개 웹 문서에서 확인`}
                onPress={() => void Linking.openURL(publicUrl)}
                style={({ pressed }) => [styles.publicLink, pressed && styles.pressed]}
              >
                <Text style={styles.publicLinkLabel}>공개 웹 문서에서 확인</Text>
                <DecorativeIonicon name="open-outline" size={17} color={colors.greenInk} />
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.state}>
            <DecorativeIonicon name="document-text-outline" size={36} color={colors.muted} />
            <Text style={styles.stateTitle}>문서를 찾을 수 없어요</Text>
            <Text style={styles.stateBody}>약관·운영정책 목록에서 다시 선택해 주세요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  return <DetailPageHeader title={title} titleMode="readable" titleNumberOfLines={2} onBack={() => router.back()} />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  lead: { padding: seed.spacing.x4, borderRadius: seed.radius.r4, backgroundColor: seed.color.background.brandWeak, marginBottom: seed.spacing.x3 },
  summary: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: seed.spacing.x2 },
  updated: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x3 },
  section: { padding: seed.spacing.x4, marginTop: seed.spacing.x3, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r4, backgroundColor: seed.color.layer.default },
  heading: { color: colors.ink, fontSize: 16, fontWeight: "900", marginBottom: seed.spacing.x2 },
  paragraph: { color: colors.ink, fontSize: 13, lineHeight: 22, marginTop: seed.spacing.x2 },
  publicLink: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x4, paddingHorizontal: seed.spacing.x4, borderWidth: StyleSheet.hairlineWidth, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  publicLinkLabel: { color: colors.greenInk, fontSize: 13, fontWeight: "800" },
  state: { minHeight: 430, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6 },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, marginTop: seed.spacing.x3 },
  stateBody: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
