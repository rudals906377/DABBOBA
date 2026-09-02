import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { categoryLabel, formatDate, setWantedRequestLike, type ProfileWantedRequest } from "@/features/profile/profile-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

export function WantedRequestDetailScreen() {
  const { requestId = "" } = useLocalSearchParams<{ requestId?: string }>();
  const profileState = useProfileSnapshot();
  const initial = useMemo(
    () => profileState.snapshot?.wantedRequests.find((item) => item.id === requestId) ?? null,
    [profileState.snapshot?.wantedRequests, requestId],
  );
  const [request, setRequest] = useState<ProfileWantedRequest | null>(initial);
  const [pending, setPending] = useState(false);

  useEffect(() => setRequest(initial), [initial]);

  const toggleLike = async () => {
    if (!request || pending) return;
    if (!profileState.snapshot || profileState.snapshot.isExample || !profileState.accessToken) {
      setRequest((current) => current ? { ...current, likedByViewer: !current.likedByViewer, likeCount: current.likeCount + (current.likedByViewer ? -1 : 1) } : current);
      return;
    }
    try {
      setPending(true);
      const next = await setWantedRequestLike(profileState.runtime.apiBaseUrl, profileState.accessToken, request.id, !request.likedByViewer);
      setRequest((current) => current ? { ...current, ...next } : current);
    } catch (error) {
      Alert.alert("반응을 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        {!profileState.snapshot && !profileState.message ? <ActivityIndicator color={colors.ink} style={styles.loading} /> : null}
        {profileState.message ? <State title="신청을 불러오지 못했어요" body={profileState.message} /> : null}
        {profileState.snapshot && !request ? <State title="신청을 찾을 수 없어요" body="신청방 목록에서 다시 확인해 주세요." /> : null}
        {request ? (
          <>
            <View style={styles.authorRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{request.authorNickname.slice(0, 1)}</Text></View>
              <View style={styles.authorCopy}><Text style={styles.author}>@{request.authorNickname}</Text><Text style={styles.date}>{formatDate(request.createdAt)}</Text></View>
              <Text style={styles.category}>{categoryLabel(request.category)}</Text>
            </View>
            <View style={styles.card}>
              {request.mediaUrl ? <Image source={{ uri: request.mediaUrl }} resizeMode="cover" style={styles.photo} /> : null}
              <Text style={styles.ipName}>{request.ipNameKo}</Text>
              <KoreanPixelTitle variant="section" style={styles.title}>{request.desiredItem}</KoreanPixelTitle>
              <Text style={styles.details}>{request.details}</Text>
            </View>
            <SeedActionButton
              label={`같이 원해요 ${request.likeCount}`}
              variant={request.likedByViewer ? "brandSolid" : "brandOutline"}
              loading={pending}
              leading={<Ionicons name={request.likedByViewer ? "heart" : "heart-outline"} size={18} color={colors.greenInk} />}
              onPress={() => void toggleLike()}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="chevron-back" size={25} color={colors.ink} /></Pressable><KoreanPixelTitle variant="header">신청 상세</KoreanPixelTitle><View style={styles.headerAction} /></View>;
}

function State({ title, body }: { title: string; body: string }) {
  return <View style={styles.state}><Ionicons name="search-outline" size={34} color={colors.muted} /><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  loading: { marginTop: seed.spacing.x12 },
  authorRow: { flexDirection: "row", alignItems: "center", marginBottom: seed.spacing.x3 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: seed.color.background.brandWeak, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.greenInk, fontSize: 16, fontWeight: "900" },
  authorCopy: { flex: 1, marginLeft: seed.spacing.x2_5 },
  author: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  date: { color: colors.muted, fontSize: 10, marginTop: 2 },
  category: { color: colors.greenInk, fontSize: 11, fontWeight: "900", paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, borderRadius: seed.radius.r2, backgroundColor: seed.color.background.brandWeak, overflow: "hidden" },
  card: { padding: seed.spacing.x4, marginBottom: seed.spacing.x4, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r4, backgroundColor: seed.color.layer.default, overflow: "hidden" },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: seed.radius.r3, marginBottom: seed.spacing.x3 },
  ipName: { color: colors.muted, fontSize: 12, marginBottom: seed.spacing.x2 },
  title: { color: colors.ink, marginBottom: seed.spacing.x3 },
  details: { color: colors.ink, fontSize: 14, lineHeight: 23 },
  state: { minHeight: 420, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6 },
  stateTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: seed.spacing.x3 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: seed.spacing.x2 },
  pressed: { opacity: seed.state.pressedOpacity },
});
