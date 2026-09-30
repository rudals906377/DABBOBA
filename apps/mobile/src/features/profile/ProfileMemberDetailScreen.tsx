import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import type { components } from "@dabboba/contracts";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text } from "@/components/Typography";
import { SeedInlineGuidance } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  clearAccountDeletionReceipt,
  fetchAccountDeletionPreview,
  fetchAccountDeletionRequest,
  fetchAccountDeletionStatusByReceipt,
  fetchAccountPolicyAcceptances,
  readAccountDeletionReceipt,
  requestAccountDeletion,
  storeAccountDeletionReceipt,
  type AccountDeletionReceipt,
  type AccountDeletionRequest,
  type AccountPolicyAcceptanceStatus,
} from "@/features/profile/account-detail-api";
import {
  formatDate,
  logoutAccount,
  logoutOtherAccountSessions,
  updateNotificationPreferences,
} from "@/features/profile/profile-api";
import { profileSectionFailure } from "@/features/profile/profile-section-state";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { ProfileSessionGate, isProfileSessionBlocked } from "@/features/profile/ProfileSessionGate";
import { clearAuthTokens } from "@/lib/session-store";
import { resolvePublicAppLink } from "@/lib/public-app-links";
import { clearBrokerSession } from "@/features/auth/supabase-broker";
import {
  readPushPermissionGranted,
  synchronizeAccountPushDevice,
  unregisterCurrentAccountPushDevice,
} from "@/features/notifications/push-device";
import { clearUserScopedLocalData } from "@/lib/local-database";
import { clearAccountDeviceState } from "@/features/profile/account-device-cleanup";
import { colors } from "@/theme";

type Preferences = components["schemas"]["NotificationPreferences"];
type ToggleKey = Exclude<keyof Preferences, "orderUpdates" | "version" | "updatedAt">;
type UserRole = components["schemas"]["UserRole"];
type UserStatus = components["schemas"]["UserStatus"];

const ACCOUNT_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "정상 이용 중",
  SUSPENDED: "일시 이용 정지",
  BANNED: "이용 제한",
  DELETED: "탈퇴 처리됨",
};

const ACCOUNT_ROLE_LABELS: Record<UserRole, string> = {
  USER: "일반 회원",
  ADMIN: "관리자",
  SUPER_ADMIN: "최고 관리자",
};

const SWITCH_HIT_SLOP = { top: 7, bottom: 7, left: 0, right: 0 } as const;

const DETAIL_META = {
  personal: { title: "개인정보" },
  address: { title: "기본 배송지" },
  security: { title: "로그인 및 보안" },
  notifications: { title: "알림 수신설정" },
  consents: { title: "개인정보·수신 동의" },
  legal: { title: "약관·운영정책" },
  deletion: { title: "로그아웃·회원탈퇴" },
} as const;

type MemberSection = keyof typeof DETAIL_META;
type ProfileBackedMemberSection = Exclude<MemberSection, "legal">;

export function ProfileMemberDetailScreen() {
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: MemberSection = rawSection && rawSection in DETAIL_META ? rawSection as MemberSection : "personal";
  const meta = DETAIL_META[section];

  return section === "legal"
    ? <StaticLegalScreen title={meta.title} />
    : <ProfileBackedMemberDetailScreen section={section} title={meta.title} />;
}

function StaticLegalScreen({ title }: { title: string }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header title={title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Legal />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileBackedMemberDetailScreen({
  section,
  title,
}: {
  section: ProfileBackedMemberSection;
  title: string;
}) {
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
      <Header title={title} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={profileState.refreshing} onRefresh={profileState.reload} tintColor={colors.ink} />}
      >
        {profileState.status === "loading" ? <Loading /> : null}
        {profileState.status === "error" ? <ErrorState message={profileState.message} onRetry={profileState.reload} /> : null}
        {profileState.snapshot ? <MemberContent section={section} profileState={profileState} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberContent({ section, profileState }: { section: ProfileBackedMemberSection; profileState: ReturnType<typeof useProfileSnapshot> }) {
  if (section === "deletion" && isProfileSessionBlocked(profileState.status)) {
    return (
      <DeletionReceiptStatus
        apiBaseUrl={profileState.runtime.apiBaseUrl}
        sessionStatus={profileState.status}
      />
    );
  }
  if (isProfileSessionBlocked(profileState.status)) {
    return (
      <ProfileSessionGate
        status={profileState.status}
        returnTo={`/profile/member/${section}`}
        guestBody="로그인하면 계정 정보와 설정을 확인할 수 있어요."
      />
    );
  }
  if (section === "personal") return <Personal profileState={profileState} />;
  if (section === "address") return <Address profileState={profileState} />;
  if (section === "security") return <Security profileState={profileState} />;
  if (section === "notifications") return <Notifications profileState={profileState} />;
  if (section === "consents") return <Consents profileState={profileState} />;
  return <AccountActions profileState={profileState} />;
}

type DeletionReceiptState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; request: AccountDeletionRequest }
  | { kind: "error"; message: string };

function DeletionReceiptStatus({
  apiBaseUrl,
  sessionStatus,
}: {
  apiBaseUrl: string;
  sessionStatus: "guest" | "expired";
}) {
  const [state, setState] = useState<DeletionReceiptState>({ kind: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void readAccountDeletionReceipt()
      .then(async (receipt) => {
        if (!receipt) return { kind: "none" } as const;
        const request = await fetchAccountDeletionStatusByReceipt(apiBaseUrl, receipt);
        return { kind: "loaded", request } as const;
      })
      .then((next) => { if (active) setState(next); })
      .catch((error) => {
        if (active) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "탈퇴 처리 상태를 확인하지 못했습니다.",
          });
        }
      });
    return () => { active = false; };
  }, [apiBaseUrl, revision]);

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "none") {
    return (
      <ProfileSessionGate
        status={sessionStatus}
        returnTo="/profile/member/deletion"
        guestBody="로그인하면 로그아웃과 회원탈퇴를 관리할 수 있어요."
      />
    );
  }
  if (state.kind === "error") {
    return (
      <>
        <ErrorState message={state.message} onRetry={() => setRevision((value) => value + 1)} />
        <ActionButton
          label="저장된 접수 기록 지우기"
          onPress={() => {
            void clearAccountDeletionReceipt().then(() => setState({ kind: "none" }));
          }}
        />
      </>
    );
  }

  const terminal = ["COMPLETED", "REJECTED", "CANCELLED"].includes(state.request.status);
  return (
    <>
      <Lead
        title="회원탈퇴 처리 상태"
        body="로그아웃된 뒤에도 이 기기에 안전하게 저장된 접수증으로 처리 상태를 확인할 수 있어요."
      />
      <InfoCard>
        <InfoRow label="접수번호" value={state.request.id} />
        <InfoRow label="처리 상태" value={deletionStatusLabel(state.request.status)} />
        <InfoRow label="접수 시각" value={formatDate(state.request.requestedAt)} />
        <InfoRow
          label="완료 시각"
          value={state.request.completedAt ? formatDate(state.request.completedAt) : "처리 중"}
          last
        />
      </InfoCard>
      {state.request.status === "BLOCKED" ? (
        <SeedInlineGuidance style={styles.receiptGuidance}>
          {deletionBlockerMessage(state.request.blockers)} 다시 로그인해 해당 항목을 정리한 뒤 요청해 주세요.
        </SeedInlineGuidance>
      ) : null}
      <ActionButton
        label={terminal ? "접수 기록 확인 완료" : "처리 상태 새로고침"}
        onPress={() => {
          if (terminal) {
            void clearAccountDeletionReceipt().then(() => setState({ kind: "none" }));
          } else {
            setRevision((value) => value + 1);
          }
        }}
      />
    </>
  );
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
  const snapshot = profileState.snapshot!;
  const address = snapshot.defaultAddress;
  const failure = profileSectionFailure(snapshot, "address");
  // A failed address request must not read as "no address yet" or offer registration.
  if (failure) {
    return (
      <>
        <Lead title="배송에 사용할 기본 주소" body="배송 신청 전 받는 사람과 주소를 다시 확인할 수 있어요." />
        <ErrorState message={failure} onRetry={profileState.reload} />
      </>
    );
  }
  return (
    <>
      <Lead title="배송에 사용할 기본 주소" body="배송 신청 전 받는 사람과 주소를 다시 확인할 수 있어요." />
      {address ? (
        <View style={styles.addressCard}>
          <View style={styles.addressIcon}><DecorativeIonicon name="location" size={22} color={colors.greenInk} /></View>
          <Text style={styles.addressName}>{address.recipient} · {address.phone}</Text>
          <Text style={styles.addressLine}>[{address.postalCode}] {address.addressLine1}</Text>
          {address.addressLine2 ? <Text style={styles.addressLine}>{address.addressLine2}</Text> : null}
          {address.deliveryNote ? <Text style={styles.deliveryNote}>배송 메모 · {address.deliveryNote}</Text> : null}
          <Text style={styles.updatedAt}>{formatDate(address.updatedAt)} 확인</Text>
        </View>
      ) : <EmptyState icon="location-outline" title="기본 배송지가 없어요" body="배송에 사용할 주소를 등록해 주세요." />}
      <ActionButton label={address ? "기본 배송지 수정" : "기본 배송지 등록"} onPress={() => router.push("/profile/member/address/edit" as Href)} />
    </>
  );
}

function Security({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const [revoking, setRevoking] = useState(false);
  const logoutOthers = async () => {
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 다른 기기의 세션을 종료할 수 있어요.");
      return;
    }
    try {
      setRevoking(true);
      await logoutOtherAccountSessions(profileState.runtime.apiBaseUrl, profileState.accessToken);
      Alert.alert("다른 기기에서 로그아웃했어요", "현재 기기의 로그인은 유지됩니다.");
    } catch (error) {
      Alert.alert("세션을 종료하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setRevoking(false);
    }
  };
  return (
    <>
      <Lead title="계정과 세션 보호" body="로그인 정보는 기기에 안전하게 보관하고 민감한 서비스 정보는 앱에 저장하지 않아요." />
      <InfoCard>
        <InfoRow label="로그인 상태" value={snapshot.isExample ? "로그인이 필요해요" : "로그인됨"} />
        <InfoRow label="계정 상태" value={accountStatusLabel(snapshot.actor?.status)} />
        <InfoRow label="권한" value={accountRoleLabel(snapshot.actor?.role)} />
        <InfoRow label="최근 프로필 변경" value={formatDate(snapshot.profile.updatedAt)} last />
      </InfoCard>
      {!snapshot.isExample ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다른 모든 기기에서 로그아웃"
          accessibilityState={{ disabled: revoking, busy: revoking }}
          disabled={revoking}
          onPress={() => void logoutOthers()}
          style={({ pressed }) => [styles.secondaryAction, revoking && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryActionLabel}>{revoking ? "로그아웃 중" : "다른 기기에서 로그아웃"}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.disclosure}>공용 기기에서는 이용을 마친 뒤 로그아웃해 주세요. 회원탈퇴를 완료하면 연결된 로그인 계정과 남은 세션도 삭제됩니다.</Text>
    </>
  );
}

function Notifications({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const snapshot = profileState.snapshot!;
  const failure = profileSectionFailure(snapshot, "preferences");
  const loaded = snapshot.notificationPreferences;
  // Unknown server preferences cannot be edited or saved; show the retryable failure instead of defaults.
  if (failure || !loaded) {
    return (
      <>
        <Lead title="필수 알림과 선택 알림" body="주문·결제·배송처럼 꼭 필요한 안내는 끌 수 없어요." />
        <ErrorState message={failure ?? "알림 설정을 불러오지 못했어요."} onRetry={profileState.reload} />
      </>
    );
  }
  return <NotificationsForm profileState={profileState} loaded={loaded} />;
}

function NotificationsForm({
  profileState,
  loaded,
}: {
  profileState: ReturnType<typeof useProfileSnapshot>;
  loaded: Preferences;
}) {
  const snapshot = profileState.snapshot!;
  const [preferences, setPreferences] = useState(loaded);
  const [saving, setSaving] = useState(false);
  const [pushPermission, setPushPermission] = useState<boolean | null>(null);
  const [connectingPush, setConnectingPush] = useState(false);
  useEffect(() => setPreferences(loaded), [loaded]);
  useEffect(() => {
    let active = true;
    void readPushPermissionGranted().then((granted) => {
      if (active) setPushPermission(granted);
    });
    return () => { active = false; };
  }, []);
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
  const connectPush = async () => {
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 이 기기의 푸시 알림을 연결할 수 있어요.");
      return;
    }
    try {
      setConnectingPush(true);
      const result = await synchronizeAccountPushDevice(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
        { requestPermission: true },
      );
      const granted = result.status === "registered";
      setPushPermission(granted);
      if (result.status === "registered") {
        Alert.alert("이 기기 알림을 연결했어요", "필수 계정 활동과 동의한 선택 알림을 받을 수 있어요.");
      } else if (result.status === "denied") {
        Alert.alert("기기 알림이 꺼져 있어요", "휴대폰 설정에서 DABBOBA 알림을 허용해 주세요.", [
          { text: "나중에", style: "cancel" },
          { text: "설정 열기", onPress: () => { void Linking.openSettings(); } },
        ]);
      } else if (result.status === "unconfigured") {
        Alert.alert("알림을 연결할 수 없어요", "출시용 알림 설정을 확인한 뒤 다시 시도해 주세요.");
      } else {
        Alert.alert("이 기기에서 연결하지 못했어요", "실기기와 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
      }
    } catch (error) {
      Alert.alert("푸시 알림을 연결하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setConnectingPush(false);
    }
  };
  return (
    <>
      <Lead title="필수 알림과 선택 알림" body="주문·결제·배송처럼 꼭 필요한 안내는 끌 수 없어요." />
      <Text style={styles.groupTitle}>이 기기</Text>
      <InfoCard><InfoRow label="푸시 알림 권한" value={pushPermission === null ? "확인 중" : pushPermission ? "허용됨" : "꺼짐"} last /></InfoCard>
      <ActionButton label={connectingPush ? "연결 중" : "이 기기 푸시 연결"} disabled={connectingPush} onPress={() => void connectPush()} />
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
  const snapshot = profileState.snapshot!;
  const preferencesFailure = profileSectionFailure(snapshot, "preferences");
  const preferences = preferencesFailure ? null : snapshot.notificationPreferences;
  const [policyStatus, setPolicyStatus] = useState<AccountPolicyAcceptanceStatus | null>(null);
  const [policyError, setPolicyError] = useState(false);
  useEffect(() => {
    if (snapshot.isExample || !profileState.accessToken) return;
    let active = true;
    setPolicyError(false);
    void fetchAccountPolicyAcceptances(profileState.runtime.apiBaseUrl, profileState.accessToken)
      .then((result) => { if (active) setPolicyStatus(result); })
      .catch(() => { if (active) setPolicyError(true); });
    return () => { active = false; };
  }, [profileState.accessToken, profileState.runtime.apiBaseUrl, snapshot.isExample]);
  const terms = policyStatus?.documents.find((document) => document.key === "TERMS");
  const privacy = policyStatus?.documents.find((document) => document.key === "PRIVACY");
  return (
    <>
      <Lead title="동의 현황" body="필수 개인정보 처리는 서비스 제공을 위한 범위로 제한하고 선택 동의는 언제든 철회할 수 있어요." />
      {preferencesFailure || !preferences ? (
        <ErrorState message={preferencesFailure ?? "알림 설정을 불러오지 못했어요."} onRetry={profileState.reload} />
      ) : null}
      <InfoCard>
        <ConsentRow title="서비스 이용약관" status={policyAcceptanceLabel(terms, policyError)} />
        <ConsentRow title="개인정보처리방침" status={policyAcceptanceLabel(privacy, policyError)} />
        <ConsentRow title="주문·배송 정보 처리" status="계약 이행 시 처리" />
        <ConsentRow title="마케팅 정보 수신" status={!preferences ? "불러오지 못했어요" : preferences.marketingPush || preferences.marketingEmail || preferences.marketingSms ? "일부 동의" : "미동의"} />
        <ConsentRow title="맞춤 추천" status={!preferences ? "불러오지 못했어요" : preferences.personalizedRecommendations ? "동의" : "미동의"} last />
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
      <Policy policyId="terms" title="서비스 이용약관" body="회원, 상품 구매, 가챠·쿠지, 포인트, 보관함, 배송과 교환·신청 이용 조건" />
      <Policy policyId="privacy" title="개인정보처리방침" body="수집 항목, 처리 목적, 보관 기간과 회원의 권리" />
      <Policy policyId="shipping-storage" title="배송·보관함 정책" body="신청 가능한 상품, 무료배송, 출고와 수령 기준" />
      <Policy policyId="exchange-request" title="교환방·신청방 운영정책" body="교환 제안, 상품 신청, 금지 행위와 이용 제한" />
    </>
  );
}

function AccountActions({ profileState }: { profileState: ReturnType<typeof useProfileSnapshot> }) {
  const db = useSQLiteContext();
  const snapshot = profileState.snapshot!;
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequest | null>(null);
  const [deletionPending, setDeletionPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const publicDeletionUrl = resolvePublicAppLink("accountDeletion");
  useEffect(() => {
    if (snapshot.isExample || !profileState.accessToken) return;
    let active = true;
    void fetchAccountDeletionRequest(profileState.runtime.apiBaseUrl, profileState.accessToken)
      .then((result) => { if (active) setDeletionRequest(result); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [profileState.accessToken, profileState.runtime.apiBaseUrl, snapshot.isExample]);

  const logout = () => {
    if (logoutPending) return;
    Alert.alert("로그아웃할까요?", "이 기기의 로그인 세션을 종료합니다.", [
    { text: "취소", style: "cancel" },
    { text: "로그아웃", style: "destructive", onPress: () => { void (async () => {
      setLogoutPending(true);
      let remoteFailure: unknown = null;
      try {
        if (profileState.accessToken && !snapshot.isExample) {
          await unregisterCurrentAccountPushDevice(
            profileState.runtime.apiBaseUrl,
            profileState.accessToken,
          ).catch(() => undefined);
          await logoutAccount(profileState.runtime.apiBaseUrl, profileState.accessToken);
        }
      } catch (error) {
        remoteFailure = error;
      }
      try {
        await clearAccountDeviceState({
          clearLocalData: () => clearUserScopedLocalData(db),
          clearBrokerSession,
          clearAuthTokens,
        });
      } catch (error) {
        setLogoutPending(false);
        void profileState.reload();
        Alert.alert(
          "기기 로그아웃을 완료하지 못했어요",
          `이전 계정의 기기 정보를 지우지 못해 계정 전환을 막았어요. 다시 시도해 주세요. ${error instanceof Error ? error.message : ""}`.trim(),
        );
        return;
      }
      setLogoutPending(false);
      router.replace("/(tabs)/profile");
      if (remoteFailure) {
        Alert.alert(
          "서버 로그아웃 상태를 확인하지 못했어요",
          "이 기기의 로그인 정보는 삭제했지만 서버 세션 종료는 확인되지 않았어요. 다시 로그인한 뒤 로그인 및 보안에서 다른 기기 로그아웃을 확인해 주세요.",
        );
      }
    })(); } },
    ]);
  };

  const finalizeAcceptedDeletion = async (result: AccountDeletionReceipt) => {
    setDeletionPending(true);
    try {
      await storeAccountDeletionReceipt({ id: result.id, statusToken: result.statusToken });
      if (result.status === "BLOCKED") {
        Alert.alert("탈퇴 처리가 보류됐어요", deletionBlockerMessage(result.blockers));
        return;
      }
      await clearAccountDeviceState({
        clearLocalData: () => clearUserScopedLocalData(db),
        clearBrokerSession,
        clearAuthTokens,
      });
      Alert.alert("탈퇴 요청을 접수했어요", `접수번호 ${result.id}\n처리가 완료될 때까지 이 계정의 로그인이 제한됩니다. 내정보 > 설정 > 로그아웃·회원탈퇴에서 상태를 확인할 수 있어요.`, [
        { text: "확인", onPress: () => router.replace("/(tabs)/profile") },
      ]);
    } catch {
      Alert.alert(
        "탈퇴 요청은 서버에 접수됐어요",
        `접수번호 ${result.id}\n기기의 접수 기록 또는 로그인 정보 정리를 완료하지 못했어요. 서버 요청은 다시 보내지 않고 기기 정리만 다시 시도할 수 있어요.`,
        [
          { text: "나중에", style: "cancel" },
          { text: "다시 정리", onPress: () => { void finalizeAcceptedDeletion(result); } },
        ],
      );
    } finally {
      setDeletionPending(false);
    }
  };

  const requestDeletion = async () => {
    if (snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 회원탈퇴를 요청할 수 있어요.");
      return;
    }
    try {
      setDeletionPending(true);
      const preview = await fetchAccountDeletionPreview(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
      );
      if (!preview.canDeleteNow) {
        Alert.alert("아직 탈퇴할 수 없어요", deletionBlockerMessage(preview.blockers));
        return;
      }
    } catch (error) {
      Alert.alert("탈퇴 가능 상태를 확인하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
      return;
    } finally {
      setDeletionPending(false);
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
              await finalizeAcceptedDeletion(result);
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
        <DecorativeIonicon name="log-out-outline" size={25} color={colors.ink} />
        <View style={styles.actionText}><Text style={styles.actionTitle}>로그아웃</Text><Text style={styles.actionBody}>이 기기의 현재 로그인 세션만 종료해요.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="이 기기에서 로그아웃" accessibilityState={{ disabled: logoutPending, busy: logoutPending }} disabled={logoutPending} onPress={logout} style={({ pressed }) => [styles.smallButton, logoutPending && styles.disabled, pressed && styles.pressed]}><Text style={styles.smallButtonLabel}>{logoutPending ? "정리 중" : "로그아웃"}</Text></Pressable>
      </View>
      <View style={styles.dangerCard}>
        <DecorativeIonicon name="warning-outline" size={25} color={colors.danger} />
        <Text style={styles.dangerTitle}>탈퇴 후 되돌릴 수 없어요</Text>
        <Text style={styles.dangerBody}>보관 상품, 진행 중인 주문·배송·교환, 남은 포인트가 있으면 탈퇴 요청이 보류될 수 있어요. 법령상 보관이 필요한 거래 기록은 계정과 분리해 정해진 기간 동안 보관될 수 있습니다.</Text>
        {deletionRequest ? <View style={styles.deletionStatus}><Text style={styles.deletionStatusLabel}>현재 상태</Text><Text style={styles.deletionStatusValue}>{deletionStatusLabel(deletionRequest.status)}</Text></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="회원탈퇴 요청" accessibilityState={{ disabled: deletionPending, busy: deletionPending }} disabled={deletionPending} onPress={() => void requestDeletion()} style={({ pressed }) => [styles.dangerButton, deletionPending && styles.disabled, pressed && styles.pressed]}><Text style={styles.dangerButtonLabel}>{deletionPending ? "확인 중" : "회원탈퇴 요청"}</Text></Pressable>
        {publicDeletionUrl ? (
          <Pressable accessibilityRole="link" accessibilityLabel="웹에서 탈퇴와 데이터 삭제 안내 보기" onPress={() => void Linking.openURL(publicDeletionUrl)} style={({ pressed }) => [styles.deletionWebLink, pressed && styles.pressed]}>
            <Text style={styles.deletionWebLinkLabel}>웹에서 탈퇴·데이터 삭제 안내 보기</Text>
            <DecorativeIonicon name="open-outline" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function policyAcceptanceLabel(
  document: AccountPolicyAcceptanceStatus["documents"][number] | undefined,
  failed: boolean,
): string {
  if (failed) return "확인 필요";
  if (!document) return "확인 중";
  if (!document.accepted || !document.acceptedAt) return `${document.version} 미동의`;
  return `${document.version} · ${formatDate(document.acceptedAt)} 동의`;
}

function deletionBlockerMessage(blockers: components["schemas"]["AccountDeletionBlockers"]): string {
  const labels: Array<[keyof typeof blockers, string]> = [
    ["pointBalance", "남은 포인트"],
    ["activeOrderCount", "진행 중 주문"],
    ["activePaymentCount", "진행 중 결제"],
    ["availableDrawEntitlementCount", "사용 가능한 뽑기권"],
    ["activeInventoryCount", "보관 상품"],
    ["activeShippingRequestCount", "진행 중 배송"],
    ["activeExchangeListingCount", "진행 중 교환 등록"],
    ["activeExchangeOfferCount", "진행 중 교환 제안"],
  ];
  const details = labels
    .filter(([key]) => blockers[key] > 0)
    .map(([key, label]) => `${label} ${blockers[key].toLocaleString("ko-KR")}`);
  return details.length > 0
    ? `${details.join(" · ")} 항목을 먼저 정리해 주세요.`
    : "계정 상태가 변경됐습니다. 새로고침 후 다시 확인해 주세요.";
}

function deletionStatusLabel(status: AccountDeletionRequest["status"]): string {
  if (status === "PENDING_REVIEW") return "검토 중";
  if (status === "BLOCKED") return "처리 대기";
  if (status === "PROCESSING") return "삭제 처리 중";
  if (status === "APPROVED") return "승인됨";
  if (status === "COMPLETED") return "처리 완료";
  if (status === "REJECTED") return "처리 불가";
  return "요청 취소";
}

function accountStatusLabel(status: UserStatus | null | undefined): string {
  return status ? ACCOUNT_STATUS_LABELS[status] : "계정 정보 없음";
}

function accountRoleLabel(role: UserRole | null | undefined): string {
  return role ? ACCOUNT_ROLE_LABELS[role] : "권한 정보 없음";
}

function Header({ title }: { title: string }) {
  return <DetailPageHeader title={title} titleMode="pixel" onBack={() => router.back()} />;
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
  return (
    <View style={[styles.toggleRow, !last && styles.infoRowBorder]}>
      <View style={styles.toggleText}><Text style={styles.toggleLabel}>{label}</Text><Text style={styles.toggleBody}>{body}</Text></View>
      <View style={styles.switchTouchTarget}>
        <Switch
          accessibilityLabel={label}
          accessibilityRole="switch"
          accessibilityState={{ checked: value, disabled }}
          value={value}
          disabled={disabled}
          hitSlop={SWITCH_HIT_SLOP}
          onValueChange={onChange}
          trackColor={{ false: "#C9CEC8", true: colors.brand }}
          thumbColor={colors.white}
        />
      </View>
    </View>
  );
}

function ConsentRow({ title, status, last = false }: { title: string; status: string; last?: boolean }) {
  return <View style={[styles.infoRow, !last && styles.infoRowBorder]}><Text style={styles.infoLabel}>{title}</Text><Text style={styles.consentStatus}>{status}</Text></View>;
}

function Policy({ policyId, title, body }: { policyId: string; title: string; body: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title} 보기`} onPress={() => router.push(`/profile/member/legal/${policyId}` as Href)} style={({ pressed }) => [styles.policyCard, pressed && styles.pressed]}><Text style={styles.policyTitle}>{title}</Text><Text style={styles.policyBody}>{body}</Text><DecorativeIonicon name="chevron-forward" size={18} color={colors.muted} style={styles.policyArrow} /></Pressable>;
}

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.actionButtonLabel}>{label}</Text></Pressable>;
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

function EmptyState({ icon, title, body }: { icon: DecorativeIoniconName; title: string; body: string }) {
  return <View style={styles.emptyState}><DecorativeIonicon name={icon} size={30} color={colors.muted} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x4_5, paddingBottom: seed.spacing.screenBottom },
  header: { minHeight: seed.size.topNavigation, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  headerTitleBlock: { flex: 1, alignItems: "center" },
  headerSpacer: { width: 56 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
  loading: { minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 13 },
  errorBox: { borderRadius: seed.radius.r4, padding: seed.spacing.x5, backgroundColor: seed.color.background.criticalWeak },
  errorText: { color: colors.ink, fontSize: 13, lineHeight: 20, textAlign: "center" },
  exampleGuidance: { marginBottom: seed.spacing.x4 },
  lead: { marginBottom: 18 },
  leadTitle: { color: seed.color.foreground.neutral, ...seed.typography.screenTitle },
  leadBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  infoCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.neutral, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default },
  infoRow: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingHorizontal: 16 },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  infoLabel: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "800" },
  infoValue: { maxWidth: "58%", color: colors.muted, fontSize: 11, textAlign: "right" },
  actionButton: { minHeight: seed.size.actionButton.large, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, marginTop: seed.spacing.x4, backgroundColor: seed.color.background.brandSolid },
  actionButtonLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  secondaryAction: { minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, borderWidth: 1, borderColor: seed.color.stroke.neutral, marginTop: seed.spacing.x4, backgroundColor: seed.color.layer.default },
  secondaryActionLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  disclosure: { color: colors.muted, ...seed.typography.finePrint, textAlign: "center", marginTop: seed.spacing.x4_5, paddingHorizontal: seed.spacing.x2_5 },
  addressCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x4_5, backgroundColor: seed.color.layer.default },
  addressIcon: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3_5, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.brandWeak },
  addressName: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 14 },
  addressLine: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  deliveryNote: { color: colors.greenInk, fontSize: 11, marginTop: 12 },
  updatedAt: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x3 },
  toggleRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  toggleText: { flex: 1, minWidth: 0 },
  switchTouchTarget: { width: 56, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  toggleLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  toggleBody: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1 },
  groupTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 22, marginBottom: 9 },
  consentStatus: { overflow: "hidden", borderRadius: seed.radius.r2, paddingHorizontal: seed.spacing.x2, paddingVertical: seed.spacing.x1, color: seed.color.foreground.brand, backgroundColor: seed.color.background.brandWeak, ...seed.typography.finePrint, fontWeight: "700" },
  policyCard: { minHeight: 92, justifyContent: "center", borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, paddingHorizontal: seed.spacing.x4, paddingRight: seed.size.touchTarget, marginBottom: seed.spacing.x2_5, backgroundColor: seed.color.layer.default },
  policyTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  policyBody: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1_5 },
  policyArrow: { position: "absolute", right: 15 },
  warningBox: { borderRadius: seed.radius.r4, padding: seed.spacing.x4, marginTop: seed.spacing.x2, backgroundColor: seed.color.background.criticalWeak },
  warningTitle: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  warningBody: { color: colors.ink, ...seed.typography.finePrint, marginTop: seed.spacing.x1_5 },
  actionCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: seed.spacing.componentDefault, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, padding: seed.spacing.x3_5, backgroundColor: seed.color.layer.default },
  actionText: { flex: 1, minWidth: 0 },
  actionTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  actionBody: { color: colors.muted, ...seed.typography.finePrint, marginTop: seed.spacing.x1 },
  smallButton: { minHeight: seed.size.touchTarget, justifyContent: "center", borderRadius: seed.radius.r2_5, paddingHorizontal: seed.spacing.x3, backgroundColor: "#ECEFEC" },
  smallButtonLabel: { color: colors.ink, ...seed.typography.finePrint, fontWeight: "900" },
  dangerCard: { borderRadius: seed.radius.r5, borderWidth: 1, borderColor: seed.color.stroke.critical, padding: seed.spacing.x4_5, marginTop: seed.spacing.x3_5, backgroundColor: seed.color.background.criticalWeak },
  dangerTitle: { color: colors.danger, fontSize: 16, fontWeight: "900", marginTop: 12 },
  dangerBody: { color: colors.ink, fontSize: 11, lineHeight: 18, marginTop: 8 },
  deletionStatus: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: seed.color.stroke.critical, marginTop: seed.spacing.x3, paddingTop: seed.spacing.x3 },
  deletionStatusLabel: { color: colors.muted, fontSize: 11 },
  deletionStatusValue: { color: colors.danger, fontSize: 12, fontWeight: "900" },
  deletionWebLink: { minHeight: seed.size.touchTarget, marginTop: seed.spacing.x2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x2 },
  deletionWebLinkLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  receiptGuidance: { marginTop: seed.spacing.x4 },
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: seed.radius.r3, borderWidth: 1, borderColor: colors.danger, marginTop: 16 },
  dangerButtonLabel: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  emptyState: { minHeight: 220, alignItems: "center", justifyContent: "center", padding: seed.spacing.x6 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 12 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 6 },
});
