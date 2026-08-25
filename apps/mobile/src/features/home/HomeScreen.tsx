import Constants from "expo-constants";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogIp, CatalogProduct } from "@dabboba/contracts";
import { fetchHomeCatalog, type HomeCatalogSnapshot } from "@/features/catalog/catalog-api";
import { readHomeCatalogCache, writeHomeCatalogCache } from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/dabboba-wordmark.png");
const CATEGORIES = ["전체", "가챠", "피규어", "쿠지", "카드"] as const;

type LoadSource = "live" | "cache" | "empty";

export function HomeScreen() {
  const db = useSQLiteContext();
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
  const [snapshot, setSnapshot] = useState<HomeCatalogSnapshot | null>(null);
  const [source, setSource] = useState<LoadSource>("empty");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const fresh = await fetchHomeCatalog(runtime.apiBaseUrl);
        setSnapshot(fresh);
        setSource("live");
        setMessage("");
        await writeHomeCatalogCache(db, fresh);
      } catch (error) {
        const cached = await readHomeCatalogCache(db);
        if (cached) {
          setSnapshot(cached);
          setSource("cache");
          setMessage("연결이 불안정해 마지막으로 저장한 목록을 보여드려요.");
        } else {
          setSource("empty");
          setMessage(error instanceof Error ? error.message : "카탈로그를 불러오지 못했습니다.");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [db, runtime.apiBaseUrl],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        <HomeHeader />
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>NATIVE APP</Text>
          <Text style={styles.heroTitle}>원하는 거 다 뽑아</Text>
          <Text style={styles.heroBody}>DABBOBA의 첫 네이티브 홈이 API 카탈로그와 연결됐어요.</Text>
        </View>

        {message ? (
          <View style={[styles.notice, source === "empty" && styles.noticeError]}>
            <Text style={styles.noticeText}>{message}</Text>
            {source === "empty" ? (
              <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.retry}>
                <Text style={styles.retryLabel}>다시 불러오기</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!snapshot && !message ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.loadingText}>카탈로그를 불러오는 중</Text>
          </View>
        ) : null}

        {snapshot ? (
          <>
            <SectionTitle eyebrow="IP SELECT" title="인기 작품" trailing={`${snapshot.ips.length}개`} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ipRail}
            >
              {snapshot.ips.map((ip, index) => (
                <IpCard key={ip.id} ip={ip} rank={index + 1} assetBaseUrl={runtime.assetBaseUrl} />
              ))}
            </ScrollView>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRail}
            >
              {CATEGORIES.map((category, index) => (
                <View key={category} style={[styles.categoryChip, index === 0 && styles.categoryChipActive]}>
                  <Text style={[styles.categoryLabel, index === 0 && styles.categoryLabelActive]}>
                    {category}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <SectionTitle
              eyebrow="AVAILABLE NOW"
              title="지금 만날 수 있어요"
              trailing={`${snapshot.products.length}개`}
            />
            <View style={styles.productGrid}>
              {snapshot.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  assetBaseUrl={runtime.assetBaseUrl}
                />
              ))}
            </View>
            <Text style={styles.sourceNote}>
              {source === "live" ? "Fastify API에서 방금 불러옴" : "기기에 저장된 삭제 가능한 캐시"}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeHeader() {
  return (
    <View style={styles.header}>
      <Image source={WORDMARK} resizeMode="contain" style={styles.wordmark} accessibilityLabel="DABBOBA" />
      <View style={styles.pointsPill}>
        <Text style={styles.pointsLabel}>0P</Text>
      </View>
    </View>
  );
}

function SectionTitle({ eyebrow, title, trailing }: { eyebrow: string; title: string; trailing: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Text style={styles.sectionTrailing}>{trailing}</Text>
    </View>
  );
}

function IpCard({
  ip,
  rank,
  assetBaseUrl,
}: {
  ip: CatalogIp;
  rank: number;
  assetBaseUrl: string | null;
}) {
  const uri = resolveCatalogImageUrl(ip.imageUrl, assetBaseUrl);
  return (
    <View style={styles.ipCard}>
      <View style={styles.ipImageFrame}>
        {uri ? <Image source={{ uri }} style={styles.coverImage} resizeMode="cover" /> : <MediaPlaceholder />}
        <View style={styles.rankBadge}>
          <Text style={styles.rankLabel}>{String(rank).padStart(2, "0")}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.ipName}>{ip.nameKo}</Text>
    </View>
  );
}

function ProductCard({
  product,
  assetBaseUrl,
}: {
  product: CatalogProduct;
  assetBaseUrl: string | null;
}) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl);
  return (
    <View style={styles.productCard}>
      <View style={styles.productImageFrame}>
        {uri ? <Image source={{ uri }} style={styles.productImage} resizeMode="contain" /> : <MediaPlaceholder />}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeLabel}>{categoryLabel(product.category)}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
      <Text style={styles.productPrice}>{product.price.toLocaleString("ko-KR")}원</Text>
    </View>
  );
}

function MediaPlaceholder() {
  return (
    <View style={styles.mediaPlaceholder}>
      <Text style={styles.mediaPlaceholderLabel}>IMAGE READY</Text>
    </View>
  );
}

function categoryLabel(category: CatalogProduct["category"]): string {
  if (category === "gacha") return "가챠";
  if (category === "figure") return "피규어";
  if (category === "kuji") return "쿠지";
  return "카드";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingBottom: 34 },
  header: {
    minHeight: 60,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  wordmark: { width: 136, height: 20 },
  pointsPill: {
    minWidth: 52,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pointsLabel: { color: colors.ink, fontFamily: "monospace", fontWeight: "900", fontSize: 16 },
  hero: {
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 22,
    padding: 22,
    backgroundColor: colors.black,
  },
  heroEyebrow: { color: colors.brand, fontFamily: "monospace", fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  heroTitle: { color: colors.white, fontSize: 27, lineHeight: 35, fontWeight: "900", marginTop: 8 },
  heroBody: { color: "#C8D1C9", fontSize: 14, lineHeight: 21, marginTop: 8 },
  notice: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 15,
    backgroundColor: "#E9F7E7",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  noticeError: { backgroundColor: "#F8E9E5" },
  noticeText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 12, fontWeight: "800" },
  loading: { paddingVertical: 60, alignItems: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 14 },
  sectionHeader: {
    marginTop: 30,
    marginBottom: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sectionEyebrow: { color: colors.muted, fontFamily: "monospace", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  sectionTitle: { color: colors.ink, fontSize: 24, lineHeight: 31, fontWeight: "900", marginTop: 4 },
  sectionTrailing: { color: colors.muted, fontSize: 14, fontWeight: "700", paddingBottom: 3 },
  ipRail: { paddingHorizontal: 20, gap: 12 },
  ipCard: { width: 144 },
  ipImageFrame: { height: 154, borderRadius: 17, overflow: "hidden", backgroundColor: colors.black, borderWidth: 1, borderColor: colors.line },
  coverImage: { width: "100%", height: "100%" },
  rankBadge: { position: "absolute", top: 8, left: 8, borderRadius: 8, backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 6 },
  rankLabel: { color: colors.ink, fontFamily: "monospace", fontSize: 9, fontWeight: "900" },
  ipName: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "800", marginTop: 9 },
  categoryRail: { paddingHorizontal: 20, paddingTop: 28, gap: 9 },
  categoryChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  categoryChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  categoryLabel: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  categoryLabelActive: { color: colors.ink },
  productGrid: { paddingHorizontal: 20, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 22 },
  productCard: { width: "48%" },
  productImageFrame: { aspectRatio: 1, borderRadius: 17, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  productImage: { width: "100%", height: "100%" },
  categoryBadge: { position: "absolute", top: 9, left: 9, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  productName: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 9 },
  productPrice: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 5 },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 14, backgroundColor: "#EEF0EA" },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", fontSize: 9, fontWeight: "700", textAlign: "center" },
  sourceNote: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 28, paddingHorizontal: 20 },
});
