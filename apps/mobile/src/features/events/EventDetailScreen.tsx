import { type Href, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, BalancedAppText } from "@/components/Typography";
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
            <DecorativeIonicon name="gift-outline" size={32} color={colors.ink} />
          </View>
          <KoreanPixelTitle variant="section" style={styles.title}>새 이벤트 준비 중</KoreanPixelTitle>
          <BalancedAppText style={styles.body}>
            현재 진행 중인 이벤트가 없어요. 새로운 뽑기 혜택과 소식이 준비되면 홈과 알림함에서 가장 먼저 알려드릴게요.
          </BalancedAppText>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>이벤트 참여 전 확인해 주세요</Text>
          <Text style={styles.infoBody}>이벤트마다 기간, 대상 상품, 지급 조건이 달라요. 참여 전 상세 내용을 확인해 주세요.</Text>
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
  icon: { width: 68, height: 68, borderRadius: seed.radius.r6, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  title: { marginTop: seed.spacing.x4, textAlign: "center" },
  body: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: "center", marginTop: seed.spacing.x3 },
  infoCard: { borderRadius: seed.radius.r4, padding: seed.spacing.x4, marginTop: seed.spacing.x3, backgroundColor: seed.color.background.neutralWeak },
  infoTitle: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "900" },
  infoBody: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: seed.spacing.x2 },
});
