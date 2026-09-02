import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { findProfilePolicy } from "@/features/profile/profile-policies";
import { colors } from "@/theme";

export function ProfilePolicyDetailScreen() {
  const { policyId = "" } = useLocalSearchParams<{ policyId?: string }>();
  const policy = findProfilePolicy(policyId);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header title={policy?.title ?? "운영정책"} />
      <ScrollView contentContainerStyle={styles.content}>
        {policy ? (
          <>
            <View style={styles.lead}>
              <KoreanPixelTitle variant="section" numberOfLines={3}>{policy.title}</KoreanPixelTitle>
              <Text style={styles.summary}>{policy.summary}</Text>
              <Text style={styles.updated}>최근 업데이트 {policy.updatedAt}</Text>
            </View>
            {policy.sections.map((section) => (
              <View key={section.heading} style={styles.section}>
                <Text style={styles.heading}>{section.heading}</Text>
                {section.paragraphs.map((paragraph) => <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>)}
              </View>
            ))}
          </>
        ) : (
          <View style={styles.state}>
            <Ionicons name="document-text-outline" size={36} color={colors.muted} />
            <Text style={styles.stateTitle}>문서를 찾을 수 없어요</Text>
            <Text style={styles.stateBody}>약관·운영정책 목록에서 다시 선택해 주세요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="chevron-back" size={25} color={colors.ink} /></Pressable><KoreanPixelTitle variant="header" numberOfLines={1}>{title}</KoreanPixelTitle><View style={styles.headerAction} /></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  lead: { padding: seed.spacing.x4, borderRadius: seed.radius.r4, backgroundColor: seed.color.background.brandWeak, marginBottom: seed.spacing.x3 },
  summary: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: seed.spacing.x2 },
  updated: { color: colors.muted, fontSize: 10, marginTop: seed.spacing.x3 },
  section: { padding: seed.spacing.x4, marginTop: seed.spacing.x3, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r4, backgroundColor: seed.color.layer.default },
  heading: { color: colors.ink, fontSize: 16, fontWeight: "900", marginBottom: seed.spacing.x2 },
  paragraph: { color: colors.ink, fontSize: 13, lineHeight: 22, marginTop: seed.spacing.x2 },
  state: { minHeight: 430, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6 },
  stateTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: seed.spacing.x3 },
  stateBody: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity },
});
