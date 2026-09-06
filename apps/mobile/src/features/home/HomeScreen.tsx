import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogProduct } from "@dabboba/contracts";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { RootHeaderActions } from "@/components/RootHeaderActions";
import { KoreanPixelTitle, KoreanPixelTitleAccessory } from "@/components/RootCategoryTitle";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { AppText as Text } from "@/components/Typography";
import { SeedChip } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { fetchHomeCatalog, type HomeCatalogSnapshot } from "@/features/catalog/catalog-api";
import {
  isCustomerBrowsableCatalogCategory,
  PRODUCT_CATEGORY_OPTIONS,
  productCategoryLabel,
  type ProductCategoryLabel,
} from "@/features/catalog/product-categories";
import { AnnouncementTicker } from "@/features/home/AnnouncementTicker";
import {
  DEFAULT_HOME_COLLECTION_IP_IDS,
  HOME_PRODUCT_CARD_WIDTH,
  type DrawActivityItem,
  buildDrawActivityExamples,
  buildDrawActivityTickerWindow,
  buildConfiguredHomeCollections,
  buildHomeCollections,
  getContinuousTickerLoopDistance,
  getHomeProductCardWidth,
  homeAnnouncementMessages,
} from "@/features/home/home-feed";
import { productSubjectTitle } from "@/features/shop/product-title";
import { readHomeCatalogCache, writeHomeCatalogCache } from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/dabboba-wordmark.png");
const CATEGORIES: readonly ("전체" | ProductCategoryLabel)[] = [
  "전체",
  ...PRODUCT_CATEGORY_OPTIONS.map(({ label }) => label),
];
const DRAW_ACTIVITY_ROW_HEIGHT = 40;
const DRAW_ACTIVITY_VISIBLE_ROWS = 3;
const DRAW_ACTIVITY_HOLD_MS = 4_000;
const DRAW_ACTIVITY_RISE_MS = 1_050;
const DRAW_ACTIVITY_MARQUEE_GAP = 24;

type LoadSource = "live" | "cache" | "empty";

export function HomeScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const db = useSQLiteContext();
  const router = useRouter();
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
  const [selectedCategory, setSelectedCategory] = useState<(typeof CATEGORIES)[number]>("전체");
  const ipNames = useMemo(
    () => new Map(snapshot?.ips.map((ip) => [ip.id, ip.nameKo]) ?? []),
    [snapshot?.ips],
  );

  const visibleProducts = useMemo(() => {
    const products = snapshot?.products.filter((product) => product.isActive && !product.isPrizeOnly) ?? [];
    if (selectedCategory === "전체") return products;
    return products.filter((product) => productCategoryLabel(product.category) === selectedCategory);
  }, [selectedCategory, snapshot]);
  const todayProducts = visibleProducts.slice(0, 4);
  const announcementMessages = useMemo(
    () => homeAnnouncementMessages(snapshot?.notices ?? []),
    [snapshot?.notices],
  );
  const drawActivityItems = useMemo(
    () => (
      __DEV__
        ? buildDrawActivityExamples(snapshot?.products ?? [], snapshot?.ips ?? [], productSubjectTitle)
        : []
    ),
    [snapshot?.ips, snapshot?.products],
  );
  const homeCollections = useMemo(() => {
    if (!snapshot) return [];
    if (snapshot.homeSections?.configured) {
      return buildConfiguredHomeCollections(snapshot.homeSections.items);
    }
    const configured = buildHomeCollections(snapshot.ips, snapshot.products, DEFAULT_HOME_COLLECTION_IP_IDS);
    if (configured.length) return configured;
    return buildHomeCollections(snapshot.ips, snapshot.products, snapshot.ips.slice(0, 2).map((ip) => ip.id));
  }, [snapshot]);

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
          setSnapshot({
            ...cached,
            products: cached.products.filter((product) => (
              isCustomerBrowsableCatalogCategory(product.category)
            )),
          });
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
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.ink} />
        }
      >
        <HomeHeader />
        <AnnouncementTicker
          messages={announcementMessages}
          onPress={(announcement) => {
            const notice = snapshot?.notices.find((item) => (
              item.isPinned
              && item.isPublished
              && item.status === "ACTIVE"
              && item.title.trim() === announcement
            ));
            if (notice) {
              router.push(`/profile/notices/${encodeURIComponent(notice.id)}` as Href);
              return;
            }
            router.push("/profile/support" as Href);
          }}
        />

        {message ? (
          <View style={[styles.connectionNotice, source === "empty" && styles.connectionNoticeError]}>
            <Text style={styles.connectionNoticeText}>{message}</Text>
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
            <Text style={styles.loadingText}>홈을 불러오는 중</Text>
          </View>
        ) : null}

        {snapshot ? (
          <>
            <DrawActivityPanel
              items={drawActivityItems}
              onProductPress={(productId) => router.push(`/product/${encodeURIComponent(productId)}` as Href)}
            />

            <SectionTitle title="오늘의 뽀바" trailing={`${todayProducts.length}개`} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRail}
            >
              {CATEGORIES.map((category) => (
                <SeedChip
                  key={category}
                  label={category}
                  selected={selectedCategory === category}
                  onPress={() => setSelectedCategory(category)}
                />
              ))}
            </ScrollView>

            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.productRail}
            >
              {todayProducts.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  ipName={ipNames.get(product.ipId) ?? "등록 작품"}
                  assetBaseUrl={runtime.assetBaseUrl}
                  divided={index < todayProducts.length - 1}
                  onPress={() => router.push(`/product/${encodeURIComponent(product.id)}` as Href)}
                />
              ))}
            </ScrollView>

            {homeCollections.map((collection) => (
              <View key={collection.id}>
                <SectionTitle
                  title={collection.title}
                  trailing="전체보기"
                  onTrailingPress={() => router.push({ pathname: "/(tabs)/ppoba", params: { ipId: collection.ip.id } } as Href)}
                />
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.productRail}
                >
                  {collection.products.map((product, index) => (
                    <CollectionProductCard
                      key={product.id}
                      product={product}
                      ipName={collection.ip.nameKo}
                      assetBaseUrl={runtime.assetBaseUrl}
                      divided={index < collection.products.length - 1}
                      onPress={() => router.push(`/product/${encodeURIComponent(product.id)}` as Href)}
                    />
                  ))}
                </ScrollView>
              </View>
            ))}

            <EventNoticeCard onPress={() => router.push("/profile/support" as Href)} />
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
      <RootHeaderActions />
    </View>
  );
}

function SectionTitle({
  title,
  trailing,
  onTrailingPress,
}: {
  title: string;
  trailing?: string;
  onTrailingPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <KoreanPixelTitle variant="section">{title}</KoreanPixelTitle>
      {onTrailingPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${title} ${trailing}`} onPress={onTrailingPress} style={styles.sectionTrailingButton}>
          <KoreanPixelTitleAccessory>{trailing}</KoreanPixelTitleAccessory>
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
        </Pressable>
      ) : trailing ? <KoreanPixelTitleAccessory>{trailing}</KoreanPixelTitleAccessory> : null}
    </View>
  );
}

function DrawActivityPanel({
  items,
  onProductPress,
}: {
  items: ReturnType<typeof buildDrawActivityExamples>;
  onProductPress: (productId: string) => void;
}) {
  const [startIndex, setStartIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const translateY = useRef(new Animated.Value(0)).current;
  const itemSignature = useMemo(() => items.map((item) => item.id).join("|"), [items]);
  const visibleRowCount = Math.min(DRAW_ACTIVITY_VISIBLE_ROWS, items.length);
  const tickerItems = useMemo(
    () => buildDrawActivityTickerWindow(items, startIndex, DRAW_ACTIVITY_VISIBLE_ROWS),
    [items, startIndex],
  );

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);
    setStartIndex(0);
  }, [itemSignature, translateY]);

  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);
    if (reduceMotion || items.length <= 1) return undefined;

    const animation = Animated.sequence([
      Animated.delay(DRAW_ACTIVITY_HOLD_MS),
      Animated.timing(translateY, {
        toValue: -DRAW_ACTIVITY_ROW_HEIGHT,
        duration: DRAW_ACTIVITY_RISE_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setStartIndex((current) => (current + 1) % items.length);
    });
    return () => animation.stop();
  }, [itemSignature, items.length, reduceMotion, startIndex, translateY]);

  return (
    <>
      <SectionTitle title="방금 뽑았어요" />
      <View style={styles.activityCard}>
        {items.length ? (
          <View style={[styles.activityViewport, { height: visibleRowCount * DRAW_ACTIVITY_ROW_HEIGHT }]}>
            <Animated.View style={{ transform: [{ translateY }] }}>
              {tickerItems.map((item, index) => (
                <Pressable
                  key={`${item.id}-${tickerItems.slice(0, index).filter((candidate) => candidate.id === item.id).length}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.message} 상품 보기`}
                  accessibilityElementsHidden={index >= visibleRowCount}
                  importantForAccessibility={index >= visibleRowCount ? "no-hide-descendants" : "auto"}
                  pointerEvents={index >= visibleRowCount ? "none" : "auto"}
                  onPress={() => onProductPress(item.productId)}
                  style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}
                >
                  <View style={styles.activityDot} />
                  <DrawActivityMarquee item={item} />
                  <Text style={styles.activityTime}>방금</Text>
                </Pressable>
              ))}
            </Animated.View>
            {Array.from({ length: Math.max(visibleRowCount - 1, 0) }, (_, index) => (
              <View
                key={`divider-${index}`}
                pointerEvents="none"
                style={[styles.activityRowDivider, { top: (index + 1) * DRAW_ACTIVITY_ROW_HEIGHT }]}
              />
            ))}
          </View>
        ) : <Text style={styles.activityEmpty}>새로운 뽑기 소식을 준비하고 있어요.</Text>}
      </View>
    </>
  );
}

function DrawActivityMarquee({ item }: { item: DrawActivityItem }) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const loopDistance = getContinuousTickerLoopDistance(
    viewportWidth,
    textWidth,
    DRAW_ACTIVITY_MARQUEE_GAP,
  );
  const shouldLoop = loopDistance > 0;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);
    if (reduceMotion || !shouldLoop) return undefined;

    const animation = Animated.loop(Animated.timing(translateX, {
      toValue: -loopDistance,
      duration: Math.max(4_800, loopDistance * 28),
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [loopDistance, reduceMotion, shouldLoop, translateX]);

  return (
    <View
      style={styles.activityTextViewport}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
    >
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.activityMeasureLayer}
      >
        <DrawActivityMessage
          item={item}
          measure
          onMeasured={(width) => setTextWidth((current) => current === width ? current : width)}
        />
      </View>
      <Animated.View
        style={[
          styles.activityTextTrack,
          shouldLoop && styles.activityTextLoopTrack,
          {
            width: shouldLoop
              ? textWidth * 2 + DRAW_ACTIVITY_MARQUEE_GAP
              : Math.max(textWidth, viewportWidth),
            transform: [{ translateX }],
          },
        ]}
      >
        <DrawActivityMessage
          item={item}
          width={shouldLoop ? textWidth : Math.max(textWidth, viewportWidth)}
        />
        {shouldLoop ? (
          <>
            <View style={styles.activityTextLoopGap} />
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <DrawActivityMessage item={item} width={textWidth} />
            </View>
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

function DrawActivityMessage({
  item,
  measure = false,
  onMeasured,
  width,
}: {
  item: DrawActivityItem;
  measure?: boolean;
  onMeasured?: (width: number) => void;
  width?: number;
}) {
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="clip"
      style={[styles.activityText, measure && styles.activityMeasureText, width ? { width } : null]}
      onTextLayout={measure ? (event) => onMeasured?.(event.nativeEvent.lines[0]?.width ?? 0) : undefined}
    >
      <Text style={styles.activityPerson}>{item.personName}님</Text>
      <Text>이 </Text>
      <Text style={styles.activityProduct}>{item.productName}</Text>
      <Text>{item.objectParticle} 뽑았어요</Text>
    </Text>
  );
}

function ProductCard({
  product,
  ipName,
  assetBaseUrl,
  divided,
  onPress,
}: {
  product: CatalogProduct;
  ipName: string;
  assetBaseUrl: string | null;
  divided: boolean;
  onPress: () => void;
}) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = getHomeProductCardWidth(product.category, viewportWidth, seed.spacing.globalGutter);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.productCard, { width: cardWidth }, pressed && styles.pressed]}
    >
      <HomeProductMedia uri={uri} category={product.category} variant="today" showBadge />
      <Text numberOfLines={1} style={styles.productIp}>{ipName}</Text>
      <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text>
      <ProductInfoDivider style={styles.productFieldDivider} />
      <Text style={styles.productPrice}>{product.price.toLocaleString("ko-KR")}원</Text>
      {divided ? <ProductInfoDivider orientation="vertical" style={styles.productCardDivider} /> : null}
    </Pressable>
  );
}

function CollectionProductCard({
  product,
  ipName,
  assetBaseUrl,
  divided,
  onPress,
}: {
  product: CatalogProduct;
  ipName: string;
  assetBaseUrl: string | null;
  divided: boolean;
  onPress: () => void;
}) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = getHomeProductCardWidth(product.category, viewportWidth, seed.spacing.globalGutter);
  const isKuji = product.category === "kuji";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.collectionCard, { width: cardWidth }, pressed && styles.pressed]}
    >
      <HomeProductMedia uri={uri} category={product.category} variant="collection" showBadge={isKuji} />
      <Text numberOfLines={1} style={styles.collectionProductIp}>{ipName}</Text>
      <Text numberOfLines={2} style={styles.collectionProductName}>{productSubjectTitle(product.name, ipName)}</Text>
      <ProductInfoDivider style={styles.productFieldDivider} />
      <Text style={styles.collectionProductMeta}>{productCategoryLabel(product.category)} · {product.price.toLocaleString("ko-KR")}원</Text>
      {divided ? <ProductInfoDivider orientation="vertical" style={styles.productCardDivider} /> : null}
    </Pressable>
  );
}

function HomeProductMedia({
  uri,
  category,
  variant,
  showBadge,
}: {
  uri: string | null;
  category: CatalogProduct["category"];
  variant: "today" | "collection";
  showBadge: boolean;
}) {
  const isKuji = category === "kuji";
  const fallbackAspectRatio = isKuji ? 16 / 9 : variant === "today" ? 1 : 1.24;
  const [imageAspectRatio, setImageAspectRatio] = useState(fallbackAspectRatio);

  useEffect(() => {
    let active = true;
    setImageAspectRatio(fallbackAspectRatio);
    if (!isKuji || !uri) return () => { active = false; };

    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setImageAspectRatio(width / height);
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [fallbackAspectRatio, isKuji, uri]);

  return (
    <GachaMachineFrame category={category}>
      <KujiProductFrame category={category}>
        <View
          style={[
            variant === "today" ? styles.productImageFrame : styles.collectionImageFrame,
            category === "gacha" && styles.gachaMachineMediaWindow,
            category === "kuji" && styles.kujiProductMediaWindow,
            { aspectRatio: imageAspectRatio },
          ]}
        >
          {uri ? (
            <Image
              source={{ uri }}
              resizeMode={isKuji ? "contain" : "cover"}
              style={styles.productImage}
              onLoad={({ nativeEvent }) => {
                if (!isKuji) return;
                const { width, height } = nativeEvent.source;
                if (width > 0 && height > 0) setImageAspectRatio(width / height);
              }}
            />
          ) : <MediaPlaceholder />}
          {showBadge && category !== "gacha" ? (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeLabel}>{productCategoryLabel(category)}</Text>
            </View>
          ) : null}
        </View>
      </KujiProductFrame>
    </GachaMachineFrame>
  );
}

function EventNoticeCard({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.eventSection}>
      <SectionTitle title="이벤트" trailing="알림" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="이벤트 알림 보기"
        onPress={onPress}
        style={({ pressed }) => [styles.eventCard, pressed && styles.pressed]}
      >
        <View style={styles.eventIcon}><Ionicons name="gift-outline" size={22} color={colors.ink} /></View>
        <View style={styles.eventCopy}>
          <KoreanPixelTitle variant="compact">새 이벤트 준비 중</KoreanPixelTitle>
          <Text style={styles.eventBody}>진행 중인 혜택이 생기면 이곳에서 가장 먼저 알려드릴게요.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.greenInk} />
      </Pressable>
    </View>
  );
}

function MediaPlaceholder() {
  return (
    <View style={styles.mediaPlaceholder}>
      <Text style={styles.mediaPlaceholderLabel}>이미지 준비 중</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  header: {
    minHeight: 48,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
  },
  wordmark: { width: 116, height: 17 },
  connectionNotice: {
    marginHorizontal: seed.spacing.globalGutter,
    marginTop: seed.spacing.x2,
    borderRadius: seed.radius.r3,
    backgroundColor: seed.color.background.brandWeak,
    padding: seed.spacing.x3,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  connectionNoticeError: { backgroundColor: seed.color.background.criticalWeak },
  connectionNoticeText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.ink },
  retryLabel: { color: colors.white, fontSize: 11, fontWeight: "800" },
  loading: { paddingHorizontal: seed.spacing.globalGutter, paddingVertical: 60, alignItems: "center", gap: seed.spacing.x3 },
  loadingText: { color: colors.muted, fontSize: 13 },
  sectionHeader: {
    marginTop: seed.spacing.x7,
    marginBottom: seed.spacing.x3_5,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTrailingButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: seed.spacing.x3 },
  activityCard: { marginHorizontal: seed.spacing.globalGutter, overflow: "hidden", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  activityViewport: { overflow: "hidden" },
  activityRow: { height: DRAW_ACTIVITY_ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2_5, paddingHorizontal: seed.spacing.x3_5 },
  activityRowDivider: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand },
  activityTextViewport: { flex: 1, height: 20, justifyContent: "center", overflow: "hidden" },
  activityTextTrack: { justifyContent: "center" },
  activityTextLoopTrack: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start" },
  activityTextLoopGap: { width: DRAW_ACTIVITY_MARQUEE_GAP },
  activityMeasureLayer: { position: "absolute", width: 10_000, opacity: 0 },
  activityMeasureText: { width: 10_000 },
  activityText: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  activityPerson: { color: colors.ink, fontWeight: "900" },
  activityProduct: { color: seed.color.foreground.brand, fontWeight: "800" },
  activityTime: { color: colors.muted, fontSize: 10 },
  activityEmpty: { color: colors.muted, fontSize: 12, padding: seed.spacing.x4 },
  categoryRail: { paddingHorizontal: seed.spacing.globalGutter, paddingBottom: seed.spacing.x4, gap: seed.spacing.betweenChips },
  productRail: { paddingHorizontal: seed.spacing.globalGutter, gap: seed.spacing.componentDefault },
  productCard: { width: HOME_PRODUCT_CARD_WIDTH },
  productImageFrame: { borderRadius: seed.radius.r4, overflow: "hidden", borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  productImage: { width: "100%", height: "100%" },
  categoryBadge: { position: "absolute", top: 9, left: 9, borderRadius: seed.radius.r2, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.brand },
  categoryBadgeLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  productIp: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 9 },
  productName: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 3 },
  productPrice: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 5 },
  collectionCard: { width: HOME_PRODUCT_CARD_WIDTH },
  collectionImageFrame: { width: "100%", overflow: "hidden", borderRadius: seed.radius.r4, backgroundColor: seed.color.background.neutralWeak },
  gachaMachineMediaWindow: { borderWidth: 0, borderRadius: 0 },
  kujiProductMediaWindow: { borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
  collectionProductIp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: seed.spacing.x2 },
  collectionProductName: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: "800", marginTop: seed.spacing.x1 },
  collectionProductMeta: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: seed.spacing.x1 },
  productFieldDivider: { marginTop: seed.spacing.x2 },
  productCardDivider: { position: "absolute", top: 0, right: -7, bottom: 0 },
  eventSection: { marginBottom: seed.spacing.x4 },
  eventCard: { minHeight: 94, marginHorizontal: seed.spacing.globalGutter, paddingHorizontal: seed.spacing.x4, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, borderRadius: seed.radius.r4, backgroundColor: seed.color.background.brandSolid },
  eventIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(252, 252, 248, 0.72)" },
  eventCopy: { flex: 1, minWidth: 0 },
  eventBody: { color: colors.greenInk, fontSize: 11, lineHeight: 17, marginTop: seed.spacing.x1_5 },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: seed.spacing.x3_5, backgroundColor: "#EEF0EA" },
  mediaPlaceholderLabel: { color: colors.muted, fontFamily: "monospace", fontSize: 9, fontWeight: "700", textAlign: "center" },
  pressed: { opacity: seed.state.pressedOpacity },
});
