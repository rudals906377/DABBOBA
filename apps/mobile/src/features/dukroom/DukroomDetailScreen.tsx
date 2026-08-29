import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import {
  createDukroomComment,
  fetchDukroomDetail,
  setDukroomLike,
  type CommunityComment,
  type DukroomDetailSnapshot,
} from "@/features/dukroom/dukroom-api";
import { readAuthTokens } from "@/lib/session-store";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

export function DukroomDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ postId?: string | string[] }>();
  const postId = firstParam(params.postId) ?? "";
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
  const [snapshot, setSnapshot] = useState<DukroomDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [likePending, setLikePending] = useState(false);
  const [commentPending, setCommentPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokens = await readAuthTokens();
      setAccessToken(tokens?.accessToken ?? null);
      setSnapshot(await fetchDukroomDetail(runtime.apiBaseUrl, postId, tokens?.accessToken));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "덕룸 글을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [postId, runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/dukroom");
  };

  const toggleLike = async () => {
    if (!snapshot || likePending) return;
    if (!accessToken) {
      Alert.alert("로그인이 필요합니다", "좋아요는 로그인한 계정에 저장됩니다.");
      return;
    }

    const nextLiked = !snapshot.item.post.likedByViewer;
    const nextCount = Math.max(0, snapshot.item.post.likeCount + (nextLiked ? 1 : -1));
    if (snapshot.item.isExample) {
      setSnapshot((current) => current ? {
        ...current,
        item: {
          ...current.item,
          post: { ...current.item.post, likedByViewer: nextLiked, likeCount: nextCount },
        },
      } : current);
      Alert.alert("화면 예시에 반영했어요", "예시 글의 좋아요는 서버에 저장되지 않습니다.");
      return;
    }

    setLikePending(true);
    try {
      const result = await setDukroomLike(runtime.apiBaseUrl, accessToken, snapshot.item.post.id, nextLiked);
      setSnapshot((current) => current ? {
        ...current,
        item: {
          ...current.item,
          post: { ...current.item.post, likedByViewer: result.liked, likeCount: result.likeCount },
        },
      } : current);
    } catch (error) {
      Alert.alert("좋아요를 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setLikePending(false);
    }
  };

  const submitComment = async () => {
    if (!snapshot || commentPending) return;
    const content = comment.trim();
    if (!content) {
      Alert.alert("댓글을 입력해 주세요");
      return;
    }
    if (!accessToken) {
      Alert.alert("로그인이 필요합니다", "댓글은 로그인한 계정으로 등록됩니다.");
      return;
    }

    if (snapshot.item.isExample) {
      const previewComment = createPreviewComment(snapshot.item.post.id, content);
      setSnapshot((current) => current ? {
        ...current,
        comments: [...current.comments, previewComment],
        item: {
          ...current.item,
          post: { ...current.item.post, commentCount: current.item.post.commentCount + 1 },
        },
      } : current);
      setComment("");
      Alert.alert("화면 예시에 추가했어요", "예시 글의 댓글은 서버에 저장되지 않습니다.");
      return;
    }

    setCommentPending(true);
    try {
      const created = await createDukroomComment(runtime.apiBaseUrl, accessToken, snapshot.item.post.id, content);
      setSnapshot((current) => current ? {
        ...current,
        comments: [...current.comments, created],
        item: {
          ...current.item,
          post: { ...current.item.post, commentCount: current.item.post.commentCount + 1 },
        },
      } : current);
      setComment("");
    } catch (error) {
      Alert.alert("댓글을 등록하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setCommentPending(false);
    }
  };

  const item = snapshot?.item ?? null;
  const imageUri = item
    ? resolveCatalogImageUrl(item.imageUrl, runtime.assetBaseUrl, item.imageVersion)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} hitSlop={10} style={styles.headerAction}>
            <Ionicons name="chevron-back" size={28} color={colors.ink} />
          </Pressable>
          <View style={styles.headerTitle}><KoreanPixelTitle variant="header">덕룸 상세</KoreanPixelTitle></View>
          <View style={styles.headerAction} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.ink} /><Text style={styles.centerText}>덕룸 글을 불러오는 중</Text></View>
        ) : message || !snapshot || !item ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.errorTitle}>{message || "덕룸 글을 찾을 수 없습니다."}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {item.isExample ? (
              <View style={styles.exampleBanner}>
                <Ionicons name="eye-outline" size={19} color={colors.greenInk} />
                <Text style={styles.exampleText}>등록 상품으로 구성한 화면 예시입니다. 좋아요와 댓글은 서버에 저장되지 않아요.</Text>
              </View>
            ) : null}

            <View style={styles.authorRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.post.authorNickname.slice(0, 1)}</Text></View>
              <View style={styles.authorCopy}><Text style={styles.authorName}>@{item.post.authorNickname}</Text><Text style={styles.postDate}>{formatDate(item.post.createdAt)}</Text></View>
              {item.ipName ? <View style={styles.ipBadge}><Text numberOfLines={1} style={styles.ipBadgeLabel}>{item.ipName}</Text></View> : null}
            </View>

            <View style={styles.hero}>
              {imageUri ? <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.heroImage} /> : <View style={styles.placeholder}><Ionicons name="images-outline" size={34} color={colors.muted} /></View>}
            </View>

            <View style={styles.postCopy}>
              <Text style={styles.title}>{item.post.title}</Text>
              <Text style={styles.body}>{item.post.content}</Text>
            </View>

            <View style={styles.reactionRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.post.likedByViewer ? "좋아요 취소" : "좋아요"}
                accessibilityState={{ selected: item.post.likedByViewer, busy: likePending }}
                onPress={() => void toggleLike()}
                style={({ pressed }) => [styles.reactionButton, item.post.likedByViewer && styles.reactionButtonActive, pressed && styles.pressed]}
              >
                <Ionicons name={item.post.likedByViewer ? "heart" : "heart-outline"} size={20} color={item.post.likedByViewer ? colors.greenInk : colors.ink} />
                <Text style={styles.reactionLabel}>좋아요 {item.post.likeCount}</Text>
              </Pressable>
              <View style={styles.reactionButton}><Ionicons name="chatbubble-outline" size={18} color={colors.ink} /><Text style={styles.reactionLabel}>댓글 {item.post.commentCount}</Text></View>
            </View>

            <View style={styles.crossLinks}>
              {item.linkedProductId ? (
                <CrossLink
                  icon="bag-handle-outline"
                  title="사진 속 등록 상품 보기"
                  caption="뽀바 상품 상세로 이동"
                  onPress={() => router.push(`/product/${encodeURIComponent(item.linkedProductId ?? "")}` as Href)}
                />
              ) : null}
              {item.post.ipId ? (
                <CrossLink
                  icon="storefront-outline"
                  title="같은 작품 상품 모아보기"
                  caption="뽀바에서 작품별로 확인"
                  onPress={() => router.push({ pathname: "/(tabs)/ppoba", params: { ipId: item.post.ipId ?? "" } } as Href)}
                />
              ) : null}
            </View>

            <View style={styles.commentSection}>
              <View style={styles.sectionHeader}><KoreanPixelTitle variant="section">댓글</KoreanPixelTitle><Text style={styles.sectionCount}>{snapshot.comments.length}개</Text></View>
              {snapshot.comments.length ? snapshot.comments.map((entry) => <CommentRow key={entry.id} comment={entry} />) : (
                <View style={styles.commentEmpty}><Text style={styles.commentEmptyTitle}>아직 댓글이 없어요</Text><Text style={styles.commentEmptyBody}>첫 번째 수집 이야기를 남겨보세요.</Text></View>
              )}
              <View style={styles.composer}>
                <TextInput
                  value={comment}
                  onChangeText={(value) => setComment(value.slice(0, 500))}
                  editable={!commentPending}
                  placeholder="댓글을 입력해 주세요"
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={500}
                  style={styles.commentInput}
                  accessibilityLabel="덕룸 댓글 입력"
                />
                <Pressable accessibilityRole="button" disabled={commentPending} onPress={() => void submitComment()} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
                  <Ionicons name="arrow-up" size={21} color={colors.ink} />
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CrossLink({ icon, title, caption, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; caption: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.crossLink, pressed && styles.pressed]}>
      <View style={styles.crossLinkIcon}><Ionicons name={icon} size={21} color={colors.ink} /></View>
      <View style={styles.crossLinkCopy}><Text style={styles.crossLinkTitle}>{title}</Text><Text style={styles.crossLinkCaption}>{caption}</Text></View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

function CommentRow({ comment }: { comment: CommunityComment }) {
  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}><Text style={styles.commentAvatarText}>{comment.authorNickname.slice(0, 1)}</Text></View>
      <View style={styles.commentCopy}><View style={styles.commentMeta}><Text style={styles.commentAuthor}>@{comment.authorNickname}</Text><Text style={styles.commentDate}>{formatDate(comment.createdAt)}</Text></View><Text style={styles.commentBody}>{comment.content}</Text></View>
    </View>
  );
}

function createPreviewComment(postId: string, content: string): CommunityComment {
  const createdAt = new Date().toISOString();
  return {
    id: `preview-${Date.now()}`,
    postId,
    authorId: "preview-viewer",
    authorNickname: "나",
    content,
    status: "ACTIVE",
    reportCount: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerTitle: { alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  centerText: { color: colors.muted, fontSize: 14 },
  errorTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: "800", textAlign: "center" },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  content: { paddingBottom: seed.spacing.screenBottom },
  exampleBanner: { marginHorizontal: seed.spacing.globalGutter, marginTop: seed.spacing.x4, padding: seed.spacing.componentDefault, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandWeak, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  exampleText: { flex: 1, color: colors.greenInk, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  authorRow: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avatarText: { color: colors.brand, fontSize: 16, fontWeight: "900" },
  authorCopy: { flex: 1 },
  authorName: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  postDate: { color: colors.muted, fontSize: 11, marginTop: 4 },
  ipBadge: { maxWidth: "42%", paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1_5, borderRadius: seed.radius.r2, backgroundColor: seed.color.background.brandWeak },
  ipBadgeLabel: { color: colors.greenInk, fontSize: 11, fontWeight: "800" },
  hero: { margin: seed.spacing.globalGutter, aspectRatio: 1, overflow: "hidden", borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  heroImage: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  postCopy: { paddingHorizontal: seed.spacing.globalGutter },
  title: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle },
  body: { color: seed.color.foreground.muted, ...seed.typography.body, lineHeight: 23, marginTop: seed.spacing.componentDefault },
  reactionRow: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x5, flexDirection: "row", gap: seed.spacing.x2_5 },
  reactionButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.componentDefault, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1_5, borderRadius: seed.radius.r2_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  reactionButtonActive: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  reactionLabel: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  crossLinks: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x6, gap: seed.spacing.x2_5 },
  crossLink: { minHeight: 66, padding: seed.spacing.componentDefault, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  crossLinkIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  crossLinkCopy: { flex: 1 },
  crossLinkTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  crossLinkCaption: { color: colors.muted, fontSize: 12, marginTop: 4 },
  commentSection: { marginTop: seed.spacing.x8, paddingHorizontal: seed.spacing.globalGutter },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionCount: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  commentRow: { paddingVertical: 14, flexDirection: "row", alignItems: "flex-start", gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  commentAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#E9F7E7" },
  commentAvatarText: { color: colors.greenInk, fontSize: 13, fontWeight: "900" },
  commentCopy: { flex: 1 },
  commentMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  commentAuthor: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "900" },
  commentDate: { color: colors.muted, fontSize: 10 },
  commentBody: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 6 },
  commentEmpty: { paddingVertical: 25, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  commentEmptyTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  commentEmptyBody: { color: colors.muted, fontSize: 12, marginTop: 5 },
  composer: { marginTop: seed.spacing.componentDefault, minHeight: seed.size.input, paddingLeft: seed.spacing.x3_5, paddingRight: seed.spacing.x1_5, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  commentInput: { flex: 1, minHeight: 48, maxHeight: 112, color: colors.ink, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  sendButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  pressed: { opacity: seed.state.pressedOpacity },
});
