import { type Href, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { BalancedAppText } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

export function EventDetailScreen() {
  const router = useRouter();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as Href);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="이벤트" titleMode="pixel" onBack={goBack} backLabel="홈으로 돌아가기" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.icon}>
            <DecorativeIonicon name="gift-outline" size={28} color={seed.color.foreground.brand} />
          </View>
          <KoreanPixelTitle variant="section" style={styles.title}>새 이벤트 준비 중</KoreanPixelTitle>
          <BalancedAppText style={styles.body}>
            현재 진행 중인 이벤트가 없어요. 새로운 뽑기 혜택과 소식이 준비되면 홈과 알림함에서 가장 먼저 알려드릴게요.
          </BalancedAppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { flexGrow: 1, padding: seed.spacing.globalGutter, paddingBottom: seed.spacing.screenBottom },
  hero: {
    minHeight: 330,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: seed.radius.r5,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    padding: seed.spacing.x6,
    backgroundColor: seed.color.layer.default,
  },
  icon: { width: seed.spacing.x14, height: seed.spacing.x14, borderRadius: seed.radius.full, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandWeak },
  title: { marginTop: seed.spacing.x4, textAlign: "center" },
  body: { color: colors.muted, ...seed.typography.bodyCompact, textAlign: "center", marginTop: seed.spacing.x3 },
});
