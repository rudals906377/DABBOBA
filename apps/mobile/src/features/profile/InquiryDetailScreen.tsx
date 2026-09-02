import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  addInquiryMessage,
  fetchExampleInquiryDetail,
  fetchInquiryDetail,
  type InquiryDetail,
  type InquiryMessage,
} from "@/features/profile/inquiry-api";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

const MESSAGE_LIMIT = 10_000;

export function InquiryDetailScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView | null>(null);
  const { inquiryId: rawInquiryId } = useLocalSearchParams<{ inquiryId?: string | string[] }>();
  const inquiryId = Array.isArray(rawInquiryId) ? rawInquiryId[0] ?? "" : rawInquiryId ?? "";
  const runtime = useMemo(
    () => resolveMobileRuntimeConfig({
      configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
      configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
      metroHostUri: Constants.expoConfig?.hostUri,
      platform: Platform.OS as MobilePlatform,
      development: __DEV__,
    }),
    [],
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [isExample, setIsExample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [replyFocused, setReplyFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const load = useCallback(async (manual = false) => {
    if (!inquiryId) {
      setError("문의 번호를 확인할 수 없습니다.");
      setLoading(false);
      return;
    }
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setAccessToken(null);
        setIsExample(true);
        setDetail(fetchExampleInquiryDetail(inquiryId));
        setError("");
        return;
      }
      setAccessToken(tokens.accessToken);
      setIsExample(false);
      setDetail(await fetchInquiryDetail(runtime.apiBaseUrl, tokens.accessToken, inquiryId));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문의 내역을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [inquiryId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/support");
  };

  const status = detail?.status;
  const closed = status === "CLOSED";
  const canSend = Boolean(detail && reply.trim() && !closed && !isExample && !sending);

  const sendReply = async () => {
    const content = reply.trim();
    if (!detail || !content || closed || sending) return;
    setSending(true);
    setError("");
    setResultMessage("");
    try {
      if (isExample || !accessToken) {
        setError("로그인하면 이 문의에 답변을 추가할 수 있어요.");
        return;
      }
      await addInquiryMessage(runtime.apiBaseUrl, accessToken, detail.id, content);
      setDetail(await fetchInquiryDetail(runtime.apiBaseUrl, accessToken, detail.id));
      setReply("");
      setResultMessage("추가 답변을 보냈어요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추가 답변을 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="고객센터로 돌아가기"
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <KoreanPixelTitle variant="header">문의 내역</KoreanPixelTitle>
        <View style={styles.headerAction} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.ink} />
              <Text style={styles.stateText}>문의 내역을 불러오는 중</Text>
            </View>
          ) : error && !detail ? (
            <View style={styles.state}>
              <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
              <Text style={styles.stateTitle}>문의 내역을 확인할 수 없어요</Text>
              <Text style={styles.stateText}>{error}</Text>
              <SeedActionButton label="다시 불러오기" variant="neutralSolid" onPress={() => void load(true)} style={styles.retryButton} />
            </View>
          ) : detail ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryTop}>
                  <Text style={styles.category}>{categoryLabel(detail.category)}</Text>
                  <Text style={[styles.status, status === "CLOSED" && styles.statusClosed]}>{statusLabel(detail.status)}</Text>
                </View>
                <Text style={styles.title}>{detail.title}</Text>
                <Text style={styles.date}>{formatDateTime(detail.createdAt)} 접수</Text>
              </View>

              <KoreanPixelTitle variant="section" style={styles.conversationTitle}>대화</KoreanPixelTitle>
              <View style={styles.messages}>
                {detail.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
              </View>

              {error ? (
                <View accessibilityRole="alert" style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              {resultMessage ? <Text accessibilityRole="text" style={styles.resultMessage}>{resultMessage}</Text> : null}

              {closed || isExample ? (
                <View style={styles.closedBox}>
                  <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
                  <Text style={styles.closedText}>{closed ? "종료된 문의에는 추가 답변을 보낼 수 없어요." : "로그인하면 문의 내역을 확인하고 답변을 추가할 수 있어요."}</Text>
                </View>
              ) : (
                <View style={styles.replyCard}>
                  <View style={styles.replyHeading}>
                    <Text style={styles.replyLabel}>추가 답변</Text>
                    <Text style={styles.counter}>{reply.length.toLocaleString("ko-KR")}/{MESSAGE_LIMIT.toLocaleString("ko-KR")}</Text>
                  </View>
                  <SeedInputShell focused={replyFocused} error={reply.length >= MESSAGE_LIMIT} style={styles.replyShell}>
                    <AppTextInput
                      accessibilityLabel="추가 답변"
                      value={reply}
                      onChangeText={(value) => setReply(value.slice(0, MESSAGE_LIMIT))}
                      onFocus={() => setReplyFocused(true)}
                      onBlur={() => setReplyFocused(false)}
                      placeholder="추가로 전할 내용을 입력해 주세요."
                      placeholderTextColor={colors.muted}
                      maxLength={MESSAGE_LIMIT}
                      multiline
                      textAlignVertical="top"
                      style={styles.replyInput}
                    />
                  </SeedInputShell>
                  <SeedActionButton
                    label="추가 답변 보내기"
                    loading={sending}
                    disabled={!canSend}
                    onPress={() => void sendReply()}
                    style={styles.sendButton}
                  />
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: InquiryMessage }) {
  const mine = message.authorRole === "USER";
  return (
    <View style={[styles.messageRow, mine && styles.messageRowMine]}>
      <View style={[styles.messageBubble, mine ? styles.messageMine : styles.messageSupport]}>
        <Text style={styles.messageAuthor}>{mine ? "나" : "고객센터"}</Text>
        <Text style={styles.messageContent}>{message.content}</Text>
        <Text style={styles.messageDate}>{formatDateTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function categoryLabel(category: string): string {
  return {
    ACCOUNT: "계정",
    ERROR: "오류",
    PRODUCT: "상품",
    COMMUNITY: "교환·커뮤니티",
    ORDER: "주문·배송",
    OTHER: "기타",
  }[category] ?? "문의";
}

function statusLabel(status: InquiryDetail["status"]): string {
  return {
    PENDING: "접수",
    IN_PROGRESS: "답변 중",
    ANSWERED: "답변 완료",
    CLOSED: "종료",
  }[status];
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: seed.state.pressedOpacity },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  state: { minHeight: 420, paddingHorizontal: seed.spacing.x7, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: "900", textAlign: "center", marginTop: seed.spacing.x3_5 },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: seed.spacing.x2 },
  retryButton: { marginTop: seed.spacing.x4 },
  summaryCard: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, backgroundColor: seed.color.layer.default },
  summaryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  category: { color: colors.greenInk, fontSize: 11, fontWeight: "800" },
  status: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, color: colors.greenInk, backgroundColor: seed.color.background.brandWeak, fontSize: 10, fontWeight: "800" },
  statusClosed: { color: colors.muted, backgroundColor: seed.color.background.neutralWeak },
  title: { color: colors.ink, fontSize: 18, lineHeight: 26, fontWeight: "900", marginTop: seed.spacing.x3 },
  date: { color: colors.muted, fontSize: 10, marginTop: seed.spacing.x2 },
  conversationTitle: { marginTop: seed.spacing.x6, marginBottom: seed.spacing.x3 },
  messages: { gap: seed.spacing.x3 },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowMine: { justifyContent: "flex-end" },
  messageBubble: { maxWidth: "86%", borderRadius: seed.radius.r4, padding: seed.spacing.x3_5 },
  messageMine: { backgroundColor: seed.color.background.brandWeak },
  messageSupport: { borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  messageAuthor: { color: colors.greenInk, fontSize: 10, fontWeight: "900" },
  messageContent: { color: colors.ink, fontSize: 13, lineHeight: 21, marginTop: seed.spacing.x1_5 },
  messageDate: { color: colors.muted, fontSize: 9, marginTop: seed.spacing.x2, textAlign: "right" },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2, borderRadius: seed.radius.r3, padding: seed.spacing.x3_5, marginTop: seed.spacing.x4, backgroundColor: seed.color.background.criticalWeak },
  errorText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 18 },
  resultMessage: { color: colors.greenInk, fontSize: 11, lineHeight: 17, fontWeight: "700", marginTop: seed.spacing.x3 },
  closedBox: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, borderRadius: seed.radius.r3, paddingHorizontal: seed.spacing.x3_5, marginTop: seed.spacing.x5, backgroundColor: seed.color.background.neutralWeak },
  closedText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 },
  replyCard: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x3_5, marginTop: seed.spacing.x5, backgroundColor: seed.color.layer.default },
  replyHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: seed.spacing.x2 },
  replyLabel: { color: colors.ink, ...seed.typography.bodyStrong },
  counter: { color: colors.muted, fontSize: 10 },
  replyShell: { minHeight: 132, alignItems: "flex-start", paddingVertical: seed.spacing.x3 },
  replyInput: { flex: 1, width: "100%", minHeight: 106, color: colors.ink, fontSize: 13, lineHeight: 20, padding: 0 },
  sendButton: { marginTop: seed.spacing.x3 },
});
