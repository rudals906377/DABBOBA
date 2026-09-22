import Constants from "expo-constants";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import {
  FloatingBottomActionPanel,
  useFloatingBottomActionContentInset,
} from "@/components/FloatingBottomActionPanel";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { seed } from "@/design-system/seed";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import {
  categoryLabel,
  decideExchangeOffer,
  fetchExchangeDetail,
  type ExchangeDetailSnapshot,
  type ExchangeProposalItem,
} from "@/features/exchange/exchange-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { UgcSafetyActions } from "@/features/trust-safety/UgcSafetyActions";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

export function ExchangeListingDetailScreen() {
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  const floatingBottomInset = useFloatingBottomActionContentInset();
  const runtime = useMemo(
    () =>
      resolveMobileRuntimeConfig({
        configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
        configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
        metroHostUri: Constants.expoConfig?.hostUri,
        platform: Platform.OS as MobilePlatform,
        development: __DEV__,
      }),
    [],
  );
  const [detail, setDetail] = useState<ExchangeDetailSnapshot | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [processingOfferId, setProcessingOfferId] = useState<string | null>(null);

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      if (!listingId) {
        setMessage("교환 글 주소를 확인해 주세요.");
        setRefreshing(false);
        return;
      }
      try {
        const tokens = await readAuthTokens();
        setAccessToken(tokens?.accessToken ?? null);
        const next = await fetchExchangeDetail(runtime.apiBaseUrl, listingId, tokens?.accessToken);
        setDetail(next);
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "교환 글을 불러오지 못했습니다.");
      } finally {
        setRefreshing(false);
      }
    },
    [listingId, runtime.apiBaseUrl],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const offer = useCallback(async () => {
    const tokens = await readAuthTokens();
    if (!tokens) {
      Alert.alert(
        "로그인이 필요해요",
        "교환 신청은 로그인 후 내가 가챠로 직접 뽑아 보관 중인 상품으로만 할 수 있어요.",
      );
      return;
    }
    if (!listingId) return;
    router.push(`/exchange/${listingId}/offer`);
  }, [listingId]);

  const applyExampleDecision = useCallback((offerId: string, decision: "ACCEPTED" | "REJECTED") => {
    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        listingStatus: decision === "ACCEPTED" ? "MATCHED" : current.listingStatus,
        proposals: current.proposals.map((proposal) => {
          if (decision === "ACCEPTED") {
            return { ...proposal, status: proposal.id === offerId ? "ACCEPTED" : "REJECTED" };
          }
          return proposal.id === offerId ? { ...proposal, status: "REJECTED" } : proposal;
        }),
      };
    });
  }, []);

  const decide = useCallback(
    (proposal: ExchangeProposalItem, decision: "ACCEPTED" | "REJECTED") => {
      const accepting = decision === "ACCEPTED";
      Alert.alert(
        accepting ? "이 제안을 선택할까요?" : "이 제안을 거절할까요?",
        accepting
          ? `${proposal.proposerNickname}님의 상품 ${proposal.products.length}개를 선택하면 나머지 대기 제안은 자동으로 거절돼요.`
          : "거절한 상품은 제안자의 보관함에서 다시 사용할 수 있게 됩니다.",
        [
          { text: "취소", style: "cancel" },
          {
            text: accepting ? "선택하기" : "거절하기",
            style: accepting ? "default" : "destructive",
            onPress: () => {
              void (async () => {
                if (!detail || !listingId) return;
                if (proposal.isExample) {
                  applyExampleDecision(proposal.id, decision);
                  return;
                }
                if (!accessToken) {
                  Alert.alert("로그인이 필요해요", "글을 등록한 계정으로 다시 로그인해 주세요.");
                  return;
                }
                try {
                  setProcessingOfferId(proposal.id);
                  await decideExchangeOffer(
                    runtime.apiBaseUrl,
                    accessToken,
                    listingId,
                    proposal.id,
                    decision,
                  );
                  await load(true);
                } catch (error) {
                  Alert.alert(
                    "제안을 처리하지 못했어요",
                    error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
                  );
                } finally {
                  setProcessingOfferId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [accessToken, applyExampleDecision, detail, listingId, load, runtime.apiBaseUrl],
  );

  const item = detail?.item ?? null;
  const showOfferAction = detail?.viewerRole === "VISITOR" && detail.listingStatus === "OPEN";
  const listingStatusLabel = item && detail?.listingStatus === "OPEN"
    ? `D-${Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000))}`
    : "선택완료";
  const assetBaseUrl = runtime.assetBaseUrl
    ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/exchange");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="교환 상세" titleMode="pixel" onBack={goBack} backLabel="교환방으로 돌아가기" />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: showOfferAction ? floatingBottomInset : seed.spacing.screenBottom },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        {!detail && !message ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.loadingText}>교환 글을 불러오는 중</Text>
          </View>
        ) : null}

        {message ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
              <Text style={styles.retryLabel}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {detail && item ? (
          <>
            <View style={styles.ownerHeader}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.authorNickname.slice(0, 1)}</Text></View>
              <Text style={styles.ownerName}>@{item.authorNickname}</Text>
              {detail.viewerRole === "AUTHOR" ? <Text style={styles.meBadge}>내 글</Text> : null}
              <Text style={styles.listingStatus}>{listingStatusLabel}</Text>
            </View>

            <Text style={styles.title}>{item.title}</Text>
            {item.details.trim() ? <Text style={styles.details}>{item.details}</Text> : null}

            {detail.viewerRole === "VISITOR" && !item.isExample ? (
              <UgcSafetyActions
                apiBaseUrl={runtime.apiBaseUrl}
                accessToken={accessToken}
                targetType="EXCHANGE_LISTING"
                targetId={item.id}
                targetUserId={item.authorId}
                targetLabel={`@${item.authorNickname}`}
                returnTo={`/exchange/${encodeURIComponent(item.id)}`}
                onBlocked={() => {
                  setDetail(null);
                  router.replace("/exchange");
                }}
              />
            ) : null}

            {item.products.map((product, index) => (
              <ProductSummary
                key={`${product.id}-${index}`}
                product={product}
                exchangeListingId={item.id}
                ipName={detail.ipNames[product.ipId] ?? null}
                assetBaseUrl={assetBaseUrl}
                label={`A가 올린 상품 ${index + 1}/${item.products.length}`}
              />
            ))}

            {detail.viewerRole === "AUTHOR" ? (
              <View style={styles.proposalSection}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <KoreanPixelTitle variant="section" style={styles.sectionTitle}>들어온 제안</KoreanPixelTitle>
                    <Text style={styles.proposalCount}>{detail.proposals.length}개</Text>
                  </View>
                  <KoreanPixelTitleAccessory style={styles.oneChoiceBadge}>제안 1개 선택</KoreanPixelTitleAccessory>
                </View>
                {detail.proposals.length ? detail.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    exchangeListingId={item.id}
                    ipNames={detail.ipNames}
                    assetBaseUrl={assetBaseUrl}
                    listingItemCount={item.products.length}
                    processing={processingOfferId === proposal.id}
                    disabled={detail.listingStatus !== "OPEN" || proposal.status !== "PENDING"}
                    onDecision={decide}
                  />
                )) : (
                  <View style={styles.emptyProposals}>
                    <Text style={styles.emptyProposalsTitle}>아직 들어온 제안이 없어요</Text>
                    <Text style={styles.emptyProposalsBody}>다른 수집가가 보관함 상품을 제안하면 여기에 모여요.</Text>
                  </View>
                )}
              </View>
            ) : detail.proposals.length ? (
              <View style={styles.proposalSection}>
                <KoreanPixelTitle variant="section" style={styles.sectionTitle}>내가 보낸 제안</KoreanPixelTitle>
                {detail.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    exchangeListingId={item.id}
                    ipNames={detail.ipNames}
                    assetBaseUrl={assetBaseUrl}
                    listingItemCount={item.products.length}
                    processing={false}
                    disabled
                    onDecision={decide}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {showOfferAction ? (
        <FloatingBottomActionPanel>
          <Pressable
            accessibilityRole="button"
            onPress={() => void offer()}
            style={({ pressed }) => [styles.offerButton, pressed && styles.pressed]}
          >
            <Text style={styles.offerButtonLabel}>교환 신청하기</Text>
          </Pressable>
        </FloatingBottomActionPanel>
      ) : null}
    </SafeAreaView>
  );
}

function ProductSummary({
  product,
  exchangeListingId,
  ipName,
  assetBaseUrl,
  label,
}: {
  product: ExchangeDetailSnapshot["item"]["product"];
  exchangeListingId: string;
  ipName: string | null;
  assetBaseUrl: string | null;
  label: string;
}) {
  const imageUri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);

  useEffect(() => {
    let active = true;
    setImageAspectRatio(1);
    if (!imageUri) return () => { active = false; };

    Image.getSize(
      imageUri,
      (width, height) => {
        if (active && width > 0 && height > 0) setImageAspectRatio(width / height);
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [imageUri]);

  const landscape = imageAspectRatio > 1.2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 상품 상세 보기`}
      onPress={() => router.push(
        `/product/${encodeURIComponent(product.id)}?exchangeListingId=${encodeURIComponent(exchangeListingId)}` as Href,
      )}
      style={({ pressed }) => [
        styles.productCard,
        landscape && styles.productCardLandscape,
        pressed && styles.pressed,
      ]}
    >
      <View style={[
        styles.productImageFrame,
        landscape && styles.productImageFrameLandscape,
        { aspectRatio: imageAspectRatio },
      ]}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.productImage}
            resizeMode="contain"
            onLoad={({ nativeEvent }) => {
              const { width, height } = nativeEvent.source;
              if (width > 0 && height > 0) setImageAspectRatio(width / height);
            }}
          />
        ) : (
          <View style={styles.mediaPlaceholder}><Text style={styles.mediaPlaceholderLabel}>이미지 없음</Text></View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.productMeta}>
          {ipName ?? "작품 정보 없음"} · {categoryLabel(product.category)}
        </Text>
        <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text>
        <ProductInfoDivider style={styles.productFieldDivider} />
        <Text style={styles.price}>{catalogPriceLabel(product.price)}</Text>
        <View style={styles.productDetailHint}>
          <Text style={styles.productDetailHintLabel}>상품 상세</Text>
          <DecorativeIonicon name="chevron-forward" size={14} color={colors.muted} />
        </View>
      </View>
    </Pressable>
  );
}

function ProposalCard({
  proposal,
  exchangeListingId,
  ipNames,
  assetBaseUrl,
  listingItemCount,
  processing,
  disabled,
  onDecision,
}: {
  proposal: ExchangeProposalItem;
  exchangeListingId: string;
  ipNames: Record<string, string>;
  assetBaseUrl: string | null;
  listingItemCount: number;
  processing: boolean;
  disabled: boolean;
  onDecision: (proposal: ExchangeProposalItem, decision: "ACCEPTED" | "REJECTED") => void;
}) {
  const statusLabel = proposal.status === "ACCEPTED"
    ? "선택한 제안"
    : proposal.status === "REJECTED"
      ? "거절됨"
      : proposal.status === "WITHDRAWN"
        ? "제안 취소"
        : "검토 대기";
  return (
    <View style={[styles.proposalCard, proposal.status === "ACCEPTED" && styles.proposalCardAccepted]}>
      <View style={styles.proposerRow}>
        <View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{proposal.proposerNickname.slice(0, 1)}</Text></View>
        <Text style={styles.proposerName}>@{proposal.proposerNickname}</Text>
        <Text style={styles.exchangeRatio}>{listingItemCount}:{proposal.products.length}</Text>
        <Text style={[
          styles.proposalStatus,
          proposal.status === "ACCEPTED" && styles.proposalStatusAccepted,
        ]}>{statusLabel}</Text>
      </View>
      {proposal.products.map((product, index) => (
        <ProductSummary
          key={`${product.id}-${index}`}
          product={product}
          exchangeListingId={exchangeListingId}
          ipName={ipNames[product.ipId] ?? null}
          assetBaseUrl={assetBaseUrl}
          label={`제안한 상품 ${index + 1}/${proposal.products.length}`}
        />
      ))}
      {proposal.status === "PENDING" ? (
        <View style={styles.decisionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled || processing}
            onPress={() => onDecision(proposal, "REJECTED")}
            style={({ pressed }) => [styles.rejectButton, (disabled || processing) && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.rejectButtonLabel}>거절하기</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled || processing}
            onPress={() => onDecision(proposal, "ACCEPTED")}
            style={({ pressed }) => [styles.acceptButton, (disabled || processing) && styles.disabled, pressed && styles.pressed]}
          >
            {processing ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.acceptButtonLabel}>교환하기</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x3_5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerSpacer: { width: seed.size.touchTarget },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  errorBox: { marginTop: seed.spacing.x8, borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak, alignItems: "center" },
  errorText: { color: colors.ink, fontSize: 14, lineHeight: 21, textAlign: "center" },
  retry: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x3_5, justifyContent: "center", paddingHorizontal: seed.spacing.x4, borderRadius: seed.radius.r2_5, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
  ownerHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: { width: 34, height: 34, borderRadius: seed.radius.full, alignItems: "center", justifyContent: "center", backgroundColor: "#E5E9E6" },
  avatarText: { color: colors.greenInk, fontSize: 13, fontWeight: "900" },
  ownerName: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  meBadge: { overflow: "hidden", borderRadius: seed.radius.r1_5, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, backgroundColor: colors.brand, color: colors.ink, ...seed.typography.finePrint, fontWeight: "900" },
  listingStatus: { marginLeft: "auto", overflow: "hidden", borderRadius: seed.radius.r3, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#EDF0ED", color: colors.muted, fontSize: 11, fontWeight: "800" },
  title: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle, marginTop: seed.spacing.x4_5 },
  details: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 7 },
  productCard: { marginTop: seed.spacing.x4, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3_5, ...catalogProductCardSurface, padding: seed.spacing.x3_5 },
  productCardLandscape: { flexDirection: "column", alignItems: "stretch" },
  productImageFrame: { width: 104, ...catalogProductImageSurface },
  productImageFrameLandscape: { width: "100%" },
  productImage: { width: "100%", height: "100%" },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", ...seed.typography.finePrint, fontWeight: "800" },
  productInfo: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" },
  productLabel: { color: colors.greenInk, ...seed.typography.finePrint, fontWeight: "900" },
  productName: { color: colors.ink, ...seed.typography.catalogTitle, marginTop: 3 },
  productMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  productFieldDivider: { marginTop: 7 },
  price: { color: colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "900", marginTop: 6 },
  productDetailHint: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x1, marginTop: seed.spacing.x2 },
  productDetailHintLabel: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "800" },
  proposalSection: { marginTop: seed.spacing.x7 },
  sectionHeader: { ...subtleSectionHeaderRule, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  sectionTitleRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: seed.spacing.x2 },
  sectionTitle: { flexShrink: 1 },
  proposalCount: { color: colors.muted, ...seed.typography.label, fontWeight: "700" },
  oneChoiceBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, backgroundColor: seed.color.background.brandWeak, color: seed.color.foreground.brand, fontSize: 11 },
  proposalCard: { marginTop: seed.spacing.x3_5, borderRadius: seed.radius.r5, borderWidth: 2, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, padding: seed.spacing.x3_5 },
  proposalCardAccepted: { borderColor: colors.greenInk },
  proposerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  smallAvatar: { width: 30, height: 30, borderRadius: seed.radius.full, alignItems: "center", justifyContent: "center", backgroundColor: "#E5E9E6" },
  smallAvatarText: { color: colors.greenInk, fontSize: 11, fontWeight: "900" },
  proposerName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  exchangeRatio: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, backgroundColor: seed.color.background.brandWeak, color: colors.greenInk, fontSize: 11, lineHeight: 16, fontWeight: "900" },
  proposalStatus: { marginLeft: "auto", overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, backgroundColor: "#EDF0ED", color: colors.muted, ...seed.typography.finePrint, fontWeight: "900" },
  proposalStatusAccepted: { backgroundColor: colors.brand, color: colors.ink },
  decisionRow: { flexDirection: "row", gap: seed.spacing.x2_5, marginTop: seed.spacing.x3_5 },
  rejectButton: { minHeight: 48, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  rejectButtonLabel: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  acceptButton: { minHeight: 48, flex: 1.3, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid },
  acceptButtonLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  emptyProposals: { marginTop: seed.spacing.x3_5, borderRadius: seed.radius.r4, padding: seed.spacing.x6, alignItems: "center", backgroundColor: colors.surface },
  emptyProposalsTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  emptyProposalsBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  offerButton: { minHeight: seed.size.actionButton.large, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandSolid },
  offerButtonLabel: { color: colors.ink, fontSize: 15, fontWeight: "900" },
});
