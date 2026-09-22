import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput } from "@/components/Typography";
import { SeedActionButton, SeedChip, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  createInquiry,
  type InquiryCategory,
} from "@/features/profile/inquiry-api";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { ProfileApiError } from "@/features/profile/profile-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

const TITLE_LIMIT = 160;
const CONTENT_LIMIT = 10_000;

const CATEGORY_OPTIONS: ReadonlyArray<{ value: InquiryCategory; label: string }> = [
  { value: "ORDER", label: "주문·배송" },
  { value: "PRODUCT", label: "상품" },
  { value: "ACCOUNT", label: "계정" },
  { value: "COMMUNITY", label: "교환·커뮤니티" },
  { value: "ERROR", label: "오류" },
  { value: "OTHER", label: "기타" },
];

export function InquiryCreateScreen() {
  const router = useRouter();
  const profileState = useProfileSnapshot();
  const hasFocusedOnce = useRef(false);
  const [category, setCategory] = useState<InquiryCategory>("ORDER");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [titleFocused, setTitleFocused] = useState(false);
  const [contentFocused, setContentFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);

  useFocusEffect(useCallback(() => {
    if (hasFocusedOnce.current) void profileState.reload();
    else hasFocusedOnce.current = true;
  }, [profileState.reload]));
  useEffect(() => {
    if (profileState.status === "authenticated") setExpired(false);
  }, [profileState.status]);

  const formComplete = Boolean(title.trim() && content.trim());

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/support");
  };

  const openDetail = (inquiryId: string) => {
    router.replace(`/profile/inquiries/${encodeURIComponent(inquiryId)}` as Href);
  };

  const submit = async () => {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (profileState.status === "loading" || !nextTitle || !nextContent || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      if (!profileState.accessToken) {
        return;
      }

      const created = await createInquiry(profileState.runtime.apiBaseUrl, profileState.accessToken, {
        category,
        title: nextTitle,
        content: nextContent,
        mediaIds: [],
      });
      Alert.alert("문의가 접수됐어요", "답변이 등록되면 알림함으로 알려드릴게요.", [
        { text: "확인", onPress: () => openDetail(created.id) },
      ]);
    } catch (cause) {
      if (cause instanceof ProfileApiError && cause.status === 401) {
        setExpired(true);
        setError("");
        return;
      }
      setError(cause instanceof Error ? cause.message : "문의를 접수하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="1:1 문의 작성" titleMode="pixel" onBack={goBack} backLabel="고객센터로 돌아가기" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
        >
          {expired || isProfileSessionBlocked(profileState.status) ? (
            <ProfileSessionGate status={expired ? "expired" : profileState.status as "guest" | "expired"} returnTo="/profile/inquiries/new" guestBody="로그인하면 1:1 문의를 접수할 수 있어요." />
          ) : profileState.status === "error" ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>{profileState.message}</Text><SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={profileState.reload} /></View>
          ) : <>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>문의 유형</Text>
            <View style={styles.categories}>
              {CATEGORY_OPTIONS.map((option) => (
                <SeedChip
                  key={option.value}
                  label={option.label}
                  selected={category === option.value}
                  onPress={() => setCategory(option.value)}
                />
              ))}
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <View style={styles.fieldHeading}>
              <Text style={styles.fieldLabel}>제목</Text>
              <Text style={styles.counter}>{title.length}/{TITLE_LIMIT}</Text>
            </View>
            <SeedInputShell focused={titleFocused} error={title.length >= TITLE_LIMIT}>
              <AppTextInput
                accessibilityLabel="문의 제목"
                value={title}
                onChangeText={(value) => setTitle(value.slice(0, TITLE_LIMIT))}
                onFocus={() => setTitleFocused(true)}
                onBlur={() => setTitleFocused(false)}
                placeholder="문의 제목을 입력해 주세요."
                placeholderTextColor={colors.muted}
                maxLength={TITLE_LIMIT}
                returnKeyType="next"
                style={styles.titleInput}
              />
            </SeedInputShell>
          </View>

          <View style={styles.fieldBlock}>
            <View style={styles.fieldHeading}>
              <Text style={styles.fieldLabel}>문의 내용</Text>
              <Text style={styles.counter}>{content.length.toLocaleString("ko-KR")}/{CONTENT_LIMIT.toLocaleString("ko-KR")}</Text>
            </View>
            <SeedInputShell focused={contentFocused} error={content.length >= CONTENT_LIMIT} style={styles.contentShell}>
              <AppTextInput
                accessibilityLabel="문의 내용"
                value={content}
                onChangeText={(value) => setContent(value.slice(0, CONTENT_LIMIT))}
                onFocus={() => setContentFocused(true)}
                onBlur={() => setContentFocused(false)}
                placeholder="확인이 필요한 내용을 자세히 적어 주세요."
                placeholderTextColor={colors.muted}
                maxLength={CONTENT_LIMIT}
                multiline
                textAlignVertical="top"
                style={styles.contentInput}
              />
            </SeedInputShell>
          </View>

          {error ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <DecorativeIonicon name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <SeedActionButton
            label="문의 접수하기"
            loading={submitting || profileState.status === "loading"}
            disabled={!formComplete}
            onPress={() => void submit()}
            style={styles.submitButton}
          />
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  fieldBlock: { marginBottom: seed.spacing.x5 },
  fieldHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: seed.spacing.x2 },
  fieldLabel: { color: seed.color.foreground.neutral, ...seed.typography.bodyStrong, marginBottom: seed.spacing.x2 },
  counter: { color: colors.muted, ...seed.typography.finePrint },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: seed.spacing.betweenChips },
  titleInput: { flex: 1, minHeight: seed.size.input, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  contentShell: { minHeight: 210, alignItems: "flex-start", paddingVertical: seed.spacing.x3_5 },
  contentInput: { flex: 1, width: "100%", minHeight: 180, color: colors.ink, fontSize: 14, lineHeight: 22, padding: 0 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2, borderRadius: seed.radius.r3, padding: seed.spacing.x3_5, marginBottom: seed.spacing.x3_5, backgroundColor: seed.color.background.criticalWeak },
  errorText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 18 },
  submitButton: { marginTop: seed.spacing.x1 },
});
