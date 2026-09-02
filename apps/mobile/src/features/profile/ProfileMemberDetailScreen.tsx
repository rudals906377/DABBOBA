import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { components } from "@dabboba/contracts";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  fetchAccountDeletionRequest,
  requestAccountDeletion,
  type AccountDeletionRequest,
} from "@/features/profile/account-detail-api";
import {
  formatDate,
  logoutAccount,
  updateNotificationPreferences,
} from "@/features/profile/profile-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { clearAuthTokens } from "@/lib/session-store";
import { colors } from "@/theme";

type Preferences = components["schemas"]["NotificationPreferences"];
type ToggleKey = Exclude<keyof Preferences, "orderUpdates" | "version" | "updatedAt">;

const DETAIL_META = {
  personal: { title: "개인정보" },
  address: { title: "기본 배송지" },
  payments: { title: "결제 카드" },
  "payment-settings": { title: "결제 설정" },
  security: { title: "로그인 및 보안" },
  notifications: { title: "알림 수신설정" },
  consents: { title: "개인정보·수신 동의" },
  legal: { title: "약관·운영정책" },
  deletion: { title: "로그아웃·회원탈퇴" },
} as const;

type MemberSection = keyof typeof DETAIL_META;

export function ProfileMemberDetailScreen() {
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: MemberSection = rawSection && rawSection in DETAIL_META ? rawSection as MemberSection : "personal";
  const meta = DETAIL_META[section];
  const profileState = useProfileSnapshot();
  const hasFocusedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current) void profileState.reload();
      else hasFocusedOnce.current = true;
    }, [profileState.reload]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header title={meta.title} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
      >
        {!profileState.snapshot && !profileState.message ? <Loading /> : null}
        {profileState.message ? <ErrorState message={profileState.message} onRetry={profileState.reload} /> : null}
        {profileState.snapshot?.isExample ? <ExampleNotice /> : null}
        {profileState.snapshot ? <MemberContent section={section} profileState={profileState} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberContent({ section, profileState }: { section: MemberSection; profileState: ReturnType<typeof useProfileSnapshot> }) {
  if (section === "personal") return <Personal profileState={profileState} />;
  if (section === "address") return <Address profileState={profileState} />;
  if (section === "payments") return <Payments />;
  if (section === "payment-settings") return <PaymentSettings />;
  if (section === "security") return <Security profileState={profileState} />;
  if (section === "notifications") return <Notifications profileState={profileState} />;
  if (section === "consents") return <Consents profileState={profileState} />;
  if (section === "legal") return <Legal />;
  return <AccountActions profileState={profileState} />;
}

function Personal({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const basicInfo = snapshot.basicInfo;
  return (
    <>
      <Lead title="계정 기본정보" body="이메일과 휴대폰 변경은 본인확인을 다시 거쳐야 합니다." />
      <InfoCard>
        <InfoRow label="닉네임" value={basicInfo.nickname} />
        <InfoRow label="이메일" value={basicInfo.email ?? "등록된 이메일 없음"} />
        <InfoRow label="휴대폰" value={basicInfo.phoneMasked ?? "등록된 번호 없음"} />
        <InfoRow label="생년월일" value={basicInfo.birthDate ? basicInfo.birthDate.replaceAll("-", ".") : "미등록"} last />
      </InfoCard>
      <ActionButton label="계정 기본정보 수정" onPress={() => router.push("/profile/member/personal/edit" as Href)} />
      <Text style={styles.disclosure}>이메일·휴대폰을 변경할 때는 인증번호 확인과 다시 로그인이 필요할 수 있어요.</Text>
    </>
  );
}

function Address({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const address = profileState.snapshot!.defaultAddress;
  return (
    <>
      <Lead title="배송에 사용할 기본 주소" body="배송 신청 전 받는 사람과 주소를 다시 확인할 수 있어요." />
      {address ? (
        <View style={styles.addressCard}>
          <View style={styles.addressIcon}><Ionicons name="location" size={22} color={colors.greenInk} /></View>
          <Text style={styles.addressName}>{address.recipient} · {address.phone}</Text>
          <Text style={styles.addressLine}>[{address.postalCode}] {address.addressLine1}</Text>
          {address.addressLine2 ? <Text style={styles.addressLine}>{address.addressLine2}</Text> : null}
          {address.deliveryNote ? <Text style={styles.deliveryNote}>배송 메모 · {address.deliveryNote}</Text> : null}
          <Text style={styles.updatedAt}>{formatDate(address.updatedAt)} 확인</Text>
        </View>
      ) : <EmptyState icon="location-outline" title="기본 배송지가 없어요" body="로그인하면 배송지를 등록할 수 있어요." />}
      <ActionButton label={address ? "기본 배송지 수정" : "기본 배송지 등록"} onPress={() => router.push("/profile/member/address/edit" as Href)} />
    </>
  );
}

function Payments() {
  return (
    <>
      <Lead title="안전하게 저장된 결제수단" body="카드번호와 보안번호는 앱에 저장하지 않고 결제사가 안전하게 관리해요." />
      <View style={styles.paymentCard}>
        <KoreanPixelTitle variant="compact" style={styles.paymentBrand}>결제 카드</KoreanPixelTitle>
        <Text style={styles.paymentNumber}>••••  ••••  ••••  ••••</Text>
        <View style={styles.paymentFooter}><Text style={styles.paymentMeta}>카드 등록 전</Text><Text style={styles.paymentBadge}>미등록</Text></View>
      </View>
      <ActionButton label="결제 카드 등록 준비 중" disabled onPress={() => undefined} />
      <Text style={styles.disclosure}>전체 카드번호, 보안번호, 비밀번호는 앱이나 서비스 기록에 저장하지 않아요.</Text>
    </>
  );
}

function PaymentSettings() {
  return (
    <>
      <Lead title="결제 기본 동작" body="결제수단을 등록하기 전에는 이 설정으로 결제가 진행되지 않아요." />
      <InfoCard>
        <ToggleRow label="간편결제 우선 표시" body="결제수단 연동 후 설정 가능" value={false} disabled onChange={() => undefined} />
        <ToggleRow label="결제 영수증 알림" body="결제수단 연동 후 설정 가능" value disabled onChange={() => undefined} last />
      </InfoCard>
      <Text style={styles.disclosure}>결제 완료 여부는 결제사의 승인 내역을 안전하게 확인한 뒤 확정해요.</Text>
    </>
  );
}

function Security({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      <Lead title="계정과 세션 보호" body="로그인 정보는 기기에 안전하게 보관하고 민감한 서비스 정보는 앱에 저장하지 않아요." />
      <InfoCard>
        <InfoRow label="로그인 상태" value={snapshot.isExample ? "로그인이 필요해요" : "로그인됨"} />
        <InfoRow label="계정 상태" value={snapshot.actor?.status ?? "ACTIVE"} />
        <InfoRow label="권한" value={snapshot.actor?.role ?? "USER"} />
        <InfoRow label="최근 프로필 변경" value={formatDate(snapshot.profile.updatedAt)} last />
      </InfoCard>
      <ActionButton label="다른 기기 로그아웃 준비 중" disabled onPress={() => undefined} />
    </>
  );
}

function Notifications({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const [preferences, setPreferences] = useState(snapshot.notificationPreferences);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPreferences(snapshot.notificationPreferences), [snapshot.notificationPreferences]);
  const update = (key: ToggleKey, value: boolean) => setPreferences((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (snapshot.isExample || !profileState.accessToken) {
      profileState.setSnapshot((current) => current ? { ...current, notificationPreferences: preferences } : current);
      Alert.alert("로그인 후 저장할 수 있어요", "현재 변경은 앱을 다시 열면 초기화될 수 있어요.");
      return;
    }
    try {
      setSaving(true);
      const updated = await updateNotificationPreferences(profileState.runtime.apiBaseUrl, profileState.accessToken, {
        exchangeUpdates: preferences.exchangeUpdates,
        requestUpdates: preferences.requestUpdates,
        restockUpdates: preferences.restockUpdates,
        marketingSms: preferences.marketingSms,
        marketingEmail: preferences.marketingEmail,
        marketingPush: preferences.marketingPush,
        personalizedRecommendations: preferences.personalizedRecommendations,
        expectedVersion: preferences.version,
      });
      setPreferences(updated);
      profileState.setSnapshot((current) => current ? { ...current, notificationPreferences: updated } : current);
      Alert.alert("알림 설정을 저장했어요");
    } catch (error) {
      Alert.alert("설정을 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Lead title="필수 알림과 선택 알림" body="주문·결제·배송처럼 꼭 필요한 안내는 끌 수 없어요." />
      <Text style={styles.groupTitle}>필수 안내</Text>
      <InfoCard><ToggleRow label="주문·결제·배송" body="계약 이행과 상품 수령에 필요한 필수 알림" value disabled onChange={() => undefined} last /></InfoCard>
      <Text style={styles.groupTitle}>활동 알림</Text>
      <InfoCard>
        <ToggleRow label="교환방" body="새 제안과 선택·거절 결과" value={preferences.exchangeUpdates} onChange={(value) => update("exchangeUpdates", value)} />
        <ToggleRow label="신청방" body="같이 원해요와 반영 소식" value={preferences.requestUpdates} onChange={(value) => update("requestUpdates", value)} />
        <ToggleRow label="재입고" body="찜한 상품 판매 재개" value={preferences.restockUpdates} onChange={(value) => update("restockUpdates", value)} last />
      </InfoCard>
      <Text style={styles.groupTitle}>마케팅·추천</Text>
      <InfoCard>
        <ToggleRow label="앱 푸시" body="혜택과 이벤트 소식" value={preferences.marketingPush} onChange={(value) => update("marketingPush", value)} />
        <ToggleRow label="이메일" body="이메일 혜택 안내" value={preferences.marketingEmail} onChange={(value) => update("marketingEmail", value)} />
        <ToggleRow label="문자" body="문자 혜택 안내" value={preferences.marketingSms} onChange={(value) => update("marketingSms", value)} />
        <ToggleRow label="맞춤 추천" body="관심 작품 기반 상품 추천" value={preferences.personalizedRecommendations} onChange={(value) => update("personalizedRecommendations", value)} last />
      </InfoCard>
      <ActionButton label={saving ? "저장 중" : "알림 설정 저장"} disabled={saving} onPress={() => void save()} />
    </>
  );
}

function Consents({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const preferences = profileState.snapshot!.notificationPreferences;
  return (
    <>
      <Lead title="동의 현황" body="필수 개인정보 처리는 서비스 제공을 위한 범위로 제한하고 선택 동의는 언제든 철회할 수 있어요." />
      <InfoCard>
        <ConsentRow title="서비스 이용 필수 동의" status="동의" />
        <ConsentRow title="주문·배송 정보 처리" status="동의" />
        <ConsentRow title="마케팅 정보 수신" status={preferences.marketingPush || preferences.marketingEmail || preferences.marketingSms ? "일부 동의" : "미동의"} />
        <ConsentRow title="맞춤 추천" status={preferences.personalizedRecommendations ? "동의" : "미동의"} last />
      </InfoCard>
      <ActionButton label="선택 동의 변경" onPress={() => router.push("/profile/member/notifications" as Href)} />
      <Text style={styles.disclosure}>수집 항목·이용 목적·보관 기간·처리 위탁은 개인정보처리방침에서 확인할 수 있어요.</Text>
    </>
  );
}

function Legal() {
  return (
    <>
      <Lead title="약관과 운영정책" body="이용 중 적용되는 기준을 문서별로 확인할 수 있어요." />
      <Policy policyId="terms" title="서비스 이용약관" body="회원, 상품 구매, 가챠·쿠지, 포인트, 보관함, 배송과 커뮤니티 이용 조건" />
      <Policy policyId="privacy" title="개인정보처리방침" body="수집 항목, 처리 목적, 보관 기간과 회원의 권리" />
      <Policy policyId="shipping-storage" title="배송·보관함 정책" body="신청 가능한 상품, 무료배송, 출고와 수령 기준" />
      <Policy policyId="exchange-request" title="교환방·신청방 운영정책" body="교환 제안, 상품 신청, 금지 행위와 이용 제한" />
    </>
  );
}

function AccountActions({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequest | null>(null);
  const [deletionPending, setDeletionPending] = useState(false);
  useEffect(() => {
    if (snapshot.isExample || !profileState.accessToken) return;
    let active = true;
    void fetchAccountDeletionRequest(profileState.runtime.apiBaseUrl, profileState.accessToken)
      .then((result) => { if (active) setDeletionRequest(result); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [profileState.accessToken, profileState.runtime.apiBaseUrl, snapshot.isExample]);

  const logout = () => Alert.alert("로그아웃할까요?", "이 기기의 로그인 세션을 종료합니다.", [
    { text: "취소", style: "cancel" },
    { text: "로그아웃", style: "destructive", onPress: () => { void (async () => {
      try {
        if (profileState.accessToken && !snapshot.isExample) await logoutAccount(profileState.runtime.apiBaseUrl, profileState.accessToken);
      } catch (error) {
        Alert.alert("로그아웃 상태를 확인하지 못했어요", error instanceof Error ? error.message : "이 기기의 로그인 정보는 정리할게요.");
      } finally {
        await clearAuthTokens();
        router.replace("/(tabs)/profile");
      }
    })(); } },
  ]);

  const requestDeletion = () => {
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 회원탈퇴를 요청할 수 있어요.");
      return;
    }
    Alert.alert(
      "회원탈퇴를 요청할까요?",
      "진행 중인 주문·배송·교환과 보관 상품을 확인한 뒤 처리되며, 요청이 접수되면 모든 기기에서 로그아웃됩니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "탈퇴 요청",
          style: "destructive",
          onPress: () => { void (async () => {
            try {
              setDeletionPending(true);
              const result = await requestAccountDeletion(profileState.runtime.apiBaseUrl, profileState.accessToken!);
              setDeletionRequest(result);
              await clearAuthTokens();
              Alert.alert("탈퇴 요청을 접수했어요", "진행 상태를 검토한 뒤 등록된 연락처로 안내해 드려요.", [
                { text: "확인", onPress: () => router.replace("/(tabs)/profile") },
              ]);
            } catch (error) {
              Alert.alert("탈퇴를 요청하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
            } finally {
              setDeletionPending(false);
            }
          })(); },
        },
      ],
    );
  };

  return (
    <>
      <Lead title="계정 세션과 탈퇴" body="로그아웃은 계정을 삭제하지 않으며, 회원탈퇴는 진행 중인 거래와 법정 보관 기록을 확인한 뒤 처리됩니다." />
      <View style={styles.actionCard}>
        <Ionicons name="log-out-outline" size={25} color={colors.ink} />
        <View style={styles.actionText}><Text style={styles.actionTitle}>로그아웃</Text><Text style={styles.actionBody}>이 기기의 현재 로그인 세션만 종료해요.</Text></View>
        <Pressable accessibilityRole="button" onPress={logout} style={styles.smallButton}><Text style={styles.smallButtonLabel}>로그아웃</Text></Pressable>
      </View>
      <View style={styles.dangerCard}>
        <Ionicons name="warning-outline" size={25} color={colors.danger} />
        <Text style={styles.dangerTitle}>탈퇴 후 되돌릴 수 없어요</Text>
        <Text style={styles.dangerBody}>보관 상품, 진행 중인 주문·배송·교환, 남은 포인트가 있으면 탈퇴 요청이 보류될 수 있어요. 법령상 보관이 필요한 거래 기록은 계정과 분리해 정해진 기간 동안 보관될 수 있습니다.</Text>
        {deletionRequest ? <View style={styles.deletionStatus}><Text style={styles.deletionStatusLabel}>현재 상태</Text><Text style={styles.deletionStatusValue}>{deletionStatusLabel(deletionRequest.status)}</Text></View> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ busy: deletionPending }} disabled={deletionPending} onPress={requestDeletion} style={[styles.dangerButton, deletionPending && styles.disabled]}><Text style={styles.dangerButtonLabel}>{deletionPending ? "요청 중" : "회원탈퇴 요청"}</Text></Pressable>
      </View>
    </>
  );
}

function deletionStatusLabel(status: AccountDeletionRequest["status"]): string {
  if (status === "PENDING_REVIEW") return "검토 중";
  if (status === "BLOCKED") return "처리 대기";
  if (status === "APPROVED") return "승인됨";
  if (status === "COMPLETED") return "처리 완료";
  if (status === "REJECTED") return "처리 불가";
  return "요청 취소";
}

function Header({ title }: { title: string }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Ionicons name="chevron-back" size={24} color={colors.ink} /></Pressable><View style={styles.headerTitleBlock}><KoreanPixelTitle variant="header">{title}</KoreanPixelTitle></View><View style={styles.headerSpacer} /></View>;
}

function Lead({ title, body }: { title: string; body: string }) {
  return <View style={styles.lead}><Text style={styles.leadTitle}>{title}</Text><Text style={styles.leadBody}>{body}</Text></View>;
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.infoCard}>{children}</View>;
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <View style={[styles.infoRow, !last && styles.infoRowBorder]}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function ToggleRow({ label, body, value, onChange, disabled = false, last = false }: { label: string; body: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; last?: boolean }) {
  return <View style={[styles.toggleRow, !last && styles.infoRowBorder]}><View style={styles.toggleText}><Text style={styles.toggleLabel}>{label}</Text><Text style={styles.toggleBody}>{body}</Text></View><Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: "#C9CEC8", true: colors.brand }} thumbColor={colors.white} /></View>;
}

function ConsentRow({ title, status, last = false }: { title: string; status: string; last?: boolean }) {
  return <View style={[styles.infoRow, !last && styles.infoRowBorder]}><Text style={styles.infoLabel}>{title}</Text><Text style={styles.consentStatus}>{status}</Text></View>;
}

function Policy({ policyId, title, body }: { policyId: string; title: string; body: string }) {
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/profile/member/legal/${policyId}` as Href)} style={({ pressed }) => [styles.policyCard, pressed && styles.pressed]}><Text style={styles.policyTitle}>{title}</Text><Text style={styles.policyBody}>{body}</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} style={styles.policyArrow} /></Pressable>;
}

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.actionButtonLabel}>{label}</Text></Pressable>;
}

function ExampleNotice() {
  return <SeedInlineGuidance style={styles.exampleGuidance}>로그인하면 내 계정 정보와 보안 설정을 확인할 수 있어요.</SeedInlineGuidance>;
}

function Loading() {
  return <View style={styles.loading}><ActivityIndicator color={colors.ink} /><Text style={styles.loadingText}>회원정보를 불러오는 중</Text></View>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View style={styles.errorBox}><Text style={styles.errorText}>{message}</Text><ActionButton label="다시 불러오기" onPress={onRetry} /></View>;
}

function EmptyState({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return <View style={styles.emptyState}><Ionicons name={icon} size={30} color={colors.muted} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  header: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  headerTitleBlock: { flex: 1, alignItems: "center" },
  headerSpacer: { width: 56 },
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 13 },
  errorBox: { borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak },
  errorText: { color: colors.ink, fontSize: 13, lineHeight: 20, textAlign: "center" },
  exampleGuidance: { marginBottom: seed.spacing.x4 },
  lead: { marginBottom: 18 },
  leadTitle: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle },
  leadBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  infoCard: { overflow: "hidden", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  infoRow: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingHorizontal: 16 },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  infoLabel: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "800" },
  infoValue: { maxWidth: "58%", color: colors.muted, fontSize: 11, textAlign: "right" },
  actionButton: { minHeight: seed.size.actionButton.large, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, marginTop: seed.spacing.x4, backgroundColor: seed.color.background.brandSolid },
  actionButtonLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  disclosure: { color: colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 18, paddingHorizontal: 10 },
  addressCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4_5, backgroundColor: seed.color.layer.default },
  addressIcon: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3_5, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandWeak },
  addressName: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 14 },
  addressLine: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  deliveryNote: { color: colors.greenInk, fontSize: 11, marginTop: 12 },
  updatedAt: { color: colors.muted, fontSize: 9, marginTop: 13 },
  paymentCard: { minHeight: 190, borderRadius: seed.radius.r5, padding: seed.spacing.x5, backgroundColor: seed.color.layer.inverted },
  paymentBrand: { color: colors.brand },
  paymentNumber: { color: colors.white, fontSize: 23, letterSpacing: 1.5, fontWeight: "800", marginTop: 38 },
  paymentFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 35 },
  paymentMeta: { color: "#B8C0B9", fontSize: 10 },
  paymentBadge: { overflow: "hidden", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, color: colors.greenInk, backgroundColor: colors.brand, fontSize: 9, fontWeight: "900" },
  toggleRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  toggleText: { flex: 1, minWidth: 0 },
  toggleLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  toggleBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  groupTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 22, marginBottom: 9 },
  consentStatus: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, color: seed.color.foreground.brand, backgroundColor: seed.color.background.brandWeak, fontSize: 10, fontWeight: "700" },
  policyCard: { minHeight: 92, justifyContent: "center", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, paddingHorizontal: seed.spacing.x4, paddingRight: seed.size.touchTarget, marginBottom: seed.spacing.x2_5, backgroundColor: seed.color.layer.default },
  policyTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  policyBody: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 6 },
  policyArrow: { position: "absolute", right: 15 },
  warningBox: { borderRadius: seed.radius.r4, padding: seed.spacing.x4, marginTop: seed.spacing.x2, backgroundColor: seed.color.background.criticalWeak },
  warningTitle: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  warningBody: { color: colors.ink, fontSize: 10, lineHeight: 17, marginTop: 6 },
  actionCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x3_5, backgroundColor: seed.color.layer.default },
  actionText: { flex: 1, minWidth: 0 },
  actionTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  actionBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  smallButton: { minHeight: 38, justifyContent: "center", borderRadius: 9, paddingHorizontal: 11, backgroundColor: "#ECEFEC" },
  smallButtonLabel: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  dangerCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.critical, padding: seed.spacing.x4_5, marginTop: seed.spacing.x3_5, backgroundColor: seed.color.background.criticalWeak },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: "900", marginTop: 12 },
  dangerBody: { color: colors.ink, fontSize: 11, lineHeight: 18, marginTop: 8 },
  deletionStatus: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.critical, marginTop: seed.spacing.x3, paddingTop: seed.spacing.x3 },
  deletionStatusLabel: { color: colors.muted, fontSize: 11 },
  deletionStatusValue: { color: colors.danger, fontSize: 12, fontWeight: "900" },
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.danger, marginTop: 16 },
  dangerButtonLabel: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  emptyState: { minHeight: 220, alignItems: "center", justifyContent: "center", borderRadius: 18, padding: 24, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 6 },
});
