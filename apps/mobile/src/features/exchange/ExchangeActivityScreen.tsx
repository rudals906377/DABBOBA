import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import { fetchMyExchangeActivity, type ExchangeActivitySnapshot, type ExchangeCardItem } from "@/features/exchange/exchange-api";
import { ProfileSessionGate } from "@/features/profile/ProfileSessionGate";
import { ProfileApiError } from "@/features/profile/profile-api";
import { productSubjectTitle } from "@/features/shop/product-title";
import { resolveCatalogImageUrl, resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type ActivityTab = "authored" | "applied";
type StatusFilter = "ALL" | "ACTIVE" | "DONE";

export function ExchangeActivityScreen() {
  const runtime = useMemo(() => resolveMobileRuntimeConfig({
    configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
    configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
    metroHostUri: Constants.expoConfig?.hostUri,
    platform: Platform.OS as MobilePlatform,
    development: __DEV__,
  }), []);
  const [snapshot, setSnapshot] = useState<ExchangeActivitySnapshot | null>(null);
  const [tab, setTab] = useState<ActivityTab>("authored");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [sessionStatus, setSessionStatus] = useState<"loading" | "guest" | "authenticated" | "expired" | "error">("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");
    try {
      const tokens = await readAuthTokens();
      if (!tokens) {
        setSessionStatus("guest");
        setSnapshot(null);
        return;
      }
      const next = await fetchMyExchangeActivity(runtime.apiBaseUrl, tokens.accessToken);
      setSnapshot(next);
      setSessionStatus("authenticated");
    } catch (cause) {
      if (cause instanceof ProfileApiError && cause.status === 401) {
        setSessionStatus("expired");
        return;
      }
      setSessionStatus("error");
      setError(cause instanceof Error ? cause.message : "내 교환 현황을 불러오지 못했어요.");
    } finally {
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const source = tab === "authored" ? snapshot?.authored ?? [] : snapshot?.applied ?? [];
  const items = source.filter((item) => {
    if (filter === "ACTIVE") return item.status === "OPEN" || item.status === "MATCHED";
    if (filter === "DONE") return item.status === "COMPLETED" || item.status === "CANCELLED";
    return true;
  });
  const assetBaseUrl = runtime.assetBaseUrl ?? (__DEV__ ? runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/exchange");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <DetailPageHeader title="내 교환 현황" titleMode="pixel" onBack={goBack} backLabel="교환방으로 돌아가기" />

      <View style={styles.tabs}>
        <TabButton label="등록한 글" active={tab === "authored"} onPress={() => setTab("authored")} />
        <TabButton label="신청한 교환" active={tab === "applied"} onPress={() => setTab("applied")} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
      >
        {sessionStatus === "loading" ? <ActivityIndicator style={styles.loader} color={colors.ink} /> : null}
        {sessionStatus === "guest" || sessionStatus === "expired" ? (
          <ProfileSessionGate status={sessionStatus} returnTo="/exchange/activity" guestBody="로그인하면 내가 등록하거나 신청한 교환을 확인할 수 있어요." />
        ) : null}
        {sessionStatus === "error" ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>교환 현황을 불러오지 못했어요</Text>
            <Text style={styles.emptyBody}>{error}</Text>
          </View>
        ) : null}

        {sessionStatus === "authenticated" ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>{source.length}건</Text>
              <View style={styles.filters}>
                <FilterButton label="전체" active={filter === "ALL"} onPress={() => setFilter("ALL")} />
                <FilterButton label="진행중" active={filter === "ACTIVE"} onPress={() => setFilter("ACTIVE")} />
                <FilterButton label="완료" active={filter === "DONE"} onPress={() => setFilter("DONE")} />
              </View>
            </View>
            {items.length ? items.map((item) => (
              <ActivityCard key={item.id} item={item} ipNames={snapshot?.ipNames ?? {}} assetBaseUrl={assetBaseUrl} />
            )) : (
              <View style={styles.emptyState}>
                <DecorativeIonicon name="chatbubble-ellipses-outline" size={46} color={seed.color.stroke.contrast} />
                <Text style={styles.emptyTitle}>{tab === "authored" ? "등록한 교환이 없어요" : "신청한 교환이 없어요"}</Text>
                <Text style={styles.emptyBody}>{tab === "authored" ? "보관함 상품으로 새 교환을 시작해 보세요." : "교환방에서 원하는 상품에 신청해 보세요."}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(tab === "authored" ? "/exchange/new" : "/exchange")}
                  style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
                >
                  <DecorativeIonicon name="add" size={20} color={colors.ink} />
                  <Text style={styles.emptyActionLabel}>{tab === "authored" ? "상품 올리기" : "교환방 바로가기"}</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && styles.pressed]}>
      <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function ActivityCard({ item, ipNames, assetBaseUrl }: { item: ExchangeCardItem; ipNames: Record<string, string>; assetBaseUrl: string | null }) {
  const products = item.products.length ? item.products : [item.product];
  const productDetails = products.map((product) => ({
    product,
    ipName: ipNames[product.ipId] ?? "작품 정보 없음",
  }));
  const accessibilityLabel = [
    item.title,
    statusLabel(item.status),
    ...productDetails.map(({ product, ipName }, index) => (
      `등록 상품 ${index + 1}/${products.length}, ${productSubjectTitle(product.name, ipName)}, ${catalogPriceLabel(product.price)}`
    )),
    `제안 ${item.offerCount}개`,
    "교환 상세 보기",
  ].join(". ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.push({ pathname: "/exchange/[listingId]", params: { listingId: item.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.cardImages, products.length === 1 && styles.cardImagesSingle]}>
        {productDetails.map(({ product, ipName }, index) => {
          const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
          return (
            <View
              key={`${product.id}-${index}`}
              accessible
              accessibilityLabel={`등록 상품 ${index + 1}/${products.length}: ${productSubjectTitle(product.name, ipName)}`}
              style={[styles.cardImage, products.length > 1 && styles.cardImageBundled]}
            >
              {uri ? <Image source={{ uri }} resizeMode="contain" style={styles.image} /> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardTopRow}>
          <Text numberOfLines={1} style={styles.cardTitle}>{item.title}</Text>
          <Text style={[
            styles.status,
            item.status === "COMPLETED" && styles.statusSuccess,
            item.status === "CANCELLED" && styles.statusCritical,
          ]}>{statusLabel(item.status)}</Text>
        </View>
        <View style={styles.cardProducts}>
          {productDetails.map(({ product, ipName }, index) => (
            <View key={`${product.id}-copy-${index}`} style={styles.cardProductRow}>
              <Text numberOfLines={1} style={styles.cardProduct}>
                {products.length > 1 ? `${index + 1}/${products.length} · ` : ""}{productSubjectTitle(product.name, ipName)}
              </Text>
              <Text style={styles.cardProductPrice}>{catalogPriceLabel(product.price)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.cardMeta}>제안 {item.offerCount}개</Text>
      </View>
      <DecorativeIonicon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function statusLabel(status: ExchangeCardItem["status"]): string {
  if (status === "OPEN") return "진행중";
  if (status === "MATCHED") return "확인 중";
  if (status === "COMPLETED") return "완료";
  return "종료";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  tabs: { minHeight: 58, flexDirection: "row", backgroundColor: seed.color.layer.default, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.greenInk },
  tabLabel: { color: colors.muted, ...seed.typography.bodyStrong },
  tabLabelActive: { color: colors.ink },
  content: { flexGrow: 1, paddingHorizontal: seed.spacing.globalGutter, paddingBottom: seed.spacing.screenBottom },
  loader: { marginTop: seed.spacing.x12 },
  summaryRow: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  summaryText: { color: colors.ink, ...seed.typography.bodyStrong },
  filters: { flexDirection: "row", gap: seed.spacing.x1_5 },
  filter: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2_5, borderRadius: seed.radius.full, justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  filterActive: { backgroundColor: seed.color.background.brandWeak },
  filterLabel: { color: colors.muted, ...seed.typography.caption, fontWeight: "700" },
  filterLabelActive: { color: colors.greenInk },
  card: { minHeight: 116, marginBottom: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.elevated, padding: seed.spacing.x3, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  cardImages: { width: 112, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x1 },
  cardImagesSingle: { width: 84 },
  cardImage: { width: 84, height: 84, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak, overflow: "hidden" },
  cardImageBundled: { width: 52, height: 68 },
  image: { width: "100%", height: "100%" },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  cardTitle: { flex: 1, color: colors.ink, ...seed.typography.bodyStrong },
  status: { overflow: "hidden", borderRadius: seed.radius.full, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, color: colors.greenInk, backgroundColor: seed.color.background.brandWeak, ...seed.typography.finePrint, fontWeight: "900" },
  statusSuccess: { color: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  statusCritical: { color: seed.color.foreground.critical, backgroundColor: seed.color.background.criticalWeak },
  cardProducts: { marginTop: seed.spacing.x2, gap: seed.spacing.x1 },
  cardProductRow: { flexDirection: "row", alignItems: "baseline", gap: seed.spacing.x2 },
  cardProduct: { flex: 1, color: colors.ink, ...seed.typography.bodyStrong },
  cardProductPrice: { color: colors.muted, ...seed.typography.caption },
  cardMeta: { marginTop: seed.spacing.x1, color: colors.muted, ...seed.typography.caption },
  emptyState: { minHeight: 420, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6 },
  emptyTitle: { marginTop: seed.spacing.x4, color: colors.ink, ...seed.typography.subtitle, textAlign: "center" },
  emptyBody: { marginTop: seed.spacing.x2, color: colors.muted, ...seed.typography.body, textAlign: "center" },
  emptyAction: { minHeight: seed.size.actionButton.large, marginTop: seed.spacing.x5, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid, paddingHorizontal: seed.spacing.x5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  emptyActionLabel: { color: colors.ink, ...seed.typography.button, fontWeight: "900" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
