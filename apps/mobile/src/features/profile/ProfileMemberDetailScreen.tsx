import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useState } from "react";
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
import { seed } from "@/design-system/seed";
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
  return (
    <>
      <Lead title="계정 기본정보" body="이메일과 휴대폰 변경은 본인확인을 다시 거쳐야 합니다." />
      <InfoCard>
        <InfoRow label="닉네임" value={snapshot.profile.nickname} />
        <InfoRow label="이메일" value={snapshot.actor?.email ?? "m***@example.com"} />
        <InfoRow label="휴대폰" value="010-****-1234" />
        <InfoRow label="생년월일" value="미등록" last />
      </InfoCard>
      <ActionButton label="프로필 닉네임·소개 수정" onPress={() => router.push("/profile/edit" as Href)} />
      <Text style={styles.disclosure}>정식 서비스의 이메일·휴대폰 변경은 인증번호 확인과 활성 세션 재검증을 거칩니다.</Text>
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
      ) : <EmptyState icon="location-outline" title="기본 배송지가 없어요" body="주소 등록 폼은 인증 계정 연결 후 활성화됩니다." />}
      <ActionButton label={address ? "기본 배송지 수정" : "기본 배송지 등록"} onPress={() => Alert.alert("주소 편집 화면 준비 중", "우편번호 검색과 본인확인을 포함해 다음 단계에서 연결합니다.")} />
    </>
  );
}

function Payments() {
  return (
    <>
      <Lead title="안전하게 저장된 결제수단" body="앱에는 카드번호나 CVC를 저장하지 않고 PG사가 발급한 결제 토큰만 사용합니다." />
      <View style={styles.paymentCard}>
        <KoreanPixelTitle variant="compact" style={styles.paymentBrand}>결제 카드</KoreanPixelTitle>
        <Text style={styles.paymentNumber}>••••  ••••  ••••  1234</Text>
        <View style={styles.paymentFooter}><Text style={styles.paymentMeta}>테스트 카드 예시</Text><Text style={styles.paymentBadge}>미연결</Text></View>
      </View>
      <ActionButton label="결제 카드 추가" onPress={() => Alert.alert("PG 연결이 필요해요", "정식 PG 계약과 네이티브 결제 SDK 연결 후 사용할 수 있습니다.")} />
      <Text style={styles.disclosure}>전체 카드번호, CVC, 비밀번호는 클라이언트·DB·로그 어디에도 저장하지 않습니다.</Text>
    </>
  );
}

function PaymentSettings() {
  const [quickPayment, setQuickPayment] = useState(false);
  const [receipt, setReceipt] = useState(true);
  return (
    <>
      <Lead title="결제 기본 동작" body="실제 결제수단이 연결되기 전에는 이 설정이 결제를 실행하지 않습니다." />
      <InfoCard>
        <ToggleRow label="간편결제 우선 표시" body="연결된 결제수단을 결제창 위에 표시" value={quickPayment} onChange={setQuickPayment} />
        <ToggleRow label="결제 영수증 알림" body="결제·취소·환불 결과를 필수로 안내" value={receipt} onChange={setReceipt} last />
      </InfoCard>
      <Text style={styles.disclosure}>결제 완료 여부는 앱 화면이 아니라 PG 서명 Webhook과 서버 재검증으로 확정합니다.</Text>
    </>
  );
}

function Security({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  return (
    <>
      <Lead title="계정과 세션 보호" body="로그인 토큰은 기기의 SecureStore에만 저장하고 DB 비밀키는 앱에 넣지 않습니다." />
      <InfoCard>
        <InfoRow label="로그인 상태" value={snapshot.isExample ? "미로그인 · 화면 예시" : "로그인됨"} />
        <InfoRow label="계정 상태" value={snapshot.actor?.status ?? "ACTIVE"} />
        <InfoRow label="권한" value={snapshot.actor?.role ?? "USER"} />
        <InfoRow label="최근 프로필 변경" value={formatDate(snapshot.profile.updatedAt)} last />
      </InfoCard>
      <ActionButton label="모든 기기에서 로그아웃" onPress={() => Alert.alert("보안 기능 안내", "다중 기기 세션 목록과 전체 폐기는 인증 제공자 연결 후 활성화합니다.")} />
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
      Alert.alert("화면 예시에 저장했어요");
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
      <Text style={styles.disclosure}>실제 수집 항목·처리 목적·보관 기간·처리 위탁사는 출시 전 개인정보처리방침에서 확정해야 합니다.</Text>
    </>
  );
}

function Legal() {
  return (
    <>
      <Lead title="약관과 운영정책" body="아래 문서는 화면 구조를 위한 초안이며 공개 전 사업자 정보와 전문 검토가 필요합니다." />
      <Policy title="서비스 이용약관" body="회원, 상품 구매, 가챠·쿠지, 포인트, 보관함, 배송과 커뮤니티 이용 조건을 다룹니다." />
      <Policy title="개인정보처리방침" body="수집 항목, 처리 목적, 보관 기간, 제3자 제공과 처리 위탁, 권리 행사 절차를 안내합니다." />
      <Policy title="배송·보관함 정책" body="무료 보관기간, 배송비, 합배송, 출고, 장기 미신청 상품 처리 기준을 안내합니다." />
      <Policy title="교환방·신청방 운영정책" body="금지 행위, 신고, 제재, 이의제기와 콘텐츠 처리 기준을 안내합니다." />
      <View style={styles.warningBox}><Text style={styles.warningTitle}>출시 전 필수</Text><Text style={styles.warningBody}>상호·대표자·사업자등록번호·통신판매업 신고번호·주소·연락처·시행일을 실제 정보로 교체해야 합니다.</Text></View>
    </>
  );
}

function AccountActions({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const logout = () => Alert.alert("로그아웃할까요?", "이 기기의 로그인 세션을 종료합니다.", [
    { text: "취소", style: "cancel" },
    { text: "로그아웃", style: "destructive", onPress: () => { void (async () => {
      try {
        if (profileState.accessToken && !snapshot.isExample) await logoutAccount(profileState.runtime.apiBaseUrl, profileState.accessToken);
      } catch (error) {
        Alert.alert("서버 로그아웃을 확인하지 못했어요", error instanceof Error ? error.message : "기기 토큰은 정리합니다.");
      } finally {
        await clearAuthTokens();
        router.replace("/(tabs)/profile");
      }
    })(); } },
  ]);
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
        <Pressable accessibilityRole="button" onPress={() => Alert.alert("회원탈퇴 요청", snapshot.isExample ? "로그인 후 실제 계정에서 요청할 수 있어요." : "실수 방지를 위한 재인증 화면과 차단 항목 확인을 다음 단계에서 연결합니다.")} style={styles.dangerButton}><Text style={styles.dangerButtonLabel}>회원탈퇴 요청</Text></Pressable>
      </View>
    </>
  );
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

function Policy({ title, body }: { title: string; body: string }) {
  return <View style={styles.policyCard}><Text style={styles.policyTitle}>{title}</Text><Text style={styles.policyBody}>{body}</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} style={styles.policyArrow} /></View>;
}

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.actionButtonLabel}>{label}</Text></Pressable>;
}

function ExampleNotice() {
  return <View style={styles.exampleBanner}><View style={styles.exampleDot} /><Text style={styles.exampleText}>로그인 전 화면 예시입니다. 민감정보는 실제 값이 아니라 마스킹된 테스트 정보예요.</Text></View>;
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
  exampleBanner: { minHeight: seed.size.actionButton.medium, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2, borderRadius: seed.radius.r3, paddingHorizontal: seed.spacing.x3_5, marginBottom: seed.spacing.x4, backgroundColor: seed.color.background.brandWeak },
  exampleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenInk },
  exampleText: { flex: 1, color: colors.greenInk, fontSize: 10, lineHeight: 16, fontWeight: "700" },
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
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.danger, marginTop: 16 },
  dangerButtonLabel: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  emptyState: { minHeight: 220, alignItems: "center", justifyContent: "center", borderRadius: 18, padding: 24, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 6 },
});
