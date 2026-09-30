import Constants from "expo-constants";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogIp, CatalogProduct } from "@dabboba/contracts";
import { CatalogProductRow } from "@/components/CatalogProductRow";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedIconButton, SeedInputShell } from "@/design-system/components";
import { subtleSectionHeaderRule } from "@/design-system/section";
import { seed } from "@/design-system/seed";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { fetchCatalogProductPage, fetchShopIps } from "@/features/shop/shop-api";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { colors } from "@/theme";

export function ProductSearchScreen() {
  const { revision: categorySettingsRevision } = useStorefrontCategorySettings();
  const router = useRouter();
  const params = useLocalSearchParams<{ ipId?: string | string[]; query?: string | string[] }>();
  const requestedIpId = firstParam(params.ipId);
  const requestedQuery = firstParam(params.query) ?? "";
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
  const [query, setQuery] = useState(requestedQuery);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [ips, setIps] = useState<CatalogIp[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const requestSequence = useRef(0);

  const normalizedQuery = normalize(query);
  const hasSearchConditions = Boolean(normalizedQuery || requestedIpId);

  const load = useCallback(async (cursor?: string) => {
    if (!hasSearchConditions) {
      requestSequence.current += 1;
      setProducts([]);
      setNextCursor(null);
      setLoading(false);
      setMessage("");
      return;
    }
    const append = Boolean(cursor);
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setProducts([]);
      setNextCursor(null);
    }
    try {
      const page = await fetchCatalogProductPage(runtime.apiBaseUrl, {
        query,
        ipId: requestedIpId,
        cursor,
        sort: "latest",
        limit: 20,
      });
      if (sequence !== requestSequence.current) return;
      setProducts((current) => append ? mergeUniqueProducts(current, page.products) : page.products);
      setNextCursor(page.nextCursor);
      setMessage("");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setMessage(error instanceof Error ? error.message : "검색할 상품을 불러오지 못했어요.");
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [categorySettingsRevision, hasSearchConditions, query, requestedIpId, runtime.apiBaseUrl]);

  useEffect(() => {
    void fetchShopIps(runtime.apiBaseUrl).then(setIps).catch(() => undefined);
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), normalizedQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load]);

  const ipNames = useMemo(
    () => new Map(ips.map((ip) => [ip.id, ip.nameKo])),
    [ips],
  );

  const goBack = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  const openProduct = (product: CatalogProduct) => {
    Keyboard.dismiss();
    router.push(`/product/${encodeURIComponent(product.id)}` as Href);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <SeedIconButton label="뒤로 가기" onPress={goBack}>
          <DecorativeIonicon name="chevron-back" size={27} color={colors.ink} />
        </SeedIconButton>
        <SeedInputShell focused={searchFocused} variant="search" style={styles.searchBox}>
          <DecorativeIonicon name="search-outline" size={20} color={colors.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => { setSearchFocused(false); Keyboard.dismiss(); }}
            placeholder="상품명·작품 검색"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="가챠와 쿠지 상품 검색"
          />
          {query ? (
            <SeedIconButton label="검색어 지우기" onPress={() => setQuery("")}>
              <DecorativeIonicon name="close-circle" size={20} color={colors.muted} />
            </SeedIconButton>
          ) : null}
        </SeedInputShell>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {loading ? (
          <State icon="search-outline" body="검색할 상품을 불러오는 중" loading />
        ) : message ? (
          <View style={styles.state}>
            <DecorativeIonicon name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.stateTitle}>{message}</Text>
            <SeedActionButton label="다시 불러오기" size="small" variant="neutralSolid" onPress={() => void load()} style={styles.retryButton} />
          </View>
        ) : !hasSearchConditions ? (
          <State icon="search-outline" title="무엇을 찾고 있나요?" body="상품명이나 작품 이름을 입력하면 등록 상품을 바로 찾아드려요." />
        ) : products.length ? (
          <>
            <View style={styles.resultHeader}>
              <KoreanPixelTitle variant="section">검색 결과</KoreanPixelTitle>
              <KoreanPixelTitleAccessory>{products.length}{nextCursor ? "+" : ""}개</KoreanPixelTitleAccessory>
            </View>
            <View style={styles.list}>
              {products.map((product) => (
                <CatalogProductRow key={product.id} product={product} ipName={ipNames.get(product.ipId) ?? "등록 작품"} assetBaseUrl={runtime.assetBaseUrl} onPress={() => openProduct(product)} />
              ))}
            </View>
            {nextCursor ? (
              <SeedActionButton
                label={loadingMore ? "불러오는 중" : "상품 더 보기"}
                disabled={loadingMore}
                loading={loadingMore}
                size="small"
                variant="neutralSolid"
                onPress={() => void load(nextCursor)}
                style={styles.loadMoreButton}
              />
            ) : null}
          </>
        ) : (
          <State icon="search-outline" title="검색 결과가 없어요" body="띄어쓰기나 작품 이름을 바꿔 다시 검색해 보세요." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function State({ icon, title, body, loading = false }: { icon: DecorativeIoniconName; title?: string; body: string; loading?: boolean }) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={colors.ink} /> : <DecorativeIonicon name={icon} size={34} color={colors.muted} />}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateBody}>{body}</Text>
    </View>
  );
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mergeUniqueProducts(current: readonly CatalogProduct[], incoming: readonly CatalogProduct[]) {
  const byId = new Map(current.map((product) => [product.id, product]));
  for (const product of incoming) byId.set(product.id, product);
  return [...byId.values()];
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x2_5, gap: seed.spacing.x1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center" },
  searchBox: { flex: 1 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 11 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14, ...subtleSectionHeaderRule },
  list: { gap: 12 },
  state: { minHeight: 430, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, ...seed.typography.subtitle, textAlign: "center", marginTop: 13 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  retryButton: { marginTop: seed.spacing.x4 },
  loadMoreButton: { alignSelf: "center", marginTop: seed.spacing.x4 },
});
