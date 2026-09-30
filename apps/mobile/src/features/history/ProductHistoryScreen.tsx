import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogProduct } from "@dabboba/contracts";
import { CatalogProductRow } from "@/components/CatalogProductRow";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton, SeedChip, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { profileSectionFailure } from "@/features/profile/profile-section-state";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { fetchShopSnapshot, type ShopSnapshot } from "@/features/shop/shop-api";
import { readRecentlyViewedProductIds } from "@/lib/local-database";
import { colors } from "@/theme";

type HistoryMode = "viewed" | "drawn" | "wishlist";

export function ProductHistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const profileState = useProfileSnapshot("history");
  const [mode, setMode] = useState<HistoryMode>("viewed");
  const [catalog, setCatalog] = useState<ShopSnapshot | null>(null);
  const [viewedIds, setViewedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const hasFocusedOnce = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const [ids, shop] = await Promise.all([
        readRecentlyViewedProductIds(db),
        fetchShopSnapshot(profileState.runtime.apiBaseUrl),
      ]);
      setViewedIds(ids);
      setCatalog(shop);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [db, profileState.runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(useCallback(() => {
    if (hasFocusedOnce.current) {
      void load(true);
      void profileState.reload();
    } else {
      hasFocusedOnce.current = true;
    }
  }, [load, profileState.reload]));

  const ipNames = useMemo(
    () => new Map(catalog?.ips.map((ip) => [ip.id, ip.nameKo]) ?? []),
    [catalog?.ips],
  );
  const productById = useMemo(
    () => new Map(catalog?.products.map((product) => [product.id, product]) ?? []),
    [catalog?.products],
  );
  const viewedProducts = viewedIds
    .map((id) => productById.get(id))
    .filter((product): product is CatalogProduct => Boolean(product));
  const drawnInventory = profileState.snapshot?.inventory?.filter(
    (unit) => unit.sourceType === "GACHA" || unit.sourceType === "KUJI",
  ) ?? [];
  const wishlistItems = profileState.snapshot?.wishlist ?? [];
  const needsProfile = mode === "drawn" || mode === "wishlist";
  const blockedStatus = needsProfile && isProfileSessionBlocked(profileState.status)
    ? profileState.status
    : null;
  // A failed personal section renders the retryable failure, never an empty list.
  const profileSectionMessage = needsProfile && profileState.snapshot && profileState.status === "authenticated"
    ? profileSectionFailure(profileState.snapshot, mode === "drawn" ? "inventory" : "wishlist")
    : null;
  const retry = () => {
    void load(true);
    if (needsProfile) void profileState.reload();
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  const openProduct = (productId: string) => router.push(`/product/${encodeURIComponent(productId)}` as Href);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailPageHeader title="상품 기록" titleMode="pixel" onBack={goBack} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />}
      >
        <View style={styles.segment}>
          <SegmentButton active={mode === "viewed"} label="내가 본 상품" onPress={() => setMode("viewed")} />
          <SegmentButton active={mode === "drawn"} label="내가 뽑은 상품" onPress={() => setMode("drawn")} />
          <SegmentButton active={mode === "wishlist"} label="찜한 상품" onPress={() => setMode("wishlist")} />
        </View>

        <SeedInlineGuidance style={styles.description}>
          {mode === "viewed"
            ? "최근 열어본 상품은 이 기기에만 저장되며 언제든 지울 수 있는 기록이에요."
            : mode === "drawn"
              ? "가챠·쿠지 결과로 내 보관함에 확정된 상품만 보여드려요."
              : "관심 표시한 상품을 모아보고 바로 상세 화면으로 이동할 수 있어요."}
        </SeedInlineGuidance>

        {blockedStatus ? (
          <ProfileSessionGate status={blockedStatus} returnTo="/product-history" guestBody="로그인하면 내가 뽑은 상품과 찜한 상품을 확인할 수 있어요." />
        ) : loading || (needsProfile && profileState.status === "loading") ? (
          <View style={styles.state}><ActivityIndicator color={colors.ink} /><Text style={styles.stateBody}>상품 기록을 불러오는 중</Text></View>
        ) : message || (needsProfile && profileState.status === "error") || profileSectionMessage ? (
          <View style={styles.state}><DecorativeIonicon name="alert-circle-outline" size={32} color={colors.muted} /><Text style={styles.stateTitle}>{message || profileState.message || profileSectionMessage}</Text><SeedActionButton label="다시 불러오기" size="small" variant="neutralSolid" onPress={retry} style={styles.retryButton} /></View>
        ) : mode === "viewed" ? (
          viewedProducts.length ? (
            <View style={styles.list}>
              {viewedProducts.map((product) => <CatalogProductRow key={product.id} product={product} ipName={ipNames.get(product.ipId) ?? "등록 작품"} assetBaseUrl={profileState.runtime.assetBaseUrl} onPress={() => openProduct(product.id)} />)}
            </View>
          ) : (
            <EmptyState icon="eye-outline" title="아직 본 상품이 없어요" body="상품 상세를 열어보면 최근 순서대로 여기에 기록돼요." />
          )
        ) : mode === "drawn" ? drawnInventory.length ? (
          <View style={styles.list}>
            {drawnInventory.map((unit) => (
              <CatalogProductRow
                key={unit.id}
                product={unit.product}
                ipName={ipNames.get(unit.product.ipId) ?? "등록 작품"}
                assetBaseUrl={profileState.runtime.assetBaseUrl}
                caption={`${unit.sourceType === "GACHA" ? "가챠" : "쿠지"} · ${formatDate(unit.acquiredAt)} 획득`}
                onPress={() => openProduct(unit.product.id)}
              />
            ))}
          </View>
        ) : (
          <EmptyState icon="cube-outline" title="아직 뽑은 상품이 없어요" body="서버에서 확정된 가챠·쿠지 결과가 보관함에 등록되면 표시돼요." />
        ) : wishlistItems.length ? (
          <View style={styles.list}>
            {wishlistItems.map((item) => (
              <CatalogProductRow
                key={item.id}
                product={item.product}
                ipName={item.product.ipNameKo}
                assetBaseUrl={profileState.runtime.assetBaseUrl}
                caption={`${formatDate(item.wishedAt)} 찜`}
                onPress={() => openProduct(item.product.id)}
              />
            ))}
          </View>
        ) : (
          <EmptyState icon="heart-outline" title="아직 찜한 상품이 없어요" body="상품 상세에서 하트를 누르면 여기에 모아볼 수 있어요." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <SeedChip label={label} selected={active} onPress={onPress} style={styles.segmentButton} />;
}

function EmptyState({ icon, title, body }: { icon: DecorativeIoniconName; title: string; body: string }) {
  return <View style={styles.state}><DecorativeIonicon name={icon} size={34} color={colors.muted} /><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateBody}>{body}</Text></View>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  segment: { flexDirection: "row", gap: seed.spacing.betweenChips },
  segmentButton: { flex: 1 },
  description: { marginTop: 14 },
  list: { marginTop: 18, gap: 12 },
  state: { minHeight: 330, paddingHorizontal: 26, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: "900", textAlign: "center", marginTop: 12 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 },
  retryButton: { marginTop: seed.spacing.x4 },
});
