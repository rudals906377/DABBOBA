import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import type { CatalogProduct, components } from "@dabboba/contracts";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import {
  AppText as Text,
  BalancedAppText,
} from "@/components/Typography";
import { SeedActionButton, SeedInlineGuidance, SeedTextInput } from "@/design-system/components";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { catalogPriceLabel } from "@/features/commerce/product-commerce-presentation";
import {
  categoryLabel,
  createPointReturn,
  createShippingQuote,
  createShippingRequest,
  formatDate,
  removeWishlistItem,
  setWantedRequestLike,
  type ProfileSnapshotScope,
  type ShippingQuote,
  updateAccountProfile,
} from "@/features/profile/profile-api";
import { isPointReturnEligibleInventory } from "@/features/profile/point-return-eligibility";
import { PaidDrawRecovery } from "@/features/profile/PaidDrawRecovery";
import { ProfileSectionErrorState } from "@/features/profile/ProfileSectionErrorState";
import { profileSectionFailure } from "@/features/profile/profile-section-state";
import {
  GACHA_ONLY_FREE_SHIPPING_THRESHOLD,
  KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD,
  calculateShippingPolicy,
  type ShippingPolicy,
} from "@/features/profile/shipping-policy";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { storageExpiryState } from "@/features/profile/storage-expiry";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { productSubjectTitle } from "@/features/shop/product-title";
import { resolveCatalogImageUrl } from "@/lib/runtime-config";
import { colors } from "@/theme";

type WishlistItem = components["schemas"]["WishlistItem"];
type AccountShippingRequest = components["schemas"]["AccountShippingRequest"];
type AccountOrder = components["schemas"]["AccountOrder"];
type PointLedgerEntry = components["schemas"]["PointLedgerEntry"];
type InventoryUnit = components["schemas"]["InventoryUnit"];
type WantedRequest = components["schemas"]["WantedRequest"];
type StorageMode = "shipping" | "exchange-or-shipping" | "point-return";

const SECTION_META = {
  edit: { title: "프로필 수정" },
  wishlist: { title: "내 찜 목록" },
  storage: { title: "보관함" },
  shipping: { title: "배송 신청 내역" },
  orders: { title: "구매 내역" },
  points: { title: "포인트 내역" },
  requests: { title: "신청방" },
  support: { title: "고객센터" },
  "member-info": { title: "회원정보 관리" },
  settings: { title: "설정" },
} as const;

type ProfileSection = keyof typeof SECTION_META;

/** Each section requests only the snapshot sections it renders. */
const SECTION_SCOPE: Record<ProfileSection, ProfileSnapshotScope> = {
  edit: "account",
  wishlist: "wishlist",
  storage: "storage",
  shipping: "shipping",
  orders: "orders",
  points: "points",
  requests: "requests",
  support: "support",
  "member-info": "account",
  settings: "account",
};

export function ProfileSectionScreen() {
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: ProfileSection = rawSection && rawSection in SECTION_META ? rawSection as ProfileSection : "edit";
  const meta = SECTION_META[section];
  const profileState = useProfileSnapshot(SECTION_SCOPE[section]);
  const hasFocusedOnce = useRef(false);
  const assetBaseUrl = profileState.runtime.assetBaseUrl
    ?? (__DEV__ ? profileState.runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);
  // Loaded record lists render through a virtualized FlatList; loading,
  // session gates and failures keep the plain scroll layout.
  const listSpec = profileListSpec(section, profileState, assetBaseUrl);

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current) void profileState.reload();
      else hasFocusedOnce.current = true;
    }, [profileState.reload]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailHeader title={meta.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {listSpec ? (
          <FlatList
            data={listSpec.data}
            keyExtractor={listSpec.keyExtractor}
            renderItem={({ item }) => listSpec.renderItem(item)}
            ListHeaderComponent={(
              <>
                {profileState.status === "error" ? <ErrorState message={profileState.message} onRetry={profileState.reload} /> : null}
                {listSpec.header}
              </>
            )}
            ListEmptyComponent={listSpec.empty}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
          />
        ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
        >
          {profileState.status === "loading" ? <Loading /> : null}
          {profileState.status === "error" ? <ErrorState message={profileState.message} onRetry={profileState.reload} /> : null}
          {(section === "requests" || section === "support") && profileState.publicLoading ? <Loading /> : null}
          {(section === "requests" || section === "support") && profileState.status !== "error" && profileState.message ? (
            <ErrorState message={profileState.message} onRetry={profileState.reload} />
          ) : null}
          {profileState.snapshot ? (
            <SectionContent
              section={section}
              assetBaseUrl={assetBaseUrl}
              profileState={profileState}
            />
          ) : null}
        </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionContent({
  section,
  assetBaseUrl,
  profileState,
}: {
  section: ProfileSection;
  assetBaseUrl: string | null;
  profileState: ReturnType<typeof useProfileSnapshot>;
}) {
  if (!profileState.snapshot) return null;
  const requiresAccount = !["requests", "support", "member-info", "settings"].includes(section);
  if (requiresAccount && isProfileSessionBlocked(profileState.status)) {
    return (
      <ProfileSessionGate
        status={profileState.status}
        returnTo={`/profile/${section}`}
        guestBody="로그인하면 내 계정의 기록과 설정을 확인할 수 있어요."
      />
    );
  }
  if (section === "edit") return <ProfileEdit profileState={profileState} />;
  if (section === "wishlist") return <Wishlist profileState={profileState} />;
  if (section === "storage") {
    return (
      <StorageHubContent
        profileState={profileState}
        assetBaseUrl={assetBaseUrl}
        initialMode="shipping"
      />
    );
  }
  if (section === "shipping") return <ShippingHistory profileState={profileState} />;
  if (section === "orders") return <Orders profileState={profileState} />;
  if (section === "points") return <Points profileState={profileState} />;
  if (section === "requests") return <RequestRoom profileState={profileState} />;
  if (section === "support") return <Support profileState={profileState} />;
  if (section === "member-info") return <MemberInfoMenu />;
  return <SettingsMenu />;
}

function ProfileEdit({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const [nickname, setNickname] = useState(snapshot.profile.nickname);
  const [bio, setBio] = useState(snapshot.profile.bio ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNickname(snapshot.profile.nickname);
    setBio(snapshot.profile.bio ?? "");
  }, [snapshot.profile.bio, snapshot.profile.nickname]);

  const save = async () => {
    const nextNickname = nickname.trim();
    if (!nextNickname) {
      Alert.alert("닉네임을 입력해 주세요");
      return;
    }
    if (snapshot.isExample || !profileState.accessToken) {
      profileState.setSnapshot((current) => current ? {
        ...current,
        profile: { ...current.profile, nickname: nextNickname, bio: bio.trim() || null, version: current.profile.version + 1 },
      } : current);
      Alert.alert("로그인 후 저장할 수 있어요", "현재 변경은 앱을 다시 열면 초기화될 수 있어요.");
      return;
    }
    try {
      setSaving(true);
      const updated = await updateAccountProfile(profileState.runtime.apiBaseUrl, profileState.accessToken, {
        nickname: nextNickname,
        bio: bio.trim() || null,
        expectedVersion: snapshot.profile.version,
      });
      profileState.setSnapshot((current) => current ? { ...current, profile: updated } : current);
      Alert.alert("프로필을 저장했어요", undefined, [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert("저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <FieldLabel label="닉네임" caption={`${nickname.length}/40`} />
      <SeedTextInput
        value={nickname}
        onChangeText={(value) => setNickname(value.slice(0, 40))}
        placeholder="닉네임"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <FieldLabel label="한 줄 소개" caption={`${bio.length}/500`} />
      <SeedTextInput
        value={bio}
        onChangeText={(value) => setBio(value.slice(0, 500))}
        placeholder="좋아하는 작품과 수집 취향을 알려주세요."
        placeholderTextColor={colors.muted}
        multiline
        textAlignVertical="top"
        style={[styles.input, styles.bioInput]}
      />
      <PrimaryButton label={saving ? "저장 중" : "프로필 저장"} disabled={saving} onPress={() => void save()} />
    </View>
  );
}

/** Failure state for the wishlist; loaded lists render through `profileListSpec`. */
function Wishlist({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const failure = profileSectionFailure(profileState.snapshot!, "wishlist");
  return failure ? <ProfileSectionErrorState message={failure} onRetry={profileState.reload} /> : null;
}

function WishlistRow({
  item,
  profileState,
  assetBaseUrl,
}: {
  item: WishlistItem;
  profileState: ReturnType<typeof useProfileSnapshot>;
  assetBaseUrl: string | null;
}) {
  const removeLocally = (current: NonNullable<typeof profileState.snapshot>) => (
    current.wishlist
      ? { ...current, wishlist: current.wishlist.filter((candidate) => candidate.id !== item.id) }
      : current
  );
  const remove = async () => {
    if (!profileState.snapshot) return;
    if (profileState.snapshot.isExample || !profileState.accessToken) {
      profileState.setSnapshot((current) => current ? removeLocally(current) : current);
      return;
    }
    try {
      await removeWishlistItem(profileState.runtime.apiBaseUrl, profileState.accessToken, item.product.id);
      profileState.setSnapshot((current) => current ? removeLocally(current) : current);
    } catch (error) {
      Alert.alert("찜을 해제하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    }
  };
  return (
    <ProductRow
      product={item.product}
      ipName={item.product.ipNameKo}
      caption={categoryLabel(item.product.category)}
      assetBaseUrl={assetBaseUrl}
      onPress={() => router.push(`/product/${encodeURIComponent(item.product.id)}` as Href)}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel={`${item.product.name} 찜 해제`} onPress={() => void remove()} style={({ pressed }) => [styles.heartButton, pressed && styles.pressed]}><DecorativeIonicon name="heart" size={20} color={colors.danger} /></Pressable>}
    />
  );
}

type ProfileListSpec = {
  data: readonly unknown[];
  keyExtractor: (item: unknown) => string;
  renderItem: (item: unknown) => ReactElement;
  header: ReactNode;
  empty: ReactElement;
};

function listSpec<T>(spec: {
  data: readonly T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  header?: ReactNode;
  empty: ReactElement;
}): ProfileListSpec {
  return {
    data: spec.data,
    keyExtractor: spec.keyExtractor as (item: unknown) => string,
    renderItem: spec.renderItem as (item: unknown) => ReactElement,
    header: spec.header ?? null,
    empty: spec.empty,
  };
}

/**
 * Returns the FlatList description for a loaded record-list section, or `null`
 * when the section is not a list, is still loading, is gated behind a session
 * state, or failed (those states render through `SectionContent`).
 */
function profileListSpec(
  section: ProfileSection,
  profileState: ReturnType<typeof useProfileSnapshot>,
  assetBaseUrl: string | null,
): ProfileListSpec | null {
  const snapshot = profileState.snapshot;
  if (!snapshot || isProfileSessionBlocked(profileState.status)) return null;
  if (section === "wishlist") {
    if (profileSectionFailure(snapshot, "wishlist")) return null;
    const items = snapshot.wishlist ?? [];
    return listSpec({
      data: items,
      keyExtractor: (item) => item.id,
      renderItem: (item) => <WishlistRow item={item} profileState={profileState} assetBaseUrl={assetBaseUrl} />,
      header: <SectionLead title={`관심 상품 ${items.length}개`} />,
      empty: <EmptyState icon="heart-outline" title="찜한 상품이 없어요" body="뽀바에서 관심 상품을 찜하면 여기에 모여요." />,
    });
  }
  if (section === "shipping") {
    if (profileSectionFailure(snapshot, "shipping")) return null;
    return listSpec({
      data: snapshot.shippingRequests ?? [],
      keyExtractor: (request) => request.id,
      renderItem: (request) => <ShippingHistoryRow request={request} />,
      empty: <EmptyState icon="car-outline" title="배송 신청 내역이 없어요" body="신청한 배송의 진행 상태가 여기에 표시돼요." />,
    });
  }
  if (section === "orders") {
    if (profileSectionFailure(snapshot, "orders")) return null;
    const orders = snapshot.orders ?? [];
    return listSpec({
      data: orders,
      keyExtractor: (order) => order.id,
      renderItem: (order) => <OrderRow order={order} catalogProducts={snapshot.catalogProducts} ipNames={snapshot.ipNames} />,
      header: (
        <>
          <OrdersPaidDrawRecovery profileState={profileState} />
          <SectionLead title={`주문 ${orders.length}건`} description="서버에서 확정한 결제 금액과 주문 상태를 그대로 표시해요." />
        </>
      ),
      empty: <EmptyState icon="receipt-outline" title="구매 내역이 없어요" body="결제가 완료된 주문이 이곳에 표시돼요." />,
    });
  }
  if (section === "points") {
    const pointBalance = snapshot.pointBalance;
    const pointHistory = snapshot.pointHistory;
    if (profileSectionFailure(snapshot, "points") || pointBalance === null || pointHistory === null) return null;
    return listSpec({
      data: pointHistory,
      keyExtractor: (entry) => entry.id,
      renderItem: (entry) => <PointRow entry={entry} />,
      header: (
        <>
          <View style={styles.pointHero}><Text style={styles.pointCaption}>사용 가능한 포인트</Text><Text style={styles.pointBalance}>{pointBalance.toLocaleString("ko-KR")}P</Text></View>
          <KoreanPixelTitle variant="compact" style={styles.listHeading}>적립·사용 내역</KoreanPixelTitle>
        </>
      ),
      empty: <EmptyState icon="wallet-outline" title="포인트 내역이 없어요" body="적립하거나 사용한 포인트가 여기에 기록돼요." />,
    });
  }
  return null;
}

export function StorageHubContent({
  profileState,
  assetBaseUrl,
  initialMode = "shipping",
  rootLayout = false,
  rootScrollProps,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  assetBaseUrl: string | null;
  initialMode?: StorageMode;
  rootLayout?: boolean;
  rootScrollProps?: Pick<ScrollViewProps, "onScroll" | "scrollEventThrottle">;
}) {
  const { commerceEnabled } = useCommerceCapability();
  const snapshot = profileState.snapshot!;
  const { fontScale } = useWindowDimensions();
  const largeText = Number.isFinite(fontScale) && fontScale > 1.3;
  const [mode, setMode] = useState<StorageMode>(initialMode);
  // A failed or partially failed inventory load closes every storage action:
  // selection, shipping, and point return all need the complete verified list.
  const inventoryFailure = profileSectionFailure(snapshot, "inventory");
  const inventory = inventoryFailure ? null : snapshot.inventory;
  const storedDrawItems = useMemo(
    () => inventory?.filter(isStoredDrawInventory) ?? null,
    [inventory],
  );
  const pointReturnItems = useMemo(
    () => inventory?.filter(isPointReturnEligibleInventory) ?? null,
    [inventory],
  );
  const exchangeOrShippingItems = useMemo(
    () => inventory?.filter(isExchangeOrShippingInventory) ?? null,
    [inventory],
  );

  return (
    <View style={rootLayout ? styles.storageRootHub : undefined}>
      <View accessibilityRole="tablist" style={styles.storageTabs}>
        <StorageModeTab label="보관 중" count={storedDrawItems?.length ?? null} selected={mode === "shipping"} largeText={largeText} onPress={() => setMode("shipping")} />
        <StorageModeTab label="교환 또는 배송 중인 상품" count={exchangeOrShippingItems?.length ?? null} wide selected={mode === "exchange-or-shipping"} largeText={largeText} onPress={() => setMode("exchange-or-shipping")} />
        <StorageModeTab label="포인트 환급" count={pointReturnItems?.length ?? null} selected={mode === "point-return"} largeText={largeText} onPress={() => setMode("point-return")} />
      </View>
      {!commerceEnabled ? (
        <SeedInlineGuidance style={styles.prelaunchStorageGuidance}>
          사전오픈 기간에는 보관 상품과 기존 진행 내역만 확인할 수 있어요. 배송·포인트 환급 신청은 정식 오픈 후 제공돼요.
        </SeedInlineGuidance>
      ) : null}
      {inventoryFailure || !storedDrawItems || !exchangeOrShippingItems || !pointReturnItems ? (
        <StorageLoadFailure
          message={inventoryFailure ?? "보관함을 불러오지 못했어요."}
          profileState={profileState}
          rootLayout={rootLayout}
          rootScrollProps={rootScrollProps}
        />
      ) : mode === "shipping" ? (
        <Shipping profileState={profileState} items={storedDrawItems} assetBaseUrl={assetBaseUrl} commerceEnabled={commerceEnabled} rootLayout={rootLayout} rootScrollProps={rootScrollProps} />
      ) : mode === "exchange-or-shipping" ? (
        <ExchangeOrShipping profileState={profileState} items={exchangeOrShippingItems} assetBaseUrl={assetBaseUrl} rootLayout={rootLayout} rootScrollProps={rootScrollProps} />
      ) : (
        <PointReturn profileState={profileState} items={pointReturnItems} assetBaseUrl={assetBaseUrl} commerceEnabled={commerceEnabled} rootLayout={rootLayout} rootScrollProps={rootScrollProps} />
      )}
    </View>
  );
}

function StorageLoadFailure({
  message,
  profileState,
  rootLayout = false,
  rootScrollProps,
}: {
  message: string;
  profileState: ReturnType<typeof useProfileSnapshot>;
  rootLayout?: boolean;
  rootScrollProps?: Pick<ScrollViewProps, "onScroll" | "scrollEventThrottle">;
}) {
  const content = <ProfileSectionErrorState message={message} onRetry={profileState.reload} style={styles.storageLoadFailure} />;
  if (!rootLayout) return content;
  return (
    <ScrollView
      {...rootScrollProps}
      style={styles.storageModeBody}
      contentContainerStyle={styles.storageScrollContent}
      refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
    >
      {content}
    </ScrollView>
  );
}

function StorageModeTab({ label, count, selected, largeText, wide = false, onPress }: { label: string; count: number | null; selected: boolean; largeText: boolean; wide?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={count === null ? `${label}, 불러오지 못했어요` : `${label}, ${count}개`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.storageTab, wide && styles.storageTabWide, largeText && styles.storageTabLargeText, pressed && styles.pressed]}
    >
      <Text maxFontSizeMultiplier={2} numberOfLines={largeText ? undefined : 2} style={[styles.storageTabLabel, selected && styles.storageTabLabelSelected]}>{label}</Text>
      <View style={[styles.storageTabIndicator, selected && styles.storageTabIndicatorSelected]} />
    </Pressable>
  );
}

function Shipping({
  profileState,
  items,
  assetBaseUrl,
  commerceEnabled,
  rootLayout = false,
  rootScrollProps,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  items: InventoryUnit[];
  assetBaseUrl: string | null;
  commerceEnabled: boolean;
  rootLayout?: boolean;
  rootScrollProps?: Pick<ScrollViewProps, "onScroll" | "scrollEventThrottle">;
}) {
  const snapshot = profileState.snapshot!;
  const { fontScale } = useWindowDimensions();
  const largeText = Number.isFinite(fontScale) && fontScale > 1.3;
  const [selected, setSelected] = useState<string[]>([]);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedItems = useMemo(
    () => items.filter((item) => item.status === "OWNED" && selected.includes(item.id)),
    [items, selected],
  );
  const sortedItems = useMemo(
    () => [...items].sort((left, right) => Date.parse(right.acquiredAt) - Date.parse(left.acquiredAt)),
    [items],
  );
  const selectableItems = useMemo(
    () => sortedItems.filter((item) => (
      item.status === "OWNED" && typeof item.product.price === "number" && item.product.price > 0
    )).slice(0, 20),
    [sortedItems],
  );
  useEffect(() => {
    const selectableIds = new Set(selectableItems.map((item) => item.id));
    setSelected((current) => current.filter((id) => selectableIds.has(id)));
  }, [selectableItems]);
  useEffect(() => {
    setShippingQuote(null);
  }, [selected, snapshot.defaultAddress?.id, snapshot.defaultAddress?.version]);
  const allSelected = selectableItems.length > 0 && selectableItems.every((item) => selected.includes(item.id));
  const shippingPolicy = useMemo(
    () => calculateShippingPolicy(selectedItems.map((item) => ({
      sourceType: item.sourceType,
      price: item.product.price ?? 0,
    }))),
    [selectedItems],
  );
  const toggle = (id: string) => {
    if (submitting) return;
    if (selected.includes(id)) {
      setSelected((current) => current.filter((value) => value !== id));
      return;
    }
    if (selected.length >= 20) {
      Alert.alert("한 번에 최대 20개까지 선택할 수 있어요");
      return;
    }
    setSelected((current) => [...current, id]);
  };
  const toggleAll = () => {
    if (submitting) return;
    if (allSelected) {
      setSelected([]);
      return;
    }
    setSelected(selectableItems.map((item) => item.id));
  };
  const submit = async () => {
    if (!selected.length) {
      Alert.alert("배송할 상품을 선택해 주세요");
      return;
    }
    if (snapshot.sectionErrors.address) {
      Alert.alert("기본 배송지를 확인하지 못했어요", `${snapshot.sectionErrors.address} 다시 불러온 뒤 신청해 주세요.`);
      return;
    }
    if (!snapshot.defaultAddress) {
      Alert.alert("기본 배송지가 필요해요", "회원정보 관리에서 기본 배송지를 먼저 등록해 주세요.");
      return;
    }
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인 후 배송을 신청할 수 있어요", `${selected.length}개 상품을 선택했어요. 로그인하면 선택한 상품으로 배송 신청을 진행할 수 있어요.`);
      return;
    }
    try {
      setSubmitting(true);
      if (!shippingQuote || Date.parse(shippingQuote.expiresAt) <= Date.now()) {
        const quote = await createShippingQuote(
          profileState.runtime.apiBaseUrl,
          profileState.accessToken,
          selected,
        );
        setShippingQuote(quote);
        return;
      }
      const request = await createShippingRequest(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
        shippingQuote,
      );
      setSelected([]);
      setShippingQuote(null);
      await profileState.reload();
      if (request.status === "PAYMENT_PENDING" && request.paymentOrderId) {
        router.push(`/checkout/payment/${encodeURIComponent(request.paymentOrderId)}` as Href);
        return;
      }
      Alert.alert("배송을 신청했어요");
    } catch (error) {
      setShippingQuote(null);
      Alert.alert("배송을 신청하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };
  const content = (
    <>
      <View style={[styles.storageListHeader, largeText && styles.storageListHeaderLargeText]}>
        <Text maxFontSizeMultiplier={2} style={styles.storageTotal}>보관 중 {items.length}개</Text>
        {commerceEnabled ? <View style={[styles.storageListActions, largeText && styles.storageListActionsLargeText]}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={items.length > 20 ? "최근 상품 20개 선택" : "전체 선택"}
            accessibilityState={{ checked: allSelected, disabled: !items.length }}
            disabled={!items.length}
            onPress={toggleAll}
            style={({ pressed }) => [styles.selectAllButton, pressed && styles.pressed]}
          >
            <DecorativeIonicon name={allSelected ? "checkbox" : "square-outline"} size={22} color={allSelected ? colors.greenInk : colors.muted} />
            <Text maxFontSizeMultiplier={2} style={styles.selectAllLabel}>{items.length > 20 ? "20개 선택" : "전체 선택"}</Text>
          </Pressable>
          <View style={styles.storageSortLabel}>
            <Text maxFontSizeMultiplier={2} style={styles.storageSortText}>최근 획득순</Text>
            <DecorativeIonicon name="swap-vertical" size={15} color={colors.muted} />
          </View>
        </View> : null}
      </View>
      {sortedItems.some((item) => item.status === "EXPIRED_HOLD") ? (
        <SeedInlineGuidance style={styles.prelaunchStorageGuidance}>
          보관 기간이 만료된 상품은 자동 폐기되지 않고 보류돼요. 고객센터에 문의해 주세요.
        </SeedInlineGuidance>
      ) : null}
      {sortedItems.map((item) => {
        const ipName = snapshot.ipNames[item.product.ipId] ?? "작품 정보 없음";
        return (
          <SelectableInventoryRow
            key={item.id}
            product={item.product}
            ipName={ipName}
            assetBaseUrl={assetBaseUrl}
            selected={selected.includes(item.id)}
            storageExpiresAt={item.storageExpiresAt}
            caption={item.status === "EXPIRED_HOLD"
              ? "보관 만료 보류 · 자동 폐기되지 않아요"
              : typeof item.product.price === "number" && item.product.price > 0
                ? undefined
                : "가격 확정 후 배송 가능"}
            selectable={commerceEnabled && item.status === "OWNED" && typeof item.product.price === "number" && item.product.price > 0}
            onSelect={() => toggle(item.id)}
          />
        );
      })}
      {!items.length ? <CompactStorageEmpty label="배송 가능한 상품이 없어요" /> : null}
    </>
  );

  const footer = commerceEnabled && items.length ? (
    <ShippingBottomDock
      policy={shippingPolicy}
      quote={shippingQuote}
      selectedCount={selected.length}
      submitting={submitting}
      onSubmit={() => void submit()}
    />
  ) : null;

  if (!rootLayout) return <>{content}{footer}</>;
  return (
    <View style={styles.storageModeBody}>
      <ScrollView
        {...rootScrollProps}
        contentContainerStyle={styles.storageScrollContent}
        refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
      >
        {content}
        {largeText ? footer : null}
      </ScrollView>
      {largeText ? null : footer}
    </View>
  );
}

function ShippingBottomDock({
  policy,
  quote,
  selectedCount,
  submitting,
  onSubmit,
}: {
  policy: ShippingPolicy;
  quote: ShippingQuote | null;
  selectedCount: number;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const threshold = quote?.freeShippingThreshold
    ?? (policy.hasSelection ? policy.threshold : GACHA_ONLY_FREE_SHIPPING_THRESHOLD);
  const subtotal = quote?.referenceSubtotal ?? policy.subtotal;
  const shippingFee = quote?.shippingFee ?? policy.shippingFee;
  const qualifiesForFreeShipping = quote?.qualifiesForFreeShipping ?? policy.qualifiesForFreeShipping;
  const remaining = policy.hasSelection ? Math.max(threshold - subtotal, 0) : threshold;
  const progress = threshold > 0 ? Math.min(subtotal / threshold, 1) : 0;
  const progressWidth = `${Math.round(progress * 100)}%` as `${number}%`;
  const resultLabel = !policy.hasSelection
    ? `${threshold.toLocaleString("ko-KR")}원부터 무료배송`
    : qualifiesForFreeShipping
      ? "무료배송 적용"
      : `배송비 ${shippingFee.toLocaleString("ko-KR")}원 · 무료까지 ${remaining.toLocaleString("ko-KR")}원`;
  const submitLabel = submitting
    ? quote ? "신청 중" : "확인 중"
    : quote && shippingFee > 0
      ? `배송비 ${shippingFee.toLocaleString("ko-KR")}원 결제 후 신청`
      : quote
        ? "배송 신청 확정"
      : policy.hasSelection
        ? "배송 금액 확인하기"
        : "상품을 선택해 주세요";

  return (
    <View style={styles.shippingDock}>
      {!selectedCount ? (
        <Text maxFontSizeMultiplier={2} style={styles.shippingDefaultSummary}>
          무료 기준 · 가챠 {GACHA_ONLY_FREE_SHIPPING_THRESHOLD.toLocaleString("ko-KR")}원 · 쿠지 포함 {KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD.toLocaleString("ko-KR")}원
        </Text>
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`선택 상품 ${selectedCount}개, 합계 ${subtotal.toLocaleString("ko-KR")}원, ${resultLabel}${quote ? ", 서버 견적 확인 완료" : ""}`}
            style={styles.shippingProgressRow}
          >
            <View style={styles.shippingProgressTrack}><View style={[styles.shippingProgressFill, { width: progressWidth }]} /></View>
            <Text maxFontSizeMultiplier={2} style={[styles.shippingProgressLabel, qualifiesForFreeShipping && styles.shippingProgressLabelFree]}>{resultLabel}</Text>
          </View>
          <View style={styles.shippingSelectionSummary}>
            <Text maxFontSizeMultiplier={2} style={styles.shippingSelectionLabel}>{quote ? "서버 확인 완료" : "선택"} {selectedCount}개 · 합계 {subtotal.toLocaleString("ko-KR")}원</Text>
            <Text maxFontSizeMultiplier={2} style={styles.shippingSelectionAmount}>기준 {threshold.toLocaleString("ko-KR")}원 · 배송비 {shippingFee.toLocaleString("ko-KR")}원</Text>
            {quote ? (
              <Text maxFontSizeMultiplier={2} style={styles.shippingSelectionAmount}>
                {quote.destination.addressLine1}{quote.destination.addressLine2 ? ` ${quote.destination.addressLine2}` : ""} · {quote.destination.recipientMasked} · {quote.destination.phoneMasked}
              </Text>
            ) : null}
          </View>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: !selectedCount || submitting, busy: submitting }}
        disabled={!selectedCount || submitting}
        onPress={onSubmit}
        style={({ pressed }) => [styles.shippingSubmitButton, (!selectedCount || submitting) && styles.shippingSubmitButtonDisabled, pressed && styles.pressed]}
      >
        <Text maxFontSizeMultiplier={2} style={[styles.shippingSubmitLabel, (!selectedCount || submitting) && styles.shippingSubmitLabelDisabled]}>{submitLabel}</Text>
      </Pressable>
    </View>
  );
}

function CompactStorageEmpty({ label }: { label: string }) {
  return <View style={styles.compactStorageEmpty}><Text style={styles.compactStorageEmptyText}>{label}</Text></View>;
}

function ExchangeOrShipping({
  profileState,
  items,
  assetBaseUrl,
  rootLayout = false,
  rootScrollProps,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  items: InventoryUnit[];
  assetBaseUrl: string | null;
  rootLayout?: boolean;
  rootScrollProps?: Pick<ScrollViewProps, "onScroll" | "scrollEventThrottle">;
}) {
  const snapshot = profileState.snapshot!;
  const sortedItems = useMemo(
    () => [...items].sort((left, right) => Date.parse(right.acquiredAt) - Date.parse(left.acquiredAt)),
    [items],
  );
  const content = (
    <>
      <View style={styles.storageListHeader}>
        <Text style={styles.storageTotal}>진행 중 {items.length}개</Text>
        <View style={styles.storageSortLabel}>
          <Text style={styles.storageSortText}>최근 진행순</Text>
          <DecorativeIonicon name="swap-vertical" size={15} color={colors.muted} />
        </View>
      </View>
      {sortedItems.map((item) => {
        const ipName = snapshot.ipNames[item.product.ipId] ?? "작품 정보 없음";
        return (
          <ProductRow
            key={item.id}
            product={item.product}
            ipName={ipName}
            caption={categoryLabel(item.product.category)}
            assetBaseUrl={assetBaseUrl}
            onPress={() => router.push(`/product/${encodeURIComponent(item.product.id)}` as Href)}
            trailing={<Text style={[styles.statusBadge, styles.statusBadgeProgress]}>{activeInventoryStatusLabel(item.status)}</Text>}
          />
        );
      })}
      {!items.length ? <CompactStorageEmpty label="교환 또는 배송 중인 상품이 없어요" /> : null}
    </>
  );

  if (!rootLayout) return content;
  return (
    <ScrollView
      {...rootScrollProps}
      style={styles.storageModeBody}
      contentContainerStyle={styles.storageScrollContent}
      refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
    >
      {content}
    </ScrollView>
  );
}

/** Failure state for shipping history; loaded lists render through `profileListSpec`. */
function ShippingHistory({
  profileState,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
}) {
  const failure = profileSectionFailure(profileState.snapshot!, "shipping");
  return failure ? <ProfileSectionErrorState message={failure} onRetry={profileState.reload} /> : null;
}

function ShippingHistoryRow({ request }: { request: AccountShippingRequest }) {
  const compactDestination = compactShippingDestination(request.destination.addressLine1);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${formatDate(request.requestedAt)} 배송 신청 상세`} onPress={() => router.push(`/profile/shipping/${encodeURIComponent(request.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}>
      <View style={styles.historyTop}>
        <Text style={styles.historyTitle}>배송 {request.inventoryUnitIds.length}개</Text>
        <Text style={[styles.statusBadge, shippingStatusStyle(request.status)]}>{shippingStatus(request.status)}</Text>
      </View>
      <Text style={styles.historyMeta}>{formatDate(request.requestedAt)} 신청 · {request.destination.recipientMasked}</Text>
      {compactDestination ? <Text style={styles.historyMeta}>{compactDestination}</Text> : null}
    </Pressable>
  );
}

function PointReturn({
  profileState,
  items,
  assetBaseUrl,
  commerceEnabled,
  rootLayout = false,
  rootScrollProps,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  items: InventoryUnit[];
  assetBaseUrl: string | null;
  commerceEnabled: boolean;
  rootLayout?: boolean;
  rootScrollProps?: Pick<ScrollViewProps, "onScroll" | "scrollEventThrottle">;
}) {
  const snapshot = profileState.snapshot!;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedItems = useMemo(
    () => items.filter((item) => selected.includes(item.id)),
    [items, selected],
  );
  const selectedInventoryUnitIds = useMemo(
    () => selectedItems.map((item) => item.id),
    [selectedItems],
  );
  const estimatedPointAmount = useMemo(
    () => selectedItems.reduce((total, item) => (
      total + (item.pointReturnAmount ?? 0)
    ), 0),
    [selectedItems],
  );
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      setSelected((current) => current.filter((value) => value !== id));
      return;
    }
    if (selected.length >= 20) {
      Alert.alert("한 번에 최대 20개까지 선택할 수 있어요");
      return;
    }
    setSelected((current) => [...current, id]);
  };

  const completePointReturn = async () => {
    if (!profileState.accessToken) return;
    try {
      setSubmitting(true);
      const result = await createPointReturn(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
        selectedInventoryUnitIds,
      );
      setSelected([]);
      await profileState.reload();
      Alert.alert(
        "포인트 환급이 완료됐어요",
        `${result.totalPointAmount.toLocaleString("ko-KR")}P가 적립됐어요. 현재 잔액은 ${result.balance.toLocaleString("ko-KR")}P예요.`,
      );
    } catch (error) {
      Alert.alert("포인트 환급을 신청하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (!selectedInventoryUnitIds.length) {
      Alert.alert("환급할 상품을 선택해 주세요");
      return;
    }

    const summary = `${selectedInventoryUnitIds.length}개 · 예상 ${estimatedPointAmount.toLocaleString("ko-KR")}P\n교환으로 받은 상품은 포인트 환급 대상이 아니며, 본인이 가챠에서 직접 뽑아 보관 중인 상품만 가능해요.\n환급한 상품은 다시 배송하거나 교환할 수 없어요.`;
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert(
        "로그인 후 포인트 환급을 신청할 수 있어요",
        `${summary}\n\n로그인하면 선택한 상품으로 환급 신청을 진행할 수 있어요.`,
      );
      return;
    }

    Alert.alert("포인트 환급을 신청할까요?", summary, [
      { text: "취소", style: "cancel" },
      { text: "환급 신청", onPress: () => void completePointReturn() },
    ]);
  };

  const content = (
    <>
      {commerceEnabled ? <View style={styles.pointReturnSummary}>
        <View>
          <Text style={styles.shippingPolicyCaption}>선택 상품</Text>
          <Text style={styles.shippingPolicyAmount}>{selectedInventoryUnitIds.length}개</Text>
        </View>
        <View style={styles.shippingPolicyResultBlock}>
          <Text style={styles.shippingPolicyCaption}>예상 환급 포인트 · 구매가의 50%</Text>
          <Text style={[styles.shippingPolicyResult, styles.shippingPolicyResultFree]}>{estimatedPointAmount.toLocaleString("ko-KR")}P</Text>
        </View>
      </View> : null}
      <View style={styles.storageListHeader}>
        <Text style={styles.storageTotal}>환급 가능 {items.length}개</Text>
        {commerceEnabled ? <Text style={styles.pointReturnSelected}>선택 {selectedInventoryUnitIds.length}개</Text> : null}
      </View>
      {items.map((item) => {
        const ipName = snapshot.ipNames[item.product.ipId] ?? "작품 정보 없음";
        return (
          <SelectableInventoryRow
            key={item.id}
            product={item.product}
            ipName={ipName}
            assetBaseUrl={assetBaseUrl}
            selected={selected.includes(item.id)}
            caption={`예상 ${item.pointReturnAmount!.toLocaleString("ko-KR")}P`}
            storageExpiresAt={item.storageExpiresAt}
            selectable={commerceEnabled}
            onSelect={() => toggle(item.id)}
          />
        );
      })}
      {commerceEnabled && items.length ? (
        <PrimaryButton
          label={submitting ? "환급 중" : `${selectedInventoryUnitIds.length}개 포인트 환급 신청`}
          disabled={submitting || !selectedInventoryUnitIds.length}
          onPress={submit}
        />
      ) : (
        <CompactStorageEmpty label="포인트 환급 가능한 상품이 없어요" />
      )}
    </>
  );

  if (!rootLayout) return content;
  return (
    <ScrollView
      {...rootScrollProps}
      style={styles.storageModeBody}
      contentContainerStyle={styles.storageScrollContent}
      refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
    >
      {content}
    </ScrollView>
  );
}

/** Failure state for orders; loaded lists render through `profileListSpec`. */
function Orders({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const failure = profileSectionFailure(profileState.snapshot!, "orders");
  return (
    <>
      <OrdersPaidDrawRecovery profileState={profileState} />
      {failure ? <ProfileSectionErrorState message={failure} onRetry={profileState.reload} /> : null}
    </>
  );
}

function OrdersPaidDrawRecovery({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  return !snapshot.isExample && profileState.accessToken ? (
    <PaidDrawRecovery
      apiBaseUrl={profileState.runtime.apiBaseUrl}
      actorId={snapshot.profile.id}
      refreshKey={snapshot.fetchedAt}
      catalogProducts={snapshot.catalogProducts}
      ipNames={snapshot.ipNames}
    />
  ) : null;
}

function OrderRow({
  order,
  catalogProducts,
  ipNames,
}: {
  order: AccountOrder;
  catalogProducts: CatalogProduct[];
  ipNames: Record<string, string>;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${formatDate(order.createdAt)} 주문 상세`} onPress={() => router.push(`/profile/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}>
      <View style={styles.historyTop}>
        <Text style={styles.historyTitle}>{formatDate(order.createdAt)} {order.orderKind === "SHIPPING_FEE" ? "배송비" : "주문"}</Text>
        <Text style={[styles.statusBadge, orderStatusStyle(order.status)]}>{orderStatus(order.status)}</Text>
      </View>
      {order.orderKind === "SHIPPING_FEE" ? (
        <Text style={styles.orderLine}>보관함 배송 신청 배송비</Text>
      ) : null}
      {order.lines.map((line) => (
        <OrderProductLine
          key={`${order.id}-${line.productId}`}
          line={line}
          catalogProducts={catalogProducts}
          ipNames={ipNames}
        />
      ))}
      <View style={styles.totalRow}><Text style={styles.totalLabel}>결제 금액</Text><Text variant="subtitle" style={styles.totalValue}>{order.total.toLocaleString("ko-KR")}원</Text></View>
    </Pressable>
  );
}

/** Failure state for points; loaded ledgers render through `profileListSpec`. */
function Points({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const failure = profileSectionFailure(snapshot, "points");
  // A failed points request never renders as a 0P balance or an empty ledger.
  if (failure || snapshot.pointBalance === null || snapshot.pointHistory === null) {
    return <ProfileSectionErrorState message={failure ?? "포인트 정보를 불러오지 못했어요."} onRetry={profileState.reload} />;
  }
  return null;
}

function PointRow({ entry }: { entry: PointLedgerEntry }) {
  return (
    <View style={styles.pointRow}>
      <View><Text style={styles.pointReason}>{entry.reason}</Text><Text style={styles.historyMeta}>{formatDate(entry.createdAt)}</Text></View>
      <Text style={[styles.pointAmount, entry.amount > 0 ? styles.pointPlus : styles.pointMinus]}>{entry.amount > 0 ? "+" : ""}{entry.amount.toLocaleString("ko-KR")}P</Text>
    </View>
  );
}

function RequestRoom({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const toggleLike = async (request: WantedRequest) => {
    if (isProfileSessionBlocked(profileState.status) || !profileState.accessToken) {
      openCustomerLogin(
        "로그인하면 이 신청에 같이 원해요를 남길 수 있어요.",
        `/profile/requests/${encodeURIComponent(request.id)}`,
      );
      return;
    }
    try {
      const next = await setWantedRequestLike(profileState.runtime.apiBaseUrl, profileState.accessToken, request.id, !request.likedByViewer);
      profileState.setSnapshot((current) => current ? { ...current, wantedRequests: current.wantedRequests.map((item) => item.id === request.id ? { ...item, ...next } : item) } : current);
    } catch (error) {
      Alert.alert("반응을 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    }
  };
  return (
    <>
      <View style={styles.requestLead}><SeedActionButton label="새 신청 작성" onPress={() => router.push("/profile/requests/new" as Href)} /><SeedInlineGuidance style={styles.requestLeadGuidance}>찾는 상품이 없다면 작품과 원하는 상품을 등록해 보세요.</SeedInlineGuidance></View>
      <KoreanPixelTitle variant="compact" style={styles.listHeading}>함께 기다리는 신청</KoreanPixelTitle>
      {snapshot.sectionErrors.wanted ? <ProfileSectionErrorState message={snapshot.sectionErrors.wanted} onRetry={profileState.reload} style={styles.sectionErrorState} /> : null}
      {snapshot.wantedRequests.map((request) => (
        <View key={request.id} style={styles.requestItem}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${request.desiredItem} 신청 상세`} onPress={() => router.push(`/profile/requests/${encodeURIComponent(request.id)}` as Href)} style={({ pressed }) => [pressed && styles.pressed]}>
            {request.mediaUrl ? <Image accessible={false} source={{ uri: request.mediaUrl }} resizeMode="cover" style={styles.requestPhoto} /> : null}
            <View style={styles.historyTop}><Text style={styles.requestAuthor}>@{request.authorNickname}</Text><Text style={styles.categoryBadge}>{categoryLabel(request.category)}</Text></View>
            <Text style={styles.requestItemTitle}>{request.desiredItem}</Text>
            <Text style={styles.requestIp}>{request.ipNameKo}</Text>
            <Text numberOfLines={3} style={styles.requestDetails}>{request.details}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`같이 원해요 ${request.likeCount}개`} accessibilityState={{ selected: request.likedByViewer }} onPress={() => void toggleLike(request)} style={({ pressed }) => [styles.likeButton, request.likedByViewer && styles.likeButtonActive, pressed && styles.pressed]}><DecorativeIonicon name={request.likedByViewer ? "heart" : "heart-outline"} size={18} color={request.likedByViewer ? colors.greenInk : colors.muted} /><Text style={styles.likeLabel}>같이 원해요 {request.likeCount}</Text></Pressable>
        </View>
      ))}
    </>
  );
}

function Support({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const { commerceEnabled } = useCommerceCapability();
  const snapshot = profileState.snapshot!;
  const blockedStatus = isProfileSessionBlocked(profileState.status) ? profileState.status : null;
  const inquiriesFailure = profileSectionFailure(snapshot, "inquiries");
  const inquiries = snapshot.inquiries;
  return (
    <>
      <SectionLead title="무엇을 도와드릴까요?" description="신청방은 상품 요청 공간이고, 고객센터는 공지·이용 안내·문의 처리를 담당해요." />
      <View style={styles.supportContact}><DecorativeIonicon name="chatbubble-ellipses-outline" size={22} color={colors.greenInk} /><View><Text style={styles.supportTitle}>문의 안내</Text><Text style={styles.supportBody}>문의는 1:1 문의에서 접수할 수 있어요.</Text></View></View>
      <KoreanPixelTitle variant="compact" style={styles.listHeading}>자주 묻는 질문</KoreanPixelTitle>
      <Faq title="보관 상품은 언제 배송할 수 있나요?" body={commerceEnabled ? "보관함에 보관 중인 상품을 선택해 배송 신청할 수 있어요." : "사전오픈 기간에는 배송 신청을 이용할 수 없어요."} />
      {commerceEnabled ? <Faq title="교환 중인 상품도 배송할 수 있나요?" body="교환 등록이나 제안에 사용 중인 상품은 교환을 취소하거나 종료한 뒤 배송할 수 있어요." /> : null}
      <KoreanPixelTitle variant="compact" style={styles.listHeading}>공지사항</KoreanPixelTitle>
      {snapshot.sectionErrors.notices ? <ProfileSectionErrorState message={snapshot.sectionErrors.notices} onRetry={profileState.reload} style={styles.sectionErrorState} /> : null}
      {snapshot.notices.map((notice) => <Pressable key={notice.id} accessibilityRole="button" accessibilityLabel={`${notice.title} 공지 상세`} onPress={() => router.push(`/profile/notices/${encodeURIComponent(notice.id)}` as Href)} style={({ pressed }) => [styles.noticeCard, pressed && styles.pressed]}><Text style={styles.noticeTitle}>{notice.isPinned ? "[중요] " : ""}{notice.title}</Text><Text numberOfLines={3} style={styles.noticeBody}>{notice.content}</Text><Text style={styles.historyMeta}>{formatDate(notice.publishedAt ?? notice.createdAt)}</Text></Pressable>)}
      <KoreanPixelTitle variant="compact" style={styles.listHeading}>내 문의</KoreanPixelTitle>
      {blockedStatus ? (
        <ProfileSessionGate
          status={blockedStatus}
          returnTo="/profile/support"
          guestBody="로그인하면 내 문의 내역을 확인하고 새 문의를 남길 수 있어요."
        />
      ) : inquiriesFailure || !inquiries ? (
        <ProfileSectionErrorState message={inquiriesFailure ?? "문의 내역을 불러오지 못했어요."} onRetry={profileState.reload} />
      ) : inquiries.length ? inquiries.map((inquiry) => <Pressable key={inquiry.id} accessibilityRole="button" accessibilityLabel={`${inquiry.title} 문의 상세`} onPress={() => router.push(`/profile/inquiries/${encodeURIComponent(inquiry.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}><View style={styles.historyTop}><Text style={styles.historyTitle}>{inquiry.title}</Text><Text style={styles.statusBadge}>{inquiryStatus(inquiry.status)}</Text></View><Text style={styles.historyMeta}>{formatDate(inquiry.updatedAt)} 업데이트</Text></Pressable>) : <EmptyState icon="chatbubble-ellipses-outline" title="문의 내역이 없어요" body="도움이 필요하면 1:1 문의를 남길 수 있어요." />}
      {!blockedStatus ? <PrimaryButton label="1:1 문의하기" onPress={() => router.push("/profile/inquiries/new" as Href)} /> : null}
      <View style={styles.publicInfoMenu}><MemberLink href="/profile/business" label="사업자 정보" caption="상호 · 대표자 · 사업자등록정보" icon="business-outline" last /></View>
    </>
  );
}

function MemberInfoMenu() {
  return (
    <>
      <SectionLead title="회원정보를 안전하게 관리해요" description="개인정보와 배송지는 필요한 범위에서만 관리해요." />
      <View style={styles.menuCard}>
        <MemberLink section="personal" label="개인정보" caption="닉네임 · 휴대폰 · 이메일 · 생년월일" icon="id-card-outline" />
        <MemberLink section="address" label="기본 배송지" caption="받는 사람 · 연락처 · 주소" icon="location-outline" />
        <MemberLink section="security" label="로그인 및 보안" caption="현재 로그인 상태와 계정 보호" icon="shield-checkmark-outline" />
        <MemberLink section="consents" label="개인정보·수신 동의" caption="필수 고지와 선택 동의" icon="document-text-outline" last />
      </View>
    </>
  );
}

function SettingsMenu() {
  return (
    <>
      <SectionLead title="앱과 계정을 설정해요" description="주문·배송 필수 알림과 선택 알림을 분리해서 관리해요." />
      <View style={styles.menuCard}>
        <MemberLink section="notifications" label="알림 수신설정" caption="주문 · 교환 · 신청방 · 마케팅" icon="notifications-outline" />
        <MemberLink section="personal" label="계정정보" caption="회원정보와 연락처" icon="person-circle-outline" />
        <MemberLink section="security" label="로그인 및 보안" caption="활성 세션과 계정 보호" icon="lock-closed-outline" />
        <MemberLink section="legal" label="약관·운영정책" caption="이용약관 · 개인정보 · 배송 · 교환" icon="reader-outline" />
        <MemberLink href="/profile/business" label="사업자 정보" caption="상호 · 대표자 · 사업자등록정보" icon="business-outline" />
        <MemberLink section="deletion" label="로그아웃·회원탈퇴" caption="세션 종료와 탈퇴 요청" icon="log-out-outline" last />
      </View>
    </>
  );
}

type MemberLinkProps = ({ section: string; href?: never } | { section?: never; href: Href }) & {
  label: string;
  caption: string;
  icon: DecorativeIoniconName;
  last?: boolean;
};

function MemberLink({ section, href, label, caption, icon, last = false }: MemberLinkProps) {
  const destination = href ?? `/profile/member/${section}` as Href;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} 열기`} onPress={() => router.push(destination)} style={({ pressed }) => [styles.memberRow, !last && styles.memberRowBorder, pressed && styles.pressed]}><View style={styles.memberIcon}><DecorativeIonicon name={icon} size={20} color={colors.ink} /></View><View style={styles.memberText}><Text style={styles.memberLabel}>{label}</Text><Text style={styles.memberCaption}>{caption}</Text></View><DecorativeIonicon name="chevron-forward" size={18} color={colors.muted} /></Pressable>;
}

function ProductRow({ product, ipName, caption, assetBaseUrl, trailing, onPress }: { product: { name: string; imageUrl: string | null; price: number | null; category: CatalogProduct["category"]; version?: number }; ipName: string; caption: string; assetBaseUrl: string | null; trailing: React.ReactNode; onPress?: () => void }) {
  const content = <><ProductThumb product={product} assetBaseUrl={assetBaseUrl} catalogFrameCategory={product.category} /><View style={styles.productText}><Text numberOfLines={1} style={styles.productSub}>{ipName}</Text><Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text><Text numberOfLines={1} style={styles.productCaption}>{caption}</Text><ProductInfoDivider style={styles.productFieldDivider} /><Text style={styles.productPrice}>{catalogPriceLabel(product.price)}</Text></View></>;
  return <View style={styles.productRow}>{onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${product.name} 상세 보기`} onPress={onPress} style={({ pressed }) => [styles.productMain, pressed && styles.pressed]}>{content}</Pressable> : content}{trailing}</View>;
}

function OrderProductLine({ line, catalogProducts, ipNames }: { line: components["schemas"]["AccountOrderLine"]; catalogProducts: CatalogProduct[]; ipNames: Record<string, string> }) {
  const catalogProduct = catalogProducts.find((product) => product.id === line.productId);
  const ipName = catalogProduct ? ipNames[catalogProduct.ipId] ?? "작품 정보 없음" : "작품 정보 없음";
  return (
    <View style={styles.orderProduct}>
      <Text numberOfLines={1} style={styles.orderIp}>{ipName} · {categoryLabel(line.category)}</Text>
      <Text style={styles.orderLine}>{productSubjectTitle(line.productName, ipName)} · {line.quantity}개</Text>
    </View>
  );
}

function ProductThumb({ product, assetBaseUrl, catalogFrameCategory }: { product: { name: string; imageUrl: string | null; version?: number }; assetBaseUrl: string | null; catalogFrameCategory?: CatalogProduct["category"] }) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version ?? 1);
  const thumb = <View style={styles.thumb}>{uri ? <Image accessible={false} source={{ uri }} resizeMode={catalogFrameCategory === "kuji" ? "contain" : "cover"} style={styles.thumbImage} /> : <DecorativeIonicon name="image-outline" size={24} color={colors.muted} />}</View>;
  return catalogFrameCategory ? <GachaMachineFrame category={catalogFrameCategory} clean><KujiProductFrame category={catalogFrameCategory} clean>{thumb}</KujiProductFrame></GachaMachineFrame> : thumb;
}

function SelectableInventoryRow({
  product,
  ipName,
  assetBaseUrl,
  selected,
  caption,
  storageExpiresAt,
  selectable = true,
  onSelect,
}: {
  product: InventoryUnit["product"];
  ipName: string;
  assetBaseUrl: string | null;
  selected: boolean;
  caption?: string;
  storageExpiresAt?: string;
  selectable?: boolean;
  onSelect: () => void;
}) {
  const storageExpiry = storageExpiryState(storageExpiresAt);
  const remainingLabel = storageExpiry?.isExpired
    ? "만료"
    : `${storageExpiry?.remainingDays ?? 0}일 남음`;
  const expiryAccessibilityLabel = storageExpiry && storageExpiresAt
    ? `, 보관 만료 60일, 만료일 ${formatDate(storageExpiresAt)}, ${remainingLabel}`
    : ", 보관 만료 60일";

  return (
    <View style={[styles.selectRow, selected && styles.selectRowActive]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name} 상세 보기${expiryAccessibilityLabel}`}
        onPress={() => router.push(`/product/${encodeURIComponent(product.id)}` as Href)}
        style={({ pressed }) => [styles.selectProductLink, pressed && styles.pressed]}
      >
        <ProductThumb product={product} assetBaseUrl={assetBaseUrl} />
        <View style={styles.selectText}>
          <Text numberOfLines={1} style={styles.productSub}>{ipName} · {categoryLabel(product.category)}</Text>
          <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text>
          {caption ? <Text numberOfLines={1} style={styles.pointReturnEstimate}>{caption}</Text> : null}
          <Text style={styles.storageExpiryPolicy}>보관 만료 60일</Text>
          {storageExpiry && storageExpiresAt ? (
            <Text style={[styles.storageExpiryDetail, storageExpiry.isExpired && styles.storageExpiryDetailExpired]}>
              만료일 {formatDate(storageExpiresAt)} · {remainingLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {selectable ? <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={storageExpiry?.isExpired ? `${product.name} 선택 불가, 보관 만료` : `${product.name} 선택`}
        accessibilityState={{ checked: selected, disabled: storageExpiry?.isExpired ?? false }}
        disabled={storageExpiry?.isExpired ?? false}
        hitSlop={4}
        onPress={onSelect}
        style={({ pressed }) => [styles.selectControl, storageExpiry?.isExpired && styles.disabled, pressed && styles.pressed]}
      >
        <DecorativeIonicon name={selected ? "checkmark-circle" : "ellipse-outline"} size={24} color={selected ? colors.greenInk : colors.muted} />
      </Pressable> : null}
    </View>
  );
}

export function DetailHeader({ title }: { title: string }) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };
  return <DetailPageHeader title={title} titleMode="pixel" onBack={goBack} />;
}

function SectionLead({ title, description }: { title: string; description?: string }) {
  return <View style={styles.sectionLead}><KoreanPixelTitle variant="section" numberOfLines={0}>{title}</KoreanPixelTitle>{description ? <BalancedAppText style={styles.sectionLeadBody}>{description}</BalancedAppText> : null}</View>;
}

function FieldLabel({ label, caption }: { label: string; caption: string }) {
  return <View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldCaption}>{caption}</Text></View>;
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryButtonLabel}>{label}</Text></Pressable>;
}

function EmptyState({ icon, title, body }: { icon: DecorativeIoniconName; title: string; body: string }) {
  return <View style={styles.emptyState}><DecorativeIonicon name={icon} size={30} color={colors.muted} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

function ExampleNotice() {
  return <SeedInlineGuidance style={styles.exampleGuidance}>로그인하면 주문·포인트·배송 내역과 나의 수집 기록을 확인할 수 있어요.</SeedInlineGuidance>;
}

function Loading() {
  return <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={styles.loadingText}>상세 정보를 불러오는 중</Text></View>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View style={styles.errorBox}><Text style={styles.errorText}>{message}</Text><PrimaryButton label="다시 불러오기" onPress={onRetry} /></View>;
}

function Faq({ title, body }: { title: string; body: string }) {
  return <View style={styles.faqCard}><Text style={styles.faqQuestion}>Q. {title}</Text><Text style={styles.faqAnswer}>{body}</Text></View>;
}

function isStoredDrawInventory(item: InventoryUnit): boolean {
  return (item.status === "OWNED" || item.status === "EXPIRED_HOLD")
    && (item.sourceType === "GACHA" || item.sourceType === "KUJI");
}

function isExchangeOrShippingInventory(item: InventoryUnit): boolean {
  return item.status === "EXCHANGE_LISTED"
    || item.status === "EXCHANGE_OFFERED"
    || item.status === "SHIPPING";
}

function activeInventoryStatusLabel(status: InventoryUnit["status"]): string {
  if (status === "EXCHANGE_LISTED") return "교환 등록 중";
  if (status === "EXCHANGE_OFFERED") return "교환 제안 중";
  return "배송 중";
}

function shippingStatus(status: components["schemas"]["AccountShippingRequestStatus"]): string {
  return { PAYMENT_PENDING: "배송비 결제 대기", REQUESTED: "접수", PROCESSING: "출고 준비", SHIPPED: "배송 중", DELIVERED: "배송 완료", CANCELLED: "취소" }[status];
}

function compactShippingDestination(addressLine1: string | null | undefined): string | null {
  const address = addressLine1?.trim().replace(/\s+/g, " ") ?? "";
  if (!address || /(?:테스트(?:\s*전용)?\s*주소|배송\s*금지|demo)/i.test(address)) return null;
  const locality = address.split(" ").slice(0, 2).join(" ");
  return locality ? `${locality} · 상세주소 숨김` : null;
}

function shippingStatusStyle(status: components["schemas"]["AccountShippingRequestStatus"]) {
  if (status === "DELIVERED") return styles.statusBadgeSuccess;
  if (status === "CANCELLED") return styles.statusBadgeCritical;
  if (status === "SHIPPED" || status === "PROCESSING") return styles.statusBadgeProgress;
  return styles.statusBadgeNeutral;
}

function orderStatus(status: components["schemas"]["AccountOrder"]["status"]): string {
  return { PENDING_PAYMENT: "결제 대기", PAID: "결제 완료", FULFILLED: "처리 완료", CANCELLED: "취소", REFUND_REVIEW: "환불 검토", REFUNDED: "환불 완료" }[status];
}

function orderStatusStyle(status: components["schemas"]["AccountOrder"]["status"]) {
  if (status === "PAID" || status === "FULFILLED") return styles.statusBadgeSuccess;
  if (status === "CANCELLED") return styles.statusBadgeCritical;
  if (status === "REFUND_REVIEW" || status === "REFUNDED") return styles.statusBadgeRefund;
  return styles.statusBadgeNeutral;
}

function inquiryStatus(status: components["schemas"]["InquiryStatus"]): string {
  return { PENDING: "접수", IN_PROGRESS: "답변 중", ANSWERED: "답변 완료", CLOSED: "종료" }[status];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  headerTitleBlock: { flex: 1, alignItems: "center" },
  headerSpacer: { width: 56 },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 13 },
  errorBox: { marginTop: seed.spacing.x5, borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak },
  errorText: { color: colors.ink, fontSize: 13, lineHeight: 20, textAlign: "center" },
  exampleGuidance: { marginBottom: seed.spacing.x4 },
  sectionErrorState: { marginBottom: seed.spacing.x3 },
  storageLoadFailure: { marginTop: seed.spacing.x4 },
  sectionLead: { marginBottom: 18 },
  sectionLeadBody: { color: colors.muted, ...seed.typography.bodyCompact, marginTop: seed.spacing.x2 },
  storageRootHub: { flex: 1, minHeight: 0 },
  prelaunchStorageGuidance: { marginTop: seed.spacing.x3, marginBottom: seed.spacing.x1 },
  storageTabs: { minHeight: 54, flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral },
  storageTab: { flex: 0.85, minHeight: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x1 },
  storageTabWide: { flex: 1.5 },
  storageTabLargeText: { paddingVertical: seed.spacing.x2 },
  storageTabLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  storageTabLabelSelected: { color: colors.ink, fontWeight: "900" },
  storageTabIndicator: { position: "absolute", left: seed.spacing.x2, right: seed.spacing.x2, bottom: -StyleSheet.hairlineWidth, height: 2, backgroundColor: seed.color.background.transparent },
  storageTabIndicatorSelected: { backgroundColor: colors.brand },
  storageModeBody: { flex: 1, minHeight: 0 },
  storageScrollContent: { flexGrow: 1, paddingBottom: seed.spacing.x4 },
  storageListHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3 },
  storageListHeaderLargeText: { flexDirection: "column", alignItems: "stretch", justifyContent: "center", paddingVertical: seed.spacing.x2 },
  storageTotal: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900" },
  storageListActions: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x3 },
  storageListActionsLargeText: { width: "100%", flexWrap: "wrap", justifyContent: "space-between" },
  selectAllButton: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1_5 },
  selectAllLabel: { color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  storageSortLabel: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x1 },
  storageSortText: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  pointReturnSelected: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  formCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, paddingVertical: seed.spacing.x4, backgroundColor: seed.color.layer.default },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 7 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  fieldCaption: { color: colors.muted, ...seed.typography.finePrint },
  input: { minHeight: seed.size.input, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, paddingHorizontal: seed.spacing.x3_5, color: seed.color.foreground.neutral, backgroundColor: seed.color.layer.elevated, fontSize: 14 },
  bioInput: { minHeight: 112, paddingTop: 13 },
  primaryButton: { minHeight: seed.size.actionButton.large, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, marginTop: seed.spacing.x4, backgroundColor: seed.color.background.brandSolid },
  primaryButtonLabel: { color: colors.ink, ...seed.typography.button, fontWeight: "900" },
  productRow: { minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12, ...catalogProductCardSurface, padding: 12, marginBottom: 11 },
  productMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 82, height: 82, ...catalogProductImageSurface, alignItems: "center", justifyContent: "center" },
  thumbImage: { width: "100%", height: "100%" },
  productText: { flex: 1, minWidth: 0 },
  productName: { color: colors.ink, ...seed.typography.catalogTitle, marginTop: 3 },
  productSub: { color: colors.muted, ...seed.typography.catalogMetadata },
  productCaption: { color: colors.muted, ...seed.typography.catalogMetadata, marginTop: 3 },
  productFieldDivider: { marginTop: 5 },
  productPrice: { color: colors.ink, ...seed.typography.catalogPrice, marginTop: 5 },
  heartButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  statusBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, color: colors.muted, backgroundColor: seed.color.background.neutralWeak, ...seed.typography.finePrint, fontWeight: "900" },
  statusBadgeNeutral: { color: colors.muted, backgroundColor: seed.color.background.neutralWeak },
  statusBadgeProgress: { color: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  statusBadgeSuccess: { color: colors.greenInk, backgroundColor: seed.color.background.brandWeak },
  statusBadgeCritical: { color: seed.color.foreground.critical, backgroundColor: seed.color.background.criticalWeak },
  statusBadgeRefund: { color: seed.color.info.ink, backgroundColor: seed.color.info.weak },
  pointReturnSummary: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, marginBottom: seed.spacing.x3_5, backgroundColor: seed.color.layer.default },
  pointReturnEstimate: { color: colors.greenInk, fontSize: 11, lineHeight: 17, fontWeight: "800", marginTop: seed.spacing.x1 },
  storageExpiryPolicy: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "700", marginTop: seed.spacing.x1_5 },
  storageExpiryDetail: { color: colors.ink, ...seed.typography.catalogMetadata, fontWeight: "800", marginTop: seed.spacing.x0_5 },
  storageExpiryDetailExpired: { color: seed.color.foreground.critical },
  shippingPolicyCaption: { color: colors.muted, ...seed.typography.catalogMetadata },
  shippingPolicyAmount: { color: colors.ink, ...seed.typography.subtitle, marginTop: seed.spacing.x1 },
  shippingPolicyResultBlock: { flex: 1, alignItems: "flex-end" },
  shippingPolicyResult: { color: colors.ink, fontSize: 12, fontWeight: "900", marginTop: seed.spacing.x1, textAlign: "right" },
  shippingPolicyResultFree: { color: colors.greenInk },
  shippingDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, paddingTop: seed.spacing.x2_5, paddingBottom: seed.spacing.x2, backgroundColor: seed.color.layer.default },
  shippingDefaultSummary: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "700", textAlign: "center", marginBottom: seed.spacing.x2_5 },
  shippingProgressRow: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, paddingTop: seed.spacing.x2 },
  shippingProgressTrack: { flex: 1, height: 6, overflow: "hidden", borderRadius: seed.radius.full, backgroundColor: seed.color.background.neutralWeak },
  shippingProgressFill: { height: "100%", borderRadius: seed.radius.full, backgroundColor: colors.brand },
  shippingProgressLabel: { maxWidth: "68%", color: colors.ink, fontSize: 11, lineHeight: 16, fontWeight: "900", textAlign: "right" },
  shippingProgressLabelFree: { color: colors.greenInk },
  shippingSelectionSummary: { gap: seed.spacing.x0_5, paddingBottom: seed.spacing.x2 },
  shippingSelectionLabel: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "700" },
  shippingSelectionAmount: { color: colors.muted, ...seed.typography.finePrint, fontWeight: "700" },
  shippingSubmitButton: { minHeight: seed.size.actionButton.large, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, backgroundColor: seed.color.background.brandSolid },
  shippingSubmitButtonDisabled: { backgroundColor: seed.color.background.neutralWeak },
  shippingSubmitLabel: { color: colors.ink, ...seed.typography.button, fontWeight: "900" },
  shippingSubmitLabelDisabled: { color: colors.muted },
  compactStorageEmpty: { flex: 1, minHeight: 240, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6 },
  compactStorageEmptyText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  listHeading: { marginTop: seed.spacing.x6, marginBottom: seed.spacing.x2_5 },
  selectRow: { minHeight: 88, flexDirection: "row", alignItems: "center", ...catalogProductCardSurface, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x1_5, marginBottom: seed.spacing.x2_5 },
  selectRowActive: { borderWidth: 2, borderColor: colors.greenInk },
  selectProductLink: { minHeight: 76, flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11, padding: 4 },
  selectControl: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  selectText: { flex: 1, minWidth: 0 },
  historyCard: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: colors.line, padding: seed.spacing.x4, marginBottom: seed.spacing.x2_5, backgroundColor: colors.surface },
  historyTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  historyTitle: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "900" },
  historyMeta: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1 },
  orderProduct: { marginTop: 10 },
  orderIp: { color: colors.muted, ...seed.typography.catalogMetadata },
  orderLine: { color: colors.ink, ...seed.typography.catalogTitle, fontWeight: "800", marginTop: 2 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: 12, paddingTop: 12 },
  totalLabel: { color: colors.muted, fontSize: 11 },
  totalValue: { color: colors.ink },
  pointHero: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x6, backgroundColor: seed.color.background.brandWeak },
  pointCaption: { color: colors.greenInk, fontSize: 11, fontWeight: "800" },
  pointBalance: { color: colors.ink, fontSize: 34, lineHeight: 42, fontWeight: "900", marginTop: 5 },
  pointRow: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pointReason: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  pointAmount: { fontSize: 14, fontWeight: "900" },
  pointPlus: { color: colors.greenInk },
  pointMinus: { color: colors.ink },
  requestLead: { gap: seed.spacing.x2 },
  requestLeadGuidance: { textAlign: "center" },
  requestItem: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: colors.line, padding: seed.spacing.x4, marginBottom: seed.spacing.x3, backgroundColor: colors.surface },
  requestPhoto: { width: "100%", aspectRatio: 16 / 9, borderRadius: seed.radius.r3, marginBottom: seed.spacing.x3, backgroundColor: seed.color.layer.basement },
  requestAuthor: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  categoryBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, backgroundColor: seed.color.background.brandWeak, color: colors.greenInk, ...seed.typography.finePrint, fontWeight: "900" },
  requestItemTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 12 },
  requestIp: { color: colors.greenInk, fontSize: 11, fontWeight: "800", marginTop: 5 },
  requestDetails: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  likeButton: { alignSelf: "flex-start", minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", gap: seed.spacing.x1_5, borderRadius: seed.radius.r2_5, borderWidth: 1, borderColor: colors.line, paddingHorizontal: seed.spacing.x3, marginTop: seed.spacing.x3 },
  likeButtonActive: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  likeLabel: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  supportContact: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, backgroundColor: seed.color.layer.default },
  supportTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  supportBody: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1 },
  faqCard: { borderRadius: seed.radius.r4, padding: 16, marginBottom: 9, backgroundColor: colors.surface },
  faqQuestion: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  faqAnswer: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  noticeCard: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 9, backgroundColor: colors.surface },
  noticeTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  noticeBody: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  disclosure: { color: colors.muted, ...seed.typography.finePrint, textAlign: "center", marginTop: seed.spacing.x4_5, paddingHorizontal: seed.spacing.x2_5 },
  publicInfoMenu: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, marginTop: seed.spacing.x4_5, backgroundColor: seed.color.layer.default },
  menuCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  memberRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  memberRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  memberIcon: { width: 40, height: 40, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  memberText: { flex: 1, minWidth: 0 },
  memberLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  memberCaption: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1 },
  emptyState: { minHeight: 300, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x6, paddingVertical: seed.spacing.x12 },
  emptyTitle: { color: colors.ink, ...seed.typography.subheading, fontWeight: "900", marginTop: 14 },
  emptyBody: { color: colors.muted, ...seed.typography.caption, textAlign: "center", marginTop: 7 },
});
