import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogProduct } from "@dabboba/contracts";
import { CatalogProductRow } from "@/components/CatalogProductRow";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { isCustomerBrowsableCatalogCategory } from "@/features/catalog/product-categories";
import { fetchShopSnapshot, type ShopSnapshot } from "@/features/shop/shop-api";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { colors } from "@/theme";

export function ProductSearchScreen() {
  const router = useRouter();
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
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<ShopSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchShopSnapshot(runtime.apiBaseUrl));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검색할 상품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const ipNames = useMemo(
    () => new Map(snapshot?.ips.map((ip) => [ip.id, ip.nameKo]) ?? []),
    [snapshot?.ips],
  );
  const normalizedQuery = normalize(query);
  const results = useMemo(() => {
    if (!snapshot || !normalizedQuery) return [];
    return snapshot.products.filter((product) =>
      isCustomerBrowsableCatalogCategory(product.category)
      && normalize([
        product.name,
        product.sku,
        product.manufacturer ?? "",
        ipNames.get(product.ipId) ?? "",
      ].join(" ")).includes(normalizedQuery));
  }, [ipNames, normalizedQuery, snapshot]);

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
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={styles.headerAction}>
          <Ionicons name="chevron-back" size={27} color={colors.ink} />
        </Pressable>
        <SeedInputShell focused={searchFocused} variant="search" style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => { setSearchFocused(false); Keyboard.dismiss(); }}
            placeholder="상품명·작품 검색"
            placeholderTextColor="#8D948C"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" hitSlop={8} onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          ) : null}
        </SeedInputShell>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {loading ? (
          <State icon="search-outline" body="검색할 상품을 불러오는 중" loading />
        ) : message ? (
          <View style={styles.state}>
            <Ionicons name="alert-circle-outline" size={34} color={colors.muted} />
            <Text style={styles.stateTitle}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryLabel}>다시 불러오기</Text></Pressable>
          </View>
        ) : !normalizedQuery ? (
          <State icon="search-outline" title="무엇을 찾고 있나요?" body="상품명이나 작품 이름을 입력하면 등록 상품을 바로 찾아드려요." />
        ) : results.length ? (
          <>
            <View style={styles.resultHeader}><KoreanPixelTitle variant="section">검색 결과</KoreanPixelTitle><KoreanPixelTitleAccessory>{results.length}개</KoreanPixelTitleAccessory></View>
            <View style={styles.list}>
              {results.map((product) => (
                <CatalogProductRow key={product.id} product={product} ipName={ipNames.get(product.ipId) ?? "등록 작품"} assetBaseUrl={runtime.assetBaseUrl} onPress={() => openProduct(product)} />
              ))}
            </View>
          </>
        ) : (
          <State icon="search-outline" title="검색 결과가 없어요" body="띄어쓰기나 작품 이름을 바꿔 다시 검색해 보세요." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function State({ icon, title, body, loading = false }: { icon: keyof typeof Ionicons.glyphMap; title?: string; body: string; loading?: boolean }) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={colors.ink} /> : <Ionicons name={icon} size={34} color={colors.muted} />}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateBody}>{body}</Text>
    </View>
  );
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.x2_5, gap: seed.spacing.x1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  searchBox: { flex: 1 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 11 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4, paddingBottom: seed.spacing.screenBottom },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  list: { gap: 12 },
  state: { minHeight: 430, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: "900", textAlign: "center", marginTop: 13 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  retryButton: { minHeight: 42, justifyContent: "center", paddingHorizontal: 16, marginTop: 15, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 13, fontWeight: "800" },
});
