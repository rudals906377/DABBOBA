import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CatalogProduct, components } from "@dabboba/contracts";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import {
  AppText as Text,
  AppTextInput as TextInput,
  BalancedAppText,
} from "@/components/Typography";
import { SeedChip, SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  categoryLabel,
  createPointReturn,
  createShippingRequest,
  formatDate,
  removeWishlistItem,
  setWantedRequestLike,
  updateAccountProfile,
} from "@/features/profile/profile-api";
import { isPointReturnEligibleInventory } from "@/features/profile/point-return-eligibility";
import { PaidDrawRecovery } from "@/features/profile/PaidDrawRecovery";
import { calculateShippingPolicy } from "@/features/profile/shipping-policy";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { productSubjectTitle } from "@/features/shop/product-title";
import { resolveCatalogImageUrl } from "@/lib/runtime-config";
import { colors } from "@/theme";

type WishlistItem = components["schemas"]["WishlistItem"];
type InventoryUnit = components["schemas"]["InventoryUnit"];
type WantedRequest = components["schemas"]["WantedRequest"];
type StorageMode = "shipping" | "point-return";

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

export function ProfileSectionScreen() {
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: ProfileSection = rawSection && rawSection in SECTION_META ? rawSection as ProfileSection : "edit";
  const meta = SECTION_META[section];
  const profileState = useProfileSnapshot();
  const assetBaseUrl = profileState.runtime.assetBaseUrl
    ?? (__DEV__ ? profileState.runtime.apiBaseUrl.replace(/:8788$/, ":4174") : null);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <DetailHeader title={meta.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
        >
          {!profileState.snapshot && !profileState.message ? <Loading /> : null}
          {profileState.message ? <ErrorState message={profileState.message} onRetry={profileState.reload} /> : null}
          {profileState.snapshot?.isExample ? <ExampleNotice /> : null}
          {profileState.snapshot ? (
            <SectionContent
              section={section}
              assetBaseUrl={assetBaseUrl}
              profileState={profileState}
            />
          ) : null}
        </ScrollView>
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
  if (section === "edit") return <ProfileEdit profileState={profileState} />;
  if (section === "wishlist") return <Wishlist profileState={profileState} assetBaseUrl={assetBaseUrl} />;
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
      <TextInput
        value={nickname}
        onChangeText={(value) => setNickname(value.slice(0, 40))}
        placeholder="닉네임"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <FieldLabel label="한 줄 소개" caption={`${bio.length}/500`} />
      <TextInput
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

function Wishlist({
  profileState,
  assetBaseUrl,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  assetBaseUrl: string | null;
}) {
  const items = profileState.snapshot!.wishlist;
  const remove = async (item: WishlistItem) => {
    if (!profileState.snapshot) return;
    if (profileState.snapshot.isExample || !profileState.accessToken) {
      profileState.setSnapshot((current) => current ? { ...current, wishlist: current.wishlist.filter((candidate) => candidate.id !== item.id) } : current);
      return;
    }
    try {
      await removeWishlistItem(profileState.runtime.apiBaseUrl, profileState.accessToken, item.product.id);
      profileState.setSnapshot((current) => current ? { ...current, wishlist: current.wishlist.filter((candidate) => candidate.id !== item.id) } : current);
    } catch (error) {
      Alert.alert("찜을 해제하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    }
  };
  return (
    <>
      <SectionLead title={`관심 상품 ${items.length}개`} />
      {items.length ? items.map((item) => (
        <ProductRow
          key={item.id}
          product={item.product}
          ipName={item.product.ipNameKo}
          caption={categoryLabel(item.product.category)}
          assetBaseUrl={assetBaseUrl}
          onPress={() => router.push(`/product/${encodeURIComponent(item.product.id)}` as Href)}
          trailing={<Pressable accessibilityRole="button" accessibilityLabel={`${item.product.name} 찜 해제`} onPress={() => void remove(item)} style={styles.heartButton}><Ionicons name="heart" size={20} color={colors.danger} /></Pressable>}
        />
      )) : <EmptyState icon="heart-outline" title="찜한 상품이 없어요" body="뽀바에서 관심 상품을 찜하면 여기에 모여요." />}
    </>
  );
}

export function StorageHubContent({
  profileState,
  assetBaseUrl,
  initialMode = "shipping",
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  assetBaseUrl: string | null;
  initialMode?: StorageMode;
}) {
  const snapshot = profileState.snapshot!;
  const [mode, setMode] = useState<StorageMode>(initialMode);
  const storedDrawItems = useMemo(
    () => snapshot.inventory.filter(isStoredDrawInventory),
    [snapshot.inventory],
  );
  const pointReturnItems = useMemo(
    () => snapshot.inventory.filter(isPointReturnEligibleInventory),
    [snapshot.inventory],
  );

  return (
    <>
      <SectionLead
        title={`보관 중인 상품 ${storedDrawItems.length}개`}
        description="묶음 배송하거나 가챠에서 뽑은 상품을 포인트로 환급할 수 있어요."
      />
      <View accessibilityRole="tablist" style={styles.storageTabs}>
        <SeedChip
          label="배송 신청"
          selected={mode === "shipping"}
          onPress={() => setMode("shipping")}
          style={styles.storageTab}
        />
        <SeedChip
          label="포인트 환급"
          selected={mode === "point-return"}
          onPress={() => setMode("point-return")}
          style={styles.storageTab}
        />
      </View>
      {mode === "shipping" ? (
        <SeedInlineGuidance
          style={styles.storageGuidance}
          paragraphs={[
            "직접 뽑아 보관 중인 가챠·쿠지만 배송 신청할 수 있어요.",
            "배송·교환·환급 중이거나 배송 완료된 상품은 제외돼요.",
          ]}
        />
      ) : (
        <SeedInlineGuidance
          style={styles.storageGuidance}
          paragraphs={[
            "가챠에서 직접 뽑아 보관 중인 상품만 포인트 환급할 수 있어요.",
            "쿠지 추첨과 피규어 등 일반 구매 상품은 포인트 환급할 수 없어요.",
          ]}
        />
      )}
      {mode === "shipping" ? (
        <Shipping profileState={profileState} items={storedDrawItems} assetBaseUrl={assetBaseUrl} />
      ) : (
        <PointReturn profileState={profileState} items={pointReturnItems} assetBaseUrl={assetBaseUrl} />
      )}
    </>
  );
}

function Shipping({
  profileState,
  items,
  assetBaseUrl,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  items: InventoryUnit[];
  assetBaseUrl: string | null;
}) {
  const snapshot = profileState.snapshot!;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedItems = useMemo(
    () => items.filter((item) => selected.includes(item.id)),
    [items, selected],
  );
  const shippingPolicy = useMemo(
    () => calculateShippingPolicy(selectedItems.map((item) => item.product)),
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
  const submit = async () => {
    if (!selected.length) {
      Alert.alert("배송할 상품을 선택해 주세요");
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
      await createShippingRequest(profileState.runtime.apiBaseUrl, profileState.accessToken, selected);
      setSelected([]);
      await profileState.reload();
      Alert.alert("배송을 신청했어요");
    } catch (error) {
      Alert.alert("배송을 신청하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <BalancedAppText style={styles.modeDescription}>상품을 최대 20개까지 고르고 기본 배송지로 한 번에 신청할 수 있어요.</BalancedAppText>
      <View style={styles.shippingPolicyCard}>
        <View style={styles.shippingPolicyHeadingRow}>
          <Text style={styles.shippingPolicyHeading}>무료배송 기준</Text>
          {shippingPolicy.hasSelection ? (
            <Text style={styles.shippingPolicyBadge}>{shippingPolicy.isGachaOnly ? "가챠만 선택" : "다른 카테고리 포함"}</Text>
          ) : null}
        </View>
        <BalancedAppText style={styles.shippingPolicyDescription}>가챠 상품만 주문하면 30,000원 이상, 쿠지·피규어 등 다른 상품이 하나라도 포함되면 50,000원 이상 무료배송이에요.</BalancedAppText>
        {shippingPolicy.hasSelection ? (
          <View style={styles.shippingPolicySummary}>
            <View>
              <Text style={styles.shippingPolicyCaption}>선택 상품 합계</Text>
              <Text style={styles.shippingPolicyAmount}>{shippingPolicy.subtotal.toLocaleString("ko-KR")}원</Text>
            </View>
            <View style={styles.shippingPolicyResultBlock}>
              <Text style={styles.shippingPolicyCaption}>적용 기준 {shippingPolicy.threshold.toLocaleString("ko-KR")}원</Text>
              <Text style={[styles.shippingPolicyResult, shippingPolicy.qualifiesForFreeShipping && styles.shippingPolicyResultFree]}>
                {shippingPolicy.qualifiesForFreeShipping
                  ? "무료배송"
                  : `무료배송까지 ${shippingPolicy.remainingForFreeShipping.toLocaleString("ko-KR")}원`}
              </Text>
            </View>
          </View>
        ) : <BalancedAppText style={styles.shippingPolicyEmpty}>상품을 선택하면 적용 기준과 남은 금액을 계산해 드려요.</BalancedAppText>}
      </View>
      <View style={styles.addressCard}>
        <KoreanPixelTitle variant="compact" style={styles.addressHeading}>기본 배송지</KoreanPixelTitle>
        {snapshot.defaultAddress ? (
          <>
            <Text style={styles.addressName}>{snapshot.defaultAddress.recipient} · {snapshot.defaultAddress.phone}</Text>
            <Text style={styles.addressText}>[{snapshot.defaultAddress.postalCode}] {snapshot.defaultAddress.addressLine1} {snapshot.defaultAddress.addressLine2 ?? ""}</Text>
          </>
        ) : <Text style={styles.addressText}>등록된 기본 배송지가 없습니다.</Text>}
      </View>
      <Text style={styles.listHeading}>배송할 상품 선택 · {selected.length}개</Text>
      {items.map((item) => {
        const ipName = snapshot.ipNames[item.product.ipId] ?? "등록 작품";
        return (
          <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(item.id) }} onPress={() => toggle(item.id)} style={({ pressed }) => [styles.selectRow, selected.includes(item.id) && styles.selectRowActive, pressed && styles.pressed]}>
            <ProductThumb product={item.product} assetBaseUrl={assetBaseUrl} />
            <View style={styles.selectText}>
              <Text numberOfLines={1} style={styles.productSub}>{ipName} · {categoryLabel(item.product.category)}</Text>
              <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(item.product.name, ipName)}</Text>
            </View>
            <Ionicons name={selected.includes(item.id) ? "checkmark-circle" : "ellipse-outline"} size={23} color={selected.includes(item.id) ? colors.greenInk : colors.muted} />
          </Pressable>
        );
      })}
      {items.length ? <PrimaryButton label={submitting ? "신청 중" : `${selected.length}개 배송 신청하기`} disabled={submitting} onPress={() => void submit()} /> : <EmptyState icon="cube-outline" title="배송할 상품이 없어요" body="직접 뽑은 상품이 보관함에 등록되면 여기에서 선택할 수 있어요." />}
    </>
  );
}

function ShippingHistory({
  profileState,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
}) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      {snapshot.shippingRequests.length ? snapshot.shippingRequests.map((request) => (
        <Pressable key={request.id} accessibilityRole="button" accessibilityLabel={`${formatDate(request.requestedAt)} 배송 신청 상세`} onPress={() => router.push(`/profile/shipping/${encodeURIComponent(request.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}>
          <View style={styles.historyTop}><Text style={styles.historyTitle}>배송 {request.inventoryUnitIds.length}개</Text><Text style={styles.statusBadge}>{shippingStatus(request.status)}</Text></View>
          <Text style={styles.historyMeta}>{formatDate(request.requestedAt)} 신청 · {request.destination.recipientMasked}</Text>
          <Text style={styles.historyMeta}>{request.destination.addressLine1}</Text>
        </Pressable>
      )) : <EmptyState icon="car-outline" title="배송 신청 내역이 없어요" body="신청한 배송의 진행 상태가 여기에 표시돼요." />}
    </>
  );
}

function PointReturn({
  profileState,
  items,
  assetBaseUrl,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  items: InventoryUnit[];
  assetBaseUrl: string | null;
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
    () => selectedItems.reduce((total, item) => total + Math.floor(item.product.price / 2), 0),
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

    const summary = `${selectedInventoryUnitIds.length}개 · 예상 ${estimatedPointAmount.toLocaleString("ko-KR")}P\n환급한 상품은 다시 배송하거나 교환할 수 없어요.`;
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

  return (
    <>
      <SeedInlineGuidance
        style={styles.modeDescription}
        paragraphs={[
          "예상 환급 포인트는 상품 기준가의 50%예요.",
          "확인 후 신청하면 서버가 최종 포인트를 다시 계산해요.",
        ]}
      />
      <View style={styles.pointReturnSummary}>
        <View>
          <Text style={styles.shippingPolicyCaption}>선택 상품</Text>
          <Text style={styles.shippingPolicyAmount}>{selectedInventoryUnitIds.length}개</Text>
        </View>
        <View style={styles.shippingPolicyResultBlock}>
          <Text style={styles.shippingPolicyCaption}>예상 환급 포인트 · 기준가의 50%</Text>
          <Text style={[styles.shippingPolicyResult, styles.shippingPolicyResultFree]}>{estimatedPointAmount.toLocaleString("ko-KR")}P</Text>
        </View>
      </View>
      <Text style={styles.listHeading}>환급할 상품 선택 · {selectedInventoryUnitIds.length}개</Text>
      {items.map((item) => {
        const ipName = snapshot.ipNames[item.product.ipId] ?? "등록 작품";
        return (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected.includes(item.id) }}
            onPress={() => toggle(item.id)}
            style={({ pressed }) => [
              styles.selectRow,
              selected.includes(item.id) && styles.selectRowActive,
              pressed && styles.pressed,
            ]}
          >
            <ProductThumb product={item.product} assetBaseUrl={assetBaseUrl} />
            <View style={styles.selectText}>
              <Text numberOfLines={1} style={styles.productSub}>{ipName} · {categoryLabel(item.product.category)}</Text>
              <Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(item.product.name, ipName)}</Text>
              <Text numberOfLines={1} style={styles.pointReturnEstimate}>예상 {Math.floor(item.product.price / 2).toLocaleString("ko-KR")}P</Text>
            </View>
            <Ionicons name={selected.includes(item.id) ? "checkmark-circle" : "ellipse-outline"} size={23} color={selected.includes(item.id) ? colors.greenInk : colors.muted} />
          </Pressable>
        );
      })}
      {items.length ? (
        <PrimaryButton
          label={submitting ? "환급 중" : `${selectedInventoryUnitIds.length}개 포인트 환급 신청`}
          disabled={submitting}
          onPress={submit}
        />
      ) : (
        <EmptyState icon="wallet-outline" title="환급할 상품이 없어요" body="가챠에서 직접 뽑은 상품이 보관함에 등록되면 예상 포인트를 확인할 수 있어요." />
      )}
    </>
  );
}

function Orders({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const orders = snapshot.orders;
  return (
    <>
      {!snapshot.isExample && profileState.accessToken ? (
        <PaidDrawRecovery
          apiBaseUrl={profileState.runtime.apiBaseUrl}
          actorId={snapshot.profile.id}
          refreshKey={snapshot.fetchedAt}
          catalogProducts={snapshot.catalogProducts}
          ipNames={snapshot.ipNames}
        />
      ) : null}
      <SectionLead title={`주문 ${orders.length}건`} description="서버에서 확정한 결제 금액과 주문 상태를 그대로 표시합니다." />
      {orders.length ? orders.map((order) => (
        <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={`${formatDate(order.createdAt)} 주문 상세`} onPress={() => router.push(`/profile/orders/${encodeURIComponent(order.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}>
          <View style={styles.historyTop}><Text style={styles.historyTitle}>{formatDate(order.createdAt)} 주문</Text><Text style={styles.statusBadge}>{orderStatus(order.status)}</Text></View>
          {order.lines.map((line) => (
            <OrderProductLine
              key={`${order.id}-${line.productId}`}
              line={line}
              catalogProducts={snapshot.catalogProducts}
              ipNames={snapshot.ipNames}
            />
          ))}
          <View style={styles.totalRow}><Text style={styles.totalLabel}>결제 금액</Text><Text style={styles.totalValue}>{order.total.toLocaleString("ko-KR")}원</Text></View>
        </Pressable>
      )) : <EmptyState icon="receipt-outline" title="구매 내역이 없어요" body="결제가 완료된 주문이 이곳에 표시돼요." />}
    </>
  );
}

function Points({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      <View style={styles.pointHero}><Text style={styles.pointCaption}>사용 가능한 포인트</Text><Text style={styles.pointBalance}>{snapshot.pointBalance.toLocaleString("ko-KR")}P</Text></View>
      <Text style={styles.listHeading}>적립·사용 내역</Text>
      {snapshot.pointHistory.length ? snapshot.pointHistory.map((entry) => (
        <View key={entry.id} style={styles.pointRow}>
          <View><Text style={styles.pointReason}>{entry.reason}</Text><Text style={styles.historyMeta}>{formatDate(entry.createdAt)}</Text></View>
          <Text style={[styles.pointAmount, entry.amount > 0 ? styles.pointPlus : styles.pointMinus]}>{entry.amount > 0 ? "+" : ""}{entry.amount.toLocaleString("ko-KR")}P</Text>
        </View>
      )) : <EmptyState icon="wallet-outline" title="포인트 내역이 없어요" body="적립하거나 사용한 포인트가 여기에 기록돼요." />}
    </>
  );
}

function RequestRoom({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const toggleLike = async (request: WantedRequest) => {
    if (snapshot.isExample || !profileState.accessToken) {
      profileState.setSnapshot((current) => current ? {
        ...current,
        wantedRequests: current.wantedRequests.map((item) => item.id === request.id ? { ...item, likedByViewer: !item.likedByViewer, likeCount: item.likeCount + (item.likedByViewer ? -1 : 1) } : item),
      } : current);
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
      <View style={styles.requestLead}><Text style={styles.requestLeadTitle}>찾는 상품이 아직 없나요?</Text><Text style={styles.requestLeadBody}>작품·카테고리·원하는 상품을 등록하고 다른 수집가의 관심을 모아보세요.</Text><PrimaryButton label="새 신청 작성" onPress={() => router.push("/profile/requests/new" as Href)} /></View>
      <Text style={styles.listHeading}>함께 기다리는 신청</Text>
      {snapshot.wantedRequests.map((request) => (
        <View key={request.id} style={styles.requestItem}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${request.desiredItem} 신청 상세`} onPress={() => router.push(`/profile/requests/${encodeURIComponent(request.id)}` as Href)} style={({ pressed }) => [pressed && styles.pressed]}>
            {request.mediaUrl ? <Image source={{ uri: request.mediaUrl }} resizeMode="cover" style={styles.requestPhoto} /> : null}
            <View style={styles.historyTop}><Text style={styles.requestAuthor}>@{request.authorNickname}</Text><Text style={styles.categoryBadge}>{categoryLabel(request.category)}</Text></View>
            <Text style={styles.requestItemTitle}>{request.desiredItem}</Text>
            <Text style={styles.requestIp}>{request.ipNameKo}</Text>
            <Text numberOfLines={3} style={styles.requestDetails}>{request.details}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void toggleLike(request)} style={({ pressed }) => [styles.likeButton, request.likedByViewer && styles.likeButtonActive, pressed && styles.pressed]}><Ionicons name={request.likedByViewer ? "heart" : "heart-outline"} size={18} color={request.likedByViewer ? colors.greenInk : colors.muted} /><Text style={styles.likeLabel}>같이 원해요 {request.likeCount}</Text></Pressable>
        </View>
      ))}
    </>
  );
}

function Support({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      <SectionLead title="무엇을 도와드릴까요?" description="신청방은 상품 요청 공간이고, 고객센터는 공지·이용 안내·문의 처리를 담당해요." />
      <View style={styles.supportContact}><Ionicons name="time-outline" size={22} color={colors.greenInk} /><View><Text style={styles.supportTitle}>운영 안내</Text><Text style={styles.supportBody}>평일 10:00–17:00 · 주말·공휴일 휴무</Text></View></View>
      <Text style={styles.listHeading}>자주 묻는 질문</Text>
      <Faq title="보관 상품은 언제 배송할 수 있나요?" body="보관함에 보관 중인 상품을 선택해 배송 신청할 수 있어요." />
      <Faq title="교환 중인 상품도 배송할 수 있나요?" body="교환 등록이나 제안에 사용 중인 상품은 교환을 취소하거나 종료한 뒤 배송할 수 있어요." />
      <Text style={styles.listHeading}>공지사항</Text>
      {snapshot.notices.map((notice) => <Pressable key={notice.id} accessibilityRole="button" accessibilityLabel={`${notice.title} 공지 상세`} onPress={() => router.push(`/profile/notices/${encodeURIComponent(notice.id)}` as Href)} style={({ pressed }) => [styles.noticeCard, pressed && styles.pressed]}><Text style={styles.noticeTitle}>{notice.isPinned ? "[중요] " : ""}{notice.title}</Text><Text numberOfLines={3} style={styles.noticeBody}>{notice.content}</Text><Text style={styles.historyMeta}>{formatDate(notice.publishedAt ?? notice.createdAt)}</Text></Pressable>)}
      <Text style={styles.listHeading}>내 문의</Text>
      {snapshot.inquiries.length ? snapshot.inquiries.map((inquiry) => <Pressable key={inquiry.id} accessibilityRole="button" accessibilityLabel={`${inquiry.title} 문의 상세`} onPress={() => router.push(`/profile/inquiries/${encodeURIComponent(inquiry.id)}` as Href)} style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}><View style={styles.historyTop}><Text style={styles.historyTitle}>{inquiry.title}</Text><Text style={styles.statusBadge}>{inquiryStatus(inquiry.status)}</Text></View><Text style={styles.historyMeta}>{formatDate(inquiry.updatedAt)} 업데이트</Text></Pressable>) : <EmptyState icon="chatbubble-ellipses-outline" title="문의 내역이 없어요" body="도움이 필요하면 1:1 문의를 남길 수 있어요." />}
      <PrimaryButton label="1:1 문의하기" onPress={() => router.push("/profile/inquiries/new" as Href)} />
      <Text style={styles.disclosure}>운영시간과 사업자 정보는 서비스 운영 정책에 따라 안내됩니다.</Text>
    </>
  );
}

function MemberInfoMenu() {
  return (
    <>
      <SectionLead title="회원정보를 안전하게 관리해요" description="민감한 정보와 결제수단은 앱에 원문으로 저장하지 않습니다." />
      <View style={styles.menuCard}>
        <MemberLink section="personal" label="개인정보" caption="닉네임 · 휴대폰 · 이메일 · 생년월일" icon="id-card-outline" />
        <MemberLink section="address" label="기본 배송지" caption="받는 사람 · 연락처 · 주소" icon="location-outline" />
        <MemberLink section="payments" label="결제 카드" caption="결제사 연동 후 등록 가능" icon="card-outline" />
        <MemberLink section="payment-settings" label="결제 설정" caption="결제수단 연동 후 제공" icon="options-outline" />
        <MemberLink section="security" label="로그인 및 보안" caption="현재 로그인 상태와 계정 보호" icon="shield-checkmark-outline" />
        <MemberLink section="consents" label="개인정보·수신 동의" caption="필수 고지와 선택 동의" icon="document-text-outline" last />
      </View>
    </>
  );
}

function SettingsMenu() {
  return (
    <>
      <SectionLead title="앱과 계정을 설정해요" description="주문·배송 필수 알림과 선택 알림을 분리해서 관리합니다." />
      <View style={styles.menuCard}>
        <MemberLink section="notifications" label="알림 수신설정" caption="주문 · 교환 · 신청방 · 마케팅" icon="notifications-outline" />
        <MemberLink section="personal" label="계정정보" caption="회원정보와 연락처" icon="person-circle-outline" />
        <MemberLink section="security" label="로그인 및 보안" caption="활성 세션과 계정 보호" icon="lock-closed-outline" />
        <MemberLink section="legal" label="약관·운영정책" caption="이용약관 · 개인정보 · 배송 · 교환" icon="reader-outline" />
        <MemberLink section="deletion" label="로그아웃·회원탈퇴" caption="세션 종료와 탈퇴 요청" icon="log-out-outline" last />
      </View>
    </>
  );
}

function MemberLink({ section, label, caption, icon, last = false }: { section: string; label: string; caption: string; icon: keyof typeof Ionicons.glyphMap; last?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/profile/member/${section}` as Href)} style={({ pressed }) => [styles.memberRow, !last && styles.memberRowBorder, pressed && styles.pressed]}><View style={styles.memberIcon}><Ionicons name={icon} size={20} color={colors.ink} /></View><View style={styles.memberText}><Text style={styles.memberLabel}>{label}</Text><Text style={styles.memberCaption}>{caption}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>;
}

function ProductRow({ product, ipName, caption, assetBaseUrl, trailing, onPress }: { product: { name: string; imageUrl: string | null; price: number; category: CatalogProduct["category"]; version?: number }; ipName: string; caption: string; assetBaseUrl: string | null; trailing: React.ReactNode; onPress?: () => void }) {
  const content = <><ProductThumb product={product} assetBaseUrl={assetBaseUrl} catalogFrameCategory={product.category} /><View style={styles.productText}><Text numberOfLines={1} style={styles.productSub}>{ipName}</Text><Text numberOfLines={2} style={styles.productName}>{productSubjectTitle(product.name, ipName)}</Text><Text numberOfLines={1} style={styles.productCaption}>{caption}</Text><ProductInfoDivider style={styles.productFieldDivider} /><Text style={styles.productPrice}>{product.price.toLocaleString("ko-KR")}원</Text></View></>;
  return <View style={styles.productRow}>{onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${product.name} 상세 보기`} onPress={onPress} style={({ pressed }) => [styles.productMain, pressed && styles.pressed]}>{content}</Pressable> : content}{trailing}</View>;
}

function OrderProductLine({ line, catalogProducts, ipNames }: { line: components["schemas"]["AccountOrderLine"]; catalogProducts: CatalogProduct[]; ipNames: Record<string, string> }) {
  const catalogProduct = catalogProducts.find((product) => product.id === line.productId);
  const ipName = catalogProduct ? ipNames[catalogProduct.ipId] ?? "등록 작품" : "작품 정보 확인 중";
  return (
    <View style={styles.orderProduct}>
      <Text numberOfLines={1} style={styles.orderIp}>{ipName} · {categoryLabel(line.category)}</Text>
      <Text style={styles.orderLine}>{productSubjectTitle(line.productName, ipName)} · {line.quantity}개</Text>
    </View>
  );
}

function ProductThumb({ product, assetBaseUrl, catalogFrameCategory }: { product: { name: string; imageUrl: string | null; version?: number }; assetBaseUrl: string | null; catalogFrameCategory?: CatalogProduct["category"] }) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version ?? 1);
  const thumb = <View style={[styles.thumb, catalogFrameCategory === "gacha" && styles.gachaMachineMediaWindow]}>{uri ? <Image source={{ uri }} resizeMode="cover" style={styles.thumbImage} /> : <Ionicons name="image-outline" size={24} color={colors.muted} />}</View>;
  return catalogFrameCategory ? <GachaMachineFrame category={catalogFrameCategory} compact><KujiProductFrame category={catalogFrameCategory} compact>{thumb}</KujiProductFrame></GachaMachineFrame> : thumb;
}

export function DetailHeader({ title }: { title: string }) {
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={goBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Ionicons name="chevron-back" size={24} color={colors.ink} /></Pressable><View style={styles.headerTitleBlock}><KoreanPixelTitle variant="header">{title}</KoreanPixelTitle></View><View style={styles.headerSpacer} /></View>;
}

function SectionLead({ title, description }: { title: string; description?: string }) {
  return <View style={styles.sectionLead}><Text style={styles.sectionLeadTitle}>{title}</Text>{description ? <BalancedAppText style={styles.sectionLeadBody}>{description}</BalancedAppText> : null}</View>;
}

function FieldLabel({ label, caption }: { label: string; caption: string }) {
  return <View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldCaption}>{caption}</Text></View>;
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.primaryButtonLabel}>{label}</Text></Pressable>;
}

function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return <View style={styles.emptyState}><Ionicons name={icon} size={30} color={colors.muted} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
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
  return item.status === "OWNED" && (item.sourceType === "GACHA" || item.sourceType === "KUJI");
}

function shippingStatus(status: components["schemas"]["AccountShippingRequestStatus"]): string {
  return { REQUESTED: "접수", PROCESSING: "출고 준비", SHIPPED: "배송 중", DELIVERED: "배송 완료", CANCELLED: "취소" }[status];
}

function orderStatus(status: components["schemas"]["AccountOrder"]["status"]): string {
  return { PENDING_PAYMENT: "결제 대기", PAID: "결제 완료", FULFILLED: "처리 완료", CANCELLED: "취소", REFUND_REVIEW: "환불 검토", REFUNDED: "환불 완료" }[status];
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
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 13 },
  errorBox: { marginTop: seed.spacing.x5, borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak },
  errorText: { color: colors.ink, fontSize: 13, lineHeight: 20, textAlign: "center" },
  exampleGuidance: { marginBottom: seed.spacing.x4 },
  sectionLead: { marginBottom: 18 },
  sectionLeadTitle: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle },
  sectionLeadBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  storageTabs: { flexDirection: "row", gap: seed.spacing.betweenChips, marginBottom: seed.spacing.x3_5 },
  storageTab: { flex: 1 },
  modeDescription: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: seed.spacing.x3_5 },
  formCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, backgroundColor: seed.color.layer.default },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 7 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  fieldCaption: { color: colors.muted, fontSize: 10 },
  input: { minHeight: seed.size.input, borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, paddingHorizontal: seed.spacing.x3_5, color: seed.color.foreground.neutral, backgroundColor: seed.color.layer.elevated, fontSize: 14 },
  bioInput: { minHeight: 112, paddingTop: 13 },
  primaryButton: { minHeight: seed.size.actionButton.large, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, marginTop: seed.spacing.x4, backgroundColor: seed.color.background.brandSolid },
  primaryButtonLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  productRow: { minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: 11, backgroundColor: colors.surface },
  productMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 82, height: 82, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  gachaMachineMediaWindow: { borderRadius: 0 },
  thumbImage: { width: "100%", height: "100%" },
  productText: { flex: 1, minWidth: 0 },
  productName: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "900", marginTop: 3 },
  productSub: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  productCaption: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  productFieldDivider: { marginTop: 5 },
  productPrice: { color: colors.greenInk, fontSize: 13, fontWeight: "900", marginTop: 5 },
  heartButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  statusBadge: { overflow: "hidden", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, color: colors.greenInk, backgroundColor: "#E9F7E7", fontSize: 10, fontWeight: "900" },
  storageGuidance: { marginBottom: 14 },
  pointReturnSummary: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: seed.spacing.x3, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, marginBottom: seed.spacing.x3_5, backgroundColor: seed.color.layer.default },
  pointReturnEstimate: { color: colors.greenInk, fontSize: 11, lineHeight: 17, fontWeight: "800", marginTop: seed.spacing.x1 },
  shippingPolicyCard: { borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4, marginBottom: seed.spacing.x3_5, backgroundColor: seed.color.layer.default },
  shippingPolicyHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  shippingPolicyHeading: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  shippingPolicyBadge: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2_5, paddingVertical: seed.spacing.x1_5, color: colors.greenInk, backgroundColor: seed.color.background.brandWeak, fontSize: 10, fontWeight: "800" },
  shippingPolicyDescription: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: seed.spacing.x2 },
  shippingPolicySummary: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: seed.spacing.x3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, marginTop: seed.spacing.x3_5, paddingTop: seed.spacing.x3_5 },
  shippingPolicyCaption: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  shippingPolicyAmount: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: seed.spacing.x1 },
  shippingPolicyResultBlock: { flex: 1, alignItems: "flex-end" },
  shippingPolicyResult: { color: colors.ink, fontSize: 12, fontWeight: "900", marginTop: seed.spacing.x1, textAlign: "right" },
  shippingPolicyResultFree: { color: colors.greenInk },
  shippingPolicyEmpty: { color: colors.greenInk, fontSize: 11, lineHeight: 17, fontWeight: "700", marginTop: seed.spacing.x3 },
  addressCard: { borderRadius: 18, padding: 17, backgroundColor: colors.ink },
  addressHeading: { color: colors.brand },
  addressName: { color: colors.white, fontSize: 14, fontWeight: "900", marginTop: 10 },
  addressText: { color: "#B8C0B9", fontSize: 11, lineHeight: 18, marginTop: 6 },
  listHeading: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 25, marginBottom: 11 },
  selectRow: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 10, marginBottom: 9, backgroundColor: colors.surface },
  selectRowActive: { borderWidth: 2, borderColor: colors.greenInk },
  selectText: { flex: 1, minWidth: 0 },
  historyCard: { borderRadius: 17, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 10, backgroundColor: colors.surface },
  historyTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  historyTitle: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "900" },
  historyMeta: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  orderProduct: { marginTop: 10 },
  orderIp: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  orderLine: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: "800", marginTop: 2 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: 12, paddingTop: 12 },
  totalLabel: { color: colors.muted, fontSize: 11 },
  totalValue: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  pointHero: { borderRadius: seed.radius.r5, padding: seed.spacing.x6, backgroundColor: seed.color.background.brandSolid },
  pointCaption: { color: colors.greenInk, fontSize: 11, fontWeight: "800" },
  pointBalance: { color: colors.ink, fontSize: 34, lineHeight: 42, fontWeight: "900", marginTop: 5 },
  pointRow: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pointReason: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  pointAmount: { fontSize: 14, fontWeight: "900" },
  pointPlus: { color: colors.greenInk },
  pointMinus: { color: colors.ink },
  requestLead: { borderRadius: 21, padding: 20, backgroundColor: colors.ink },
  requestLeadTitle: { color: colors.white, fontSize: 20, fontWeight: "900" },
  requestLeadBody: { color: "#B8C0B9", fontSize: 12, lineHeight: 19, marginTop: 7 },
  requestItem: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 11, backgroundColor: colors.surface },
  requestPhoto: { width: "100%", aspectRatio: 16 / 9, borderRadius: 13, marginBottom: 13, backgroundColor: seed.color.layer.basement },
  requestAuthor: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  categoryBadge: { overflow: "hidden", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: "#E9F7E7", color: colors.greenInk, fontSize: 10, fontWeight: "900" },
  requestItemTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 12 },
  requestIp: { color: colors.greenInk, fontSize: 11, fontWeight: "800", marginTop: 5 },
  requestDetails: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  likeButton: { alignSelf: "flex-start", minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, marginTop: 13 },
  likeButtonActive: { borderColor: colors.greenInk, backgroundColor: "#E9F7E7" },
  likeLabel: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  supportContact: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 17, padding: 16, backgroundColor: "#E9F7E7" },
  supportTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  supportBody: { color: colors.greenInk, fontSize: 10, marginTop: 4 },
  faqCard: { borderRadius: 16, padding: 16, marginBottom: 9, backgroundColor: colors.surface },
  faqQuestion: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  faqAnswer: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  noticeCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 9, backgroundColor: colors.surface },
  noticeTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  noticeBody: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  disclosure: { color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 18, paddingHorizontal: 10 },
  menuCard: { overflow: "hidden", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  memberRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  memberRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  memberIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF1EC" },
  memberText: { flex: 1, minWidth: 0 },
  memberLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  memberCaption: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  emptyState: { minHeight: 220, alignItems: "center", justifyContent: "center", borderRadius: 18, padding: 24, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 6 },
});
