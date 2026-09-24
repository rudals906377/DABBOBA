import Constants from "expo-constants";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { CatalogProduct, HomeRecentDrawActivity } from "@dabboba/contracts";
import { CatalogDiscoveryImage } from "@/components/CatalogDiscoveryImage";
import { CatalogProductTopIndicator } from "@/components/CatalogProductTopIndicator";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiPrizeTierRow } from "@/components/KujiPrizeTierRow";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { RemainingInventoryMeter } from "@/components/RemainingInventoryMeter";
import {
  ROOT_NAVIGATION_CONTENT_INSET,
  useRootNavigationScroll,
} from "@/components/RootFloatingTabBar";
import { KoreanPixelTitle, ReadablePageTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { RootPageHeader, RootPageScaffold } from "@/components/RootPageHeader";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  catalogProductCardSurface,
} from "@/design-system/catalog";
import {
  fetchHomeCatalog,
  fetchHomeRecentDrawActivity,
  recordHomeProductClick,
  type HomeCatalogSnapshot,
} from "@/features/catalog/catalog-api";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import { isCustomerProductCategoryEnabledOn, productCategoryLabel } from "@/features/catalog/product-categories";
import { catalogQuantityLabel, remainingInventoryLabel, shouldShowCatalogInventory } from "@/features/catalog/remaining-inventory";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { productPriceLabel } from "@/features/commerce/product-commerce-presentation";
import { AnnouncementTicker } from "@/features/home/AnnouncementTicker";
import { mergeFreshHomeCatalogWithCachedSections } from "@/features/home/home-catalog-recovery";
import { remainingKujiTierAccessibilityLabel } from "@/features/kuji/kuji-tier-availability";
import {
  buildConfiguredHomeCollections,
  getHomeProductCardWidth,
  getHomeProductMediaAspectRatio,
  getRecentDrawReelWindow,
  homeAnnouncementMessages,
  resolveHomeProductBadge,
  shouldExpandHomeHero,
  shouldExpandHomeRecentDraw,
  type ConfiguredHomeCollection,
  type HomeProductBadge,
  type HomeSectionLayoutKind,
} from "@/features/home/home-feed";
import { catalogCardTitle, productSubjectTitle } from "@/features/shop/product-title";
import { readHomeCatalogCache, writeHomeCatalogCache } from "@/lib/local-database";
import {
  resolveCatalogImageUrl,
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/brand/dabboba-wordmark.png");
const HERO_MACHINE = require("../../../assets/draw/gacha/capsule-machine-front-empty.png");

type LoadSource = "live" | "cache" | "empty";
type HomeSectionsSource = "loading" | "live" | "cache" | "error";

export function HomeScreen() {
  const rootNavigationScroll = useRootNavigationScroll();
  const { fontScale } = useWindowDimensions();
  const expandedConnectionNotice = fontScale > 1.35;
  const db = useSQLiteContext();
  const router = useRouter();
  const { commerceEnabled } = useCommerceCapability();
  const { revision: categorySettingsRevision, refresh: refreshCategorySettings } = useStorefrontCategorySettings();
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
  const [recentDrawActivity, setRecentDrawActivity] = useState<readonly HomeRecentDrawActivity[] | null | undefined>(undefined);
  const [source, setSource] = useState<LoadSource>("empty");
  const [homeSectionsSource, setHomeSectionsSource] = useState<HomeSectionsSource>("loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [imageRequestKey, setImageRequestKey] = useState(0);
  const initialLoadCompleted = useRef(false);

  const bestProductId = snapshot?.homeProductBadges.bestProductId ?? null;
  const badgeEvaluatedAt = snapshot?.homeProductBadges.evaluatedAt ?? snapshot?.fetchedAt ?? "";
  const announcementMessages = useMemo(
    () => homeAnnouncementMessages(snapshot?.notices ?? []),
    [snapshot?.notices],
  );
  const hasActionableAnnouncement = useMemo(
    () => (snapshot?.notices ?? []).some((notice) => (
      notice.isPinned
      && notice.isPublished
      && notice.status === "ACTIVE"
      && Boolean(notice.title.trim())
    )),
    [snapshot?.notices],
  );
  const homeCollections = useMemo<ConfiguredHomeCollection[]>(() => {
    if (!snapshot?.homeSections?.configured) return [];
    return buildConfiguredHomeCollections(snapshot.homeSections.items.map((section) => ({
      ...section,
      products: section.products.filter((product) => (
        isCustomerProductCategoryEnabledOn(product.category, "home")
        && (commerceEnabled || product.category !== "kuji")
      )),
    })));
  }, [categorySettingsRevision, commerceEnabled, snapshot?.homeSections]);

  const load = useCallback(
    async (manual = false) => {
      if (manual) {
        setRefreshing(true);
        setImageRequestKey((current) => current + 1);
      }
      try {
        const [catalogResult, recentResult] = await Promise.allSettled([
          fetchHomeCatalog(runtime.apiBaseUrl),
          fetchHomeRecentDrawActivity(runtime.apiBaseUrl),
        ]);
        const cached = await readHomeCatalogCache(db).catch(() => null);
        const recoveredRecentDrawActivity = recentResult.status === "fulfilled"
          ? recentResult.value
          : null;
        setRecentDrawActivity(recoveredRecentDrawActivity);

        if (catalogResult.status === "rejected") {
          if (cached) {
            const recovered = {
              ...cached,
              products: cached.products.filter((product) => (
                isCustomerProductCategoryEnabledOn(product.category, "home")
              )),
              recentDrawActivity: recoveredRecentDrawActivity,
            };
            setSnapshot(recovered);
            setSource("cache");
            setHomeSectionsSource(cached.homeSections ? "cache" : "error");
            setMessage("연결이 불안정해 마지막으로 저장한 목록을 보여드려요.");
            if (recentResult.status === "fulfilled") {
              await writeHomeCatalogCache(db, recovered).catch(() => undefined);
            }
          } else {
            setSource("empty");
            setHomeSectionsSource("error");
            setMessage("홈을 불러오지 못했어요. 연결 상태를 확인해 주세요.");
          }
          return;
        }

        const fresh = {
          ...catalogResult.value,
          recentDrawActivity: recoveredRecentDrawActivity,
        };
        if (fresh.homeSections === null) {
          if (cached?.homeSections) {
            const recovered = mergeFreshHomeCatalogWithCachedSections(fresh, cached);
            setSnapshot(recovered);
            setSource("cache");
            setHomeSectionsSource("cache");
            setMessage("홈 진열 정보를 불러오지 못해 마지막으로 확인한 구성을 보여드려요.");
            if (recentResult.status === "fulfilled") {
              await writeHomeCatalogCache(db, recovered).catch(() => undefined);
            }
          } else {
            setSnapshot(fresh);
            setSource("live");
            setHomeSectionsSource("error");
            setMessage("");
          }
          return;
        }
        setSnapshot(fresh);
        setSource("live");
        setHomeSectionsSource("live");
        setMessage("");
        await writeHomeCatalogCache(db, fresh).catch(() => undefined);
      } finally {
        initialLoadCompleted.current = true;
        setRefreshing(false);
      }
    },
    [categorySettingsRevision, db, runtime.apiBaseUrl],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (!initialLoadCompleted.current) return undefined;
      void load();
      return undefined;
    }, [load]),
  );

  const openHomeProduct = useCallback((productId: string) => {
    router.push(`/product/${encodeURIComponent(productId)}` as Href);
    void recordHomeProductClick(runtime.apiBaseUrl, productId)
      .then((homeProductBadges) => {
        setSnapshot((current) => current ? { ...current, homeProductBadges } : current);
      })
      .catch(() => undefined);
  }, [router, runtime.apiBaseUrl]);

  return (
    <RootPageScaffold header={<HomeHeader />}>
      <ScrollView
        {...rootNavigationScroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { void refreshCategorySettings(); void load(true); }} tintColor={colors.ink} />
        }
      >
        {announcementMessages.length ? (
          <HomeAnnouncement
            messages={announcementMessages}
            onPress={hasActionableAnnouncement ? (announcement, announcementIndex) => {
              const notice = snapshot?.notices.filter((item) => (
                item.isPinned
                && item.isPublished
                && item.status === "ACTIVE"
                && Boolean(item.title.trim())
              ))[announcementIndex];
              if (notice?.title.trim() === announcement) {
                router.push(`/profile/notices/${encodeURIComponent(notice.id)}` as Href);
              }
            } : undefined}
          />
        ) : null}

        {message ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.connectionNotice, expandedConnectionNotice && styles.connectionNoticeLargeText, source === "empty" && styles.connectionNoticeError]}
          >
            <Text
              variant="finePrint"
              numberOfLines={expandedConnectionNotice ? undefined : 2}
              style={[styles.connectionNoticeText, expandedConnectionNotice && styles.connectionNoticeTextLarge]}
            >{message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={source === "cache" ? "홈 새로고침" : "홈 다시 불러오기"}
              onPress={() => void load(true)}
              style={({ pressed }) => [
                styles.retry,
                source === "cache" && styles.retryCache,
                expandedConnectionNotice && styles.retryLargeText,
                source === "cache" && expandedConnectionNotice && styles.retryCacheLargeText,
                pressed && styles.pressed,
              ]}
            >
              <Text variant="finePrint" style={[styles.retryLabel, source === "cache" && styles.retryLabelCache]}>
                {source === "cache" ? "새로고침" : "다시 불러오기"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <HomeIntroBanner />

        <RecentDrawActivityPanel
          activity={recentDrawActivity}
          assetBaseUrl={runtime.assetBaseUrl}
          imageRequestKey={imageRequestKey}
        />

        {homeCollections.map((collection) => (
          <OperatorHomeSection
            key={collection.id}
            section={collection}
            assetBaseUrl={runtime.assetBaseUrl}
            imageRequestKey={imageRequestKey}
            bestProductId={bestProductId}
            badgeEvaluatedAt={badgeEvaluatedAt}
            commerceEnabled={commerceEnabled}
            onProductPress={openHomeProduct}
          />
        ))}

        {homeSectionsSource === "loading" ? (
          <HomeCatalogFeedState kind="loading" />
        ) : homeSectionsSource === "error" ? (
          <HomeCatalogFeedState kind="error" onAction={() => void load(true)} />
        ) : snapshot?.homeSections && (
          !snapshot.homeSections.configured || snapshot.homeSections.items.length === 0
        ) ? (
          <HomeCatalogFeedState
            kind="empty"
            onAction={() => router.push("/(tabs)/gacha" as Href)}
          />
        ) : null}
      </ScrollView>
    </RootPageScaffold>
  );
}

function HomeHeader() {
  return (
    <RootPageHeader>
      <View style={styles.brandLockup}>
        <Image source={WORDMARK} resizeMode="contain" style={styles.wordmark} accessibilityLabel="DABBOBA" />
        <Text variant="finePrint" maxFontSizeMultiplier={2} style={styles.brandTagline}>원하는 거 다 뽀바</Text>
      </View>
    </RootPageHeader>
  );
}

function HomeCatalogFeedState({
  kind,
  onAction,
}: {
  kind: "loading" | "error" | "empty";
  onAction?: () => void;
}) {
  if (kind === "loading") {
    return (
      <View style={styles.homeCatalogFeedState}>
        <Text variant="caption" style={styles.homeCatalogFeedStateBody}>
          홈 진열을 확인하고 있어요.
        </Text>
      </View>
    );
  }

  const error = kind === "error";
  return (
    <View
      accessibilityLiveRegion={error ? "polite" : undefined}
      style={styles.homeCatalogFeedState}
    >
      <KoreanPixelTitle variant="header" style={styles.homeCatalogFeedStateTitle}>
        {error ? "홈 상품을 불러오지 못했어요" : "홈 상품을 준비하고 있어요"}
      </KoreanPixelTitle>
      <Text variant="bodyCompact" style={styles.homeCatalogFeedStateBody}>
        {error ? "잠시 후 다시 시도해 주세요." : "홈에 진열된 상품이 아직 없어요."}
      </Text>
      {onAction ? (
        <SeedActionButton
          label={error ? "다시 불러오기" : "가챠샵 둘러보기"}
          size="small"
          variant={error ? "neutralSolid" : "brandSolid"}
          onPress={onAction}
          style={styles.homeCatalogFeedStateAction}
        />
      ) : null}
    </View>
  );
}

function HomeIntroBanner() {
  const { fontScale } = useWindowDimensions();
  const expanded = shouldExpandHomeHero(fontScale);
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel="새 소식 준비 중. 새로운 이벤트 소식이 등록되면 알려드릴게요."
      style={[styles.hero, expanded && styles.heroLargeText]}
    >
      <Image
        accessible={false}
        accessibilityIgnoresInvertColors
        source={HERO_MACHINE}
        resizeMode="contain"
        style={styles.heroMachine}
      />
      <KoreanPixelTitle variant="hero" numberOfLines={expanded ? 3 : 2} style={styles.heroTitle}>
        새 소식을{"\n"}준비하고 있어요.
      </KoreanPixelTitle>
      <Text variant="bodyCompact" maxFontSizeMultiplier={2} style={styles.heroBody}>새로운 이벤트 소식이 등록되면 이곳에서 알려드릴게요.</Text>
      <Text variant="label" maxFontSizeMultiplier={2} style={styles.heroAction}>새 소식 준비 중</Text>
    </View>
  );
}

export function HomeAnnouncement({
  messages,
  onPress,
}: {
  messages: readonly string[];
  onPress?: (message: string, index: number) => void;
}) {
  return <AnnouncementTicker messages={messages} onPress={onPress} />;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string | null }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleCluster}>
        <ReadablePageTitle variant="sectionTitle" numberOfLines={2}>{title}</ReadablePageTitle>
        {subtitle ? <Text variant="caption" numberOfLines={2} style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function RecentDrawActivityPanel({
  activity,
  assetBaseUrl,
  imageRequestKey,
}: {
  activity: readonly HomeRecentDrawActivity[] | null | undefined;
  assetBaseUrl: string | null;
  imageRequestKey: number;
}) {
  const { fontScale } = useWindowDimensions();
  const expanded = shouldExpandHomeRecentDraw(fontScale);
  const reel = getRecentDrawReelWindow((activity ?? []).slice(0, 2), 0);
  return (
    <View style={[
      styles.recentDrawSummary,
      reel.current && styles.recentDrawSummaryPopulated,
      expanded && styles.recentDrawSummaryLargeText,
    ]}>
      <KoreanPixelTitle
        variant="header"
        style={[styles.recentDrawTitle, expanded && styles.recentDrawTitleLargeText]}
      >
        방금 뽑았어요
      </KoreanPixelTitle>
      {reel.current ? (
        <View style={expanded ? styles.recentDrawReelLargeText : styles.recentDrawReel}>
          <RecentDrawReelRow
            activity={reel.current}
            assetBaseUrl={assetBaseUrl}
            imageRequestKey={imageRequestKey}
            position="current"
            expanded={expanded}
          />
          {!expanded && reel.next ? (
            <RecentDrawReelRow
              activity={reel.next}
              assetBaseUrl={assetBaseUrl}
              imageRequestKey={imageRequestKey}
              position="next"
            />
          ) : null}
        </View>
      ) : activity === undefined ? (
        <Text variant="finePrint" numberOfLines={2} style={[styles.recentDrawEmpty, expanded && styles.recentDrawEmptyLargeText]}>당첨 기록을 확인하고 있어요.</Text>
      ) : activity === null ? (
        <Text variant="finePrint" numberOfLines={2} style={[styles.recentDrawEmpty, expanded && styles.recentDrawEmptyLargeText]}>당첨 기록을 불러오지 못했어요.</Text>
      ) : (
        <Text variant="finePrint" numberOfLines={2} style={[styles.recentDrawEmpty, expanded && styles.recentDrawEmptyLargeText]}>아직 공개된 당첨 기록이 없어요.</Text>
      )}
    </View>
  );
}

function RecentDrawReelRow({
  activity,
  assetBaseUrl,
  imageRequestKey,
  position,
  expanded = false,
}: {
  activity: HomeRecentDrawActivity;
  assetBaseUrl: string | null;
  imageRequestKey: number;
  position: "current" | "next";
  expanded?: boolean;
}) {
  const current = position === "current";
  const uri = resolveCatalogImageUrl(activity.prizeImageUrl, assetBaseUrl);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [uri]);
  return (
    <View
      accessible={current}
      accessibilityElementsHidden={!current}
      accessibilityLabel={current ? `${activity.rarity} 등급, ${activity.prizeName} 당첨` : undefined}
      importantForAccessibility={current ? "yes" : "no-hide-descendants"}
      pointerEvents="none"
      style={[
        expanded ? styles.recentDrawReelRowLargeText : styles.recentDrawReelRow,
        !expanded && current && styles.recentDrawReelCurrent,
        !expanded && position === "next" && styles.recentDrawReelNext,
      ]}
    >
      <View style={[styles.recentDrawImageFrame, !current && styles.recentDrawImageFrameGhost]}>
        {uri && !imageFailed ? (
          <Image
            key={`${imageRequestKey}:${activity.id}`}
            accessible={false}
            accessibilityIgnoresInvertColors
            source={{ uri }}
            resizeMode="cover"
            style={styles.recentDrawImage}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.recentDrawImageFallback}>
            <Text variant="finePrint" maxFontSizeMultiplier={2} numberOfLines={1} style={styles.recentDrawImageFallbackLabel}>{activity.rarity}</Text>
          </View>
        )}
        {current ? null : <View style={styles.recentDrawSilhouetteOverlay} />}
      </View>
      <View style={styles.recentDrawCopy}>
        <Text
          variant={current ? "label" : "finePrint"}
          maxFontSizeMultiplier={expanded ? undefined : 2}
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.recentDrawPrize, !current && styles.recentDrawPrizeGhost]}
        >
          {activity.prizeName}
        </Text>
      </View>
      <View style={[styles.recentDrawRarity, !current && styles.recentDrawRarityGhost]}>
        <Text
          variant="finePrint"
          maxFontSizeMultiplier={expanded ? undefined : 2}
          numberOfLines={1}
          style={styles.recentDrawRarityLabel}
        >
          {activity.rarity}
        </Text>
      </View>
    </View>
  );
}

function OperatorHomeSection({
  section,
  assetBaseUrl,
  imageRequestKey,
  bestProductId,
  badgeEvaluatedAt,
  commerceEnabled,
  onProductPress,
}: {
  section: ConfiguredHomeCollection;
  assetBaseUrl: string | null;
  imageRequestKey: number;
  bestProductId: string | null;
  badgeEvaluatedAt: string;
  commerceEnabled: boolean;
  onProductPress: (productId: string) => void;
}) {
  return (
    <View>
      <SectionTitle title={section.title} subtitle={section.subtitle} />
      {section.products.length ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.productRail}
        >
          {section.products.map((product) => (
            <CollectionProductCard
              key={product.id}
              product={product}
              layoutKind={section.layoutKind}
              ipName={section.ip?.nameKo ?? null}
              assetBaseUrl={assetBaseUrl}
              imageRequestKey={imageRequestKey}
              badge={resolveHomeProductBadge(product, bestProductId, badgeEvaluatedAt)}
              commerceEnabled={commerceEnabled}
              onPress={() => onProductPress(product.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <Text variant="caption" style={styles.sectionEmpty}>
          {`등록된 ${productCategoryLabel(section.layoutKind)} 상품이 없어요.`}
        </Text>
      )}
    </View>
  );
}

function CollectionProductCard({
  product,
  layoutKind,
  ipName,
  assetBaseUrl,
  imageRequestKey,
  badge,
  commerceEnabled,
  onPress,
}: {
  product: CatalogProduct;
  layoutKind: HomeSectionLayoutKind;
  ipName: string | null;
  assetBaseUrl: string | null;
  imageRequestKey: number;
  badge: HomeProductBadge;
  commerceEnabled: boolean;
  onPress: () => void;
}) {
  const storefrontUri = resolveCatalogImageUrl(product.storefrontImageUrl, assetBaseUrl, product.version);
  const primaryUri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const cardWidth = getHomeProductCardWidth(layoutKind);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={homeProductAccessibilityLabel(product, ipName, badge, commerceEnabled)}
      onPress={onPress}
      style={({ pressed }) => [styles.collectionCard, { width: cardWidth }, pressed && styles.pressed]}
    >
      <CatalogProductTopIndicator category={layoutKind} />
      <HomeProductMedia
        storefrontUri={storefrontUri}
        primaryUri={primaryUri}
        imageRequestKey={imageRequestKey}
        layoutKind={layoutKind}
        statusBadge={badge}
        remainingKujiTiers={shouldShowCatalogInventory(product, commerceEnabled) ? product.remainingKujiTiers : undefined}
      />
      <View style={[styles.productCardBody, layoutKind === "gacha" && styles.productCardBodyGacha]}>
        {layoutKind === "kuji" && ipName ? (
          <Text variant="catalogMetadata" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} numberOfLines={1} style={styles.collectionProductIp}>{ipName}</Text>
        ) : null}
        <Text
          variant={layoutKind === "kuji" ? "catalogTitleWide" : "catalogTitle"}
          maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={2}
          ellipsizeMode="tail"
          style={[
            styles.collectionProductName,
            layoutKind === "gacha" && styles.collectionProductNameGacha,
            layoutKind === "kuji" && styles.collectionProductNameKuji,
          ]}
        >
          {layoutKind === "gacha" ? catalogCardTitle(product.name, ipName) : productSubjectTitle(product.name, ipName)}
        </Text>
        <Text
          variant="catalogPrice"
          maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.collectionProductPrice, layoutKind === "gacha" && styles.collectionProductPriceGacha]}
        >
          {productPriceLabel(product, commerceEnabled)}
        </Text>
        {shouldShowCatalogInventory(product, commerceEnabled) ? (
          <RemainingInventoryMeter
            category={product.category}
            availableQuantity={product.availableQuantity}
            totalQuantity={product.totalQuantity}
            compact
            style={[styles.productInventory, layoutKind === "gacha" && styles.productInventoryGacha]}
            quantityTextStyle={styles.homeInventoryQuantity}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function homeProductAccessibilityLabel(
  product: CatalogProduct,
  ipName: string | null,
  badge: HomeProductBadge,
  commerceEnabled: boolean,
): string {
  const badgeLabel = badge === "BEST" ? "인기 상품, " : badge === "NEW" ? "신상품, " : "";
  const tierAccessibilityLabel = product.category === "kuji"
    ? remainingKujiTierAccessibilityLabel(product.remainingKujiTiers)
    : null;
  return [
    `${badgeLabel}${productCategoryLabel(product.category)} 상품`,
    ipName,
    product.name,
    productPriceLabel(product, commerceEnabled),
    shouldShowCatalogInventory(product, commerceEnabled)
      ? `${remainingInventoryLabel(product.category)} ${catalogQuantityLabel(product)}`
      : null,
    tierAccessibilityLabel,
    "상세 보기",
  ].filter(Boolean).join(", ");
}

function HomeProductMedia({
  storefrontUri,
  primaryUri,
  imageRequestKey,
  layoutKind,
  statusBadge,
  remainingKujiTiers,
}: {
  storefrontUri: string | null;
  primaryUri: string | null;
  imageRequestKey: number;
  layoutKind: HomeSectionLayoutKind;
  statusBadge: HomeProductBadge;
  remainingKujiTiers: CatalogProduct["remainingKujiTiers"];
}) {
  const isKuji = layoutKind === "kuji";
  const mediaAspectRatio = getHomeProductMediaAspectRatio(layoutKind);

  return (
    <GachaMachineFrame category={layoutKind} clean>
      <KujiProductFrame category={layoutKind} clean>
        <View
          style={[
            styles.collectionImageFrame,
            layoutKind === "gacha" && styles.gachaMachineMediaWindow,
            isKuji && styles.kujiProductMediaWindow,
            { aspectRatio: mediaAspectRatio },
          ]}
        >
          <CatalogDiscoveryImage
            storefrontUri={storefrontUri}
            primaryUri={primaryUri}
            requestKey={imageRequestKey}
            targetAspectRatio={mediaAspectRatio}
          />
          {statusBadge ? (
            <View style={[styles.homeStatusBadge, statusBadge === "BEST" ? styles.homeStatusBadgeBest : styles.homeStatusBadgeNew]}>
              <Text variant="catalogMetadata" maxFontSizeMultiplier={CATALOG_CARD_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.homeStatusBadgeLabel, statusBadge === "NEW" && styles.homeStatusBadgeLabelNew]}>{statusBadge}</Text>
            </View>
          ) : null}
          {isKuji ? <KujiPrizeTierRow tiers={remainingKujiTiers} variant="overlay" /> : null}
        </View>
      </KujiProductFrame>
    </GachaMachineFrame>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: ROOT_NAVIGATION_CONTENT_INSET },
  brandLockup: { justifyContent: "center", gap: seed.spacing.x0_5 },
  wordmark: { width: 116, height: 17 },
  brandTagline: { color: colors.muted, fontWeight: "700" },
  connectionNotice: {
    marginHorizontal: seed.spacing.globalGutter,
    marginTop: seed.spacing.x2,
    minHeight: seed.size.touchTarget,
    borderRadius: seed.radius.r2,
    backgroundColor: seed.color.background.brandWeak,
    paddingLeft: seed.spacing.x3,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  connectionNoticeError: { backgroundColor: seed.color.background.criticalWeak },
  connectionNoticeText: { flex: 1, color: colors.ink },
  connectionNoticeLargeText: { flexDirection: "column", alignItems: "stretch", padding: seed.spacing.x3 },
  connectionNoticeTextLarge: { flex: 0 },
  retry: { minHeight: seed.size.touchTarget, justifyContent: "center", paddingHorizontal: 10, borderRadius: seed.radius.r2, backgroundColor: colors.ink },
  retryLargeText: { alignSelf: "stretch", alignItems: "center", paddingVertical: seed.spacing.x2 },
  retryLabel: { color: colors.white, fontWeight: "800" },
  retryCache: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: seed.color.stroke.brand, backgroundColor: seed.color.background.transparent },
  retryCacheLargeText: { borderLeftWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.brand },
  retryLabelCache: { color: colors.greenInk },
  hero: {
    position: "relative",
    minHeight: seed.spacing.x16 + seed.spacing.x16 + seed.spacing.x9,
    overflow: "hidden",
    marginHorizontal: seed.spacing.globalGutter,
    marginTop: seed.spacing.x3_5,
    borderRadius: seed.radius.r4,
    paddingHorizontal: seed.spacing.x5,
    paddingVertical: seed.spacing.x6,
    justifyContent: "center",
    backgroundColor: colors.black,
  },
  heroLargeText: { minHeight: 220 },
  heroTitle: { width: "66%", color: colors.white },
  heroBody: { width: "64%", marginTop: seed.spacing.x3, color: "#B9C1B9", ...seed.typography.bodyCompact },
  heroAction: { width: "64%", marginTop: seed.spacing.x3, color: colors.white, fontWeight: "800" },
  heroMachine: { position: "absolute", top: -21, right: -10, width: "50%", height: "122%", opacity: 1 },
  sectionHeader: {
    marginTop: seed.spacing.x8,
    marginBottom: seed.spacing.x4,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  sectionTitleCluster: { zIndex: 1, minWidth: 0, flexShrink: 1, gap: seed.spacing.x1 },
  sectionSubtitle: { color: colors.muted },
  recentDrawSummary: {
    minHeight: 58,
    marginHorizontal: seed.spacing.globalGutter,
    marginTop: seed.spacing.x8,
    paddingHorizontal: seed.spacing.x3_5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: seed.color.stroke.neutral,
    borderRadius: seed.radius.r3,
    backgroundColor: seed.color.layer.default,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x3,
  },
  recentDrawSummaryPopulated: { minHeight: 72 },
  recentDrawSummaryLargeText: {
    flexDirection: "column",
    alignItems: "stretch",
    paddingVertical: seed.spacing.x3,
    gap: seed.spacing.x2,
  },
  recentDrawTitle: { width: 114, flexShrink: 0 },
  recentDrawTitleLargeText: { width: "auto" },
  recentDrawReel: { position: "relative", minWidth: 0, height: 64, flex: 1, overflow: "hidden" },
  recentDrawReelLargeText: { minWidth: 0 },
  recentDrawReelRow: { position: "absolute", right: 0, left: 0, height: 30, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  recentDrawReelRowLargeText: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  recentDrawReelCurrent: { top: 4, zIndex: 2, backgroundColor: seed.color.layer.default },
  recentDrawReelNext: { top: 35, opacity: 0.42, transform: [{ scale: 0.92 }] },
  recentDrawImageFrame: { position: "relative", width: 30, height: 30, flexShrink: 0, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r1_5, backgroundColor: seed.color.background.neutralWeak },
  recentDrawImageFrameGhost: { width: 27, height: 27 },
  recentDrawImage: { width: "100%", height: "100%" },
  recentDrawImageFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandWeak },
  recentDrawImageFallbackLabel: { color: colors.greenInk, fontWeight: "800" },
  recentDrawSilhouetteOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(17, 20, 17, 0.16)" },
  recentDrawCopy: { minWidth: 0, flex: 1 },
  recentDrawPrize: { color: colors.ink, fontWeight: "800" },
  recentDrawPrizeGhost: { color: colors.muted, fontWeight: "700" },
  recentDrawRarity: { minWidth: 26, minHeight: 22, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r1_5, backgroundColor: seed.color.background.brandWeak, paddingHorizontal: seed.spacing.x1_5 },
  recentDrawRarityGhost: { opacity: 0.62 },
  recentDrawRarityLabel: { color: colors.greenInk, fontWeight: "800" },
  recentDrawEmpty: { minWidth: 0, flex: 1, color: colors.muted, textAlign: "right" },
  recentDrawEmptyLargeText: { textAlign: "left" },
  homeCatalogFeedState: {
    minHeight: 176,
    marginHorizontal: seed.spacing.globalGutter,
    paddingVertical: seed.spacing.x8,
    alignItems: "center",
    justifyContent: "center",
  },
  homeCatalogFeedStateTitle: { textAlign: "center" },
  homeCatalogFeedStateBody: {
    marginTop: seed.spacing.x2,
    color: colors.muted,
    textAlign: "center",
  },
  homeCatalogFeedStateAction: { minWidth: 160, marginTop: seed.spacing.x4 },
  sectionEmpty: { marginHorizontal: seed.spacing.globalGutter, color: colors.muted },
  productRail: {
    alignItems: "flex-start",
    paddingHorizontal: seed.spacing.globalGutter,
    gap: seed.spacing.componentDefault,
  },
  productCardBody: {
    paddingHorizontal: seed.spacing.x3,
    paddingTop: seed.spacing.x2_5,
    paddingBottom: seed.spacing.x2_5,
    backgroundColor: seed.color.layer.default,
  },
  productCardBodyGacha: {
    paddingTop: seed.spacing.x2,
    paddingBottom: seed.spacing.x2,
  },
  homeStatusBadge: { position: "absolute", top: 8, left: 8, zIndex: 2, minWidth: 42, minHeight: 22, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r1_5, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 7, paddingVertical: 3 },
  homeStatusBadgeBest: { borderColor: colors.brand, backgroundColor: colors.brand },
  homeStatusBadgeNew: { borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  homeStatusBadgeLabel: { color: colors.ink, fontWeight: "700", letterSpacing: 0.4 },
  homeStatusBadgeLabelNew: { color: colors.greenInk },
  productInventory: { marginTop: seed.spacing.x1_5 },
  productInventoryGacha: { marginTop: seed.spacing.x1 },
  homeInventoryQuantity: { fontWeight: "700" },
  collectionCard: { ...catalogProductCardSurface },
  collectionImageFrame: { width: "100%", overflow: "hidden", backgroundColor: seed.color.background.neutralWeak },
  gachaMachineMediaWindow: { borderWidth: 0, borderRadius: seed.radius.none },
  kujiProductMediaWindow: { borderWidth: 0, borderRadius: seed.radius.none, backgroundColor: "transparent" },
  collectionProductIp: { color: colors.muted, ...seed.typography.catalogMetadata },
  collectionProductName: { minHeight: 40, flexShrink: 1, color: colors.ink, ...seed.typography.catalogTitle, marginTop: seed.spacing.x1 },
  collectionProductNameGacha: { marginTop: 0 },
  collectionProductNameKuji: { minHeight: 0, ...seed.typography.catalogTitleWide },
  collectionProductPrice: { color: colors.ink, ...seed.typography.catalogPrice, fontWeight: "500", marginTop: seed.spacing.x1 },
  collectionProductPriceGacha: { marginTop: seed.spacing.x0_5 },
  pressed: {
    opacity: seed.state.pressedOpacity,
    transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }],
  },
});
