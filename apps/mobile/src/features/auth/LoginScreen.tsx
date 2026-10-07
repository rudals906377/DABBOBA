import Constants from "expo-constants";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSQLiteContext } from "expo-sqlite";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  completeSocialCustomerLogin,
  exchangeBrokerSession,
  fetchAuthProviderAvailability,
  fetchStoreReviewAvailability,
  loginStoreReviewer,
} from "@/features/auth/auth-api";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { resolveAfterLoginPath } from "@/features/auth/login-navigation";
import { ensureInternalCustomerSession } from "@/features/demo/demo-api";
import {
  beginSocialLogin,
  clearPendingPhoneOtp,
  clearBrokerSession,
  readPendingPhoneOtp,
  requestPhoneOtp,
  resolveSupabaseBrokerConfig,
  verifyPhoneOtp,
  type DabbobaLoginProvider,
  type DabbobaSocialLoginProvider,
} from "@/features/auth/supabase-broker";
import { PHONE_OTP_TTL_MS, type PendingPhoneOtp } from "@/features/auth/phone-otp";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { clearLocalDataBeforeCustomerLogin, clearUserScopedLocalData } from "@/lib/local-database";
import { resolvePublicAppLink } from "@/lib/public-app-links";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/brand/dabboba-wordmark.png");

function openCurrentPolicy(kind: "terms" | "privacy") {
  const localRoute = `/legal/${kind}` as Href;
  const url = resolvePublicAppLink(kind);
  if (!url) {
    router.push(localRoute);
    return;
  }
  void Linking.openURL(url).catch(() => router.push(localRoute));
}

type PhoneStep = "NUMBER" | "OTP";
type LoginMethod = DabbobaLoginProvider | "SESSION_RECOVERY" | "STORE_REVIEW";
type InternalSessionState = "checking" | "unavailable" | "failed";

export function LoginScreen() {
  const db = useSQLiteContext();
  const { requiredPolicyVersions, configReady, refresh: refreshPublicConfig } = useCommerceCapability();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnPath = resolveAfterLoginPath(params.returnTo);
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
  const [brokerReady, setBrokerReady] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<DabbobaLoginProvider[]>([]);
  const [checking, setChecking] = useState(true);
  const [providerCheckFailed, setProviderCheckFailed] = useState(false);
  const [providerAvailabilityMessage, setProviderAvailabilityMessage] = useState("");
  const providerRequestGeneration = useRef(0);
  const [busy, setBusy] = useState<LoginMethod | null>(null);
  const [message, setMessage] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("NUMBER");
  const [phoneInput, setPhoneInput] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [otpFocused, setOtpFocused] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  // Terms 3조: 만 14세 미만은 가입할 수 없다. The confirmation gates every login
  // method together with the two required policy documents.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [internalSessionState, setInternalSessionState] = useState<InternalSessionState>(
    __DEV__ ? "checking" : "unavailable",
  );
  // Shown only while the server has an active app-store review window.
  const [storeReviewEnabled, setStoreReviewEnabled] = useState(false);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewEmailFocused, setReviewEmailFocused] = useState(false);
  const [reviewPasswordFocused, setReviewPasswordFocused] = useState(false);

  const applyPendingPhoneOtp = (pending: PendingPhoneOtp) => {
    setPhoneInput(pending.phone);
    setVerifiedPhone(pending.phone);
    setOtpExpiresAt(pending.expiresAt);
    setResendAvailableAt(pending.resendAvailableAt);
    setPhoneStep("OTP");
    setOtp("");
    setClockMs(Date.now());
  };

  useEffect(() => {
    let active = true;
    void readPendingPhoneOtp().then((pending) => {
      if (active && pending) applyPendingPhoneOtp(pending);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (phoneStep !== "OTP" || otpExpiresAt === null) return undefined;
    setClockMs(Date.now());
    const timer = setInterval(() => setClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [phoneStep, otpExpiresAt]);

  const refreshProviderAvailability = useCallback(async () => {
    const generation = ++providerRequestGeneration.current;
    setChecking(true);
    setProviderCheckFailed(false);
    try {
      const localConfigured = Boolean(resolveSupabaseBrokerConfig());
      const reviewAvailability = fetchStoreReviewAvailability(runtime.apiBaseUrl);
      const availability = await fetchAuthProviderAvailability(runtime.apiBaseUrl);
      const reviewEnabled = await reviewAvailability;
      if (generation !== providerRequestGeneration.current) return;
      setStoreReviewEnabled(reviewEnabled);
      const ready = localConfigured && availability.brokerExchangeConfigured;
      const supportedMethods = availability.methods.filter((provider) => provider !== "APPLE" || Platform.OS === "ios");
      setEnabledProviders(supportedMethods);
      setBrokerReady(ready);
      setProviderAvailabilityMessage(
        !ready || supportedMethods.length === 0
          ? "사용 가능한 로그인 방식이 아직 설정되지 않았어요."
          : "",
      );
    } catch (error) {
      if (generation !== providerRequestGeneration.current) return;
      setStoreReviewEnabled(false);
      setEnabledProviders([]);
      setBrokerReady(false);
      setProviderCheckFailed(true);
      setProviderAvailabilityMessage(error instanceof Error ? error.message : "로그인 연결 상태를 확인하지 못했어요.");
    } finally {
      if (generation === providerRequestGeneration.current) setChecking(false);
    }
  }, [runtime.apiBaseUrl]);

  useFocusEffect(useCallback(() => {
    void refreshProviderAvailability();
    return () => { providerRequestGeneration.current += 1; };
  }, [refreshProviderAvailability]));

  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    void ensureInternalCustomerSession(runtime.apiBaseUrl, () => clearUserScopedLocalData(db), () => active)
      .then((tokens) => {
        if (!active) return;
        if (tokens) {
          router.replace(returnPath);
          return;
        }
        setInternalSessionState("unavailable");
      })
      .catch(() => {
        if (!active) return;
        setInternalSessionState("failed");
        setMessage("로그인 정보를 자동으로 불러오지 못했어요. 다시 시도해 주세요.");
      });
    return () => {
      active = false;
    };
  }, [db, returnPath, runtime.apiBaseUrl]);

  const finishPhone = async (supabaseAccessToken: string) => {
    if (!requiredPolicyVersions || !termsAccepted || !privacyAccepted || !ageConfirmed) {
      throw new Error("필수 항목을 모두 확인하고 동의해 주세요.");
    }
    let exchanged = false;
    try {
      await exchangeBrokerSession(
        runtime.apiBaseUrl,
        supabaseAccessToken,
        requiredPolicyVersions,
        "PHONE",
        (previousCustomerStored) => clearLocalDataBeforeCustomerLogin(db, previousCustomerStored),
      );
      exchanged = true;
    } finally {
      await clearBrokerSession();
    }
    if (exchanged) router.replace(returnPath);
  };

  const loginSocial = async (provider: DabbobaSocialLoginProvider) => {
    if (!requiredPolicyVersions || !termsAccepted || !privacyAccepted || !ageConfirmed) {
      setMessage("필수 항목을 모두 확인하고 동의해 주세요.");
      return;
    }
    setBusy(provider);
    setMessage("");
    try {
      const callbackUrl = await beginSocialLogin(provider, String(returnPath), requiredPolicyVersions);
      const completedReturnTo = await completeSocialCustomerLogin(
        runtime.apiBaseUrl,
        callbackUrl,
        (previousCustomerStored) => clearLocalDataBeforeCustomerLogin(db, previousCustomerStored),
      );
      router.replace(completedReturnTo as Href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인을 완료하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  const loginReviewer = async () => {
    if (!requiredPolicyVersions || !termsAccepted || !privacyAccepted || !ageConfirmed) {
      setMessage("필수 항목을 모두 확인하고 동의해 주세요.");
      return;
    }
    setBusy("STORE_REVIEW");
    setMessage("");
    try {
      await loginStoreReviewer(
        runtime.apiBaseUrl,
        reviewEmail,
        reviewPassword,
        requiredPolicyVersions,
        (previousCustomerStored) => clearLocalDataBeforeCustomerLogin(db, previousCustomerStored),
      );
      setReviewPassword("");
      router.replace(returnPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "심사용 계정으로 로그인하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  const sendOtp = async (number = phoneInput) => {
    setBusy("PHONE");
    setMessage("");
    try {
      applyPendingPhoneOtp(await requestPhoneOtp(number));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증번호를 보내지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  const loginPhone = async () => {
    setBusy("PHONE");
    setMessage("");
    try {
      await finishPhone(await verifyPhoneOtp(verifiedPhone, otp));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "휴대폰 로그인을 완료하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  const retryInternalSession = async () => {
    setBusy("SESSION_RECOVERY");
    setMessage("");
    try {
      const tokens = await ensureInternalCustomerSession(runtime.apiBaseUrl, () => clearUserScopedLocalData(db));
      if (!tokens) {
        setInternalSessionState("unavailable");
        return;
      }
      router.replace(returnPath);
    } catch {
      setInternalSessionState("failed");
      setMessage("로그인 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  };

  const unavailable = checking
    || busy !== null
    || internalSessionState === "checking"
    || !configReady
    || !requiredPolicyVersions
    || !termsAccepted
    || !privacyAccepted
    || !ageConfirmed;
  const providerAvailable = (provider: DabbobaLoginProvider) => (
    brokerReady && enabledProviders.includes(provider) && (provider !== "APPLE" || Platform.OS === "ios")
  );
  const hasSocialProvider = (["KAKAO", "NAVER", "GOOGLE", "APPLE"] as const).some(providerAvailable);
  const phoneProviderAvailable = providerAvailable("PHONE");
  const showLoginActions = hasSocialProvider || phoneProviderAvailable || (__DEV__ && internalSessionState === "failed");
  const otpExpired = otpExpiresAt !== null && clockMs >= otpExpiresAt;
  const resendSeconds = resendAvailableAt === null
    ? 0
    : Math.max(0, Math.ceil((resendAvailableAt - clockMs) / 1_000));
  const otpSeconds = otpExpiresAt === null
    ? Math.floor(PHONE_OTP_TTL_MS / 1_000)
    : Math.max(0, Math.ceil((otpExpiresAt - clockMs) / 1_000));
  const connectionRetryVisible = !checking
    && (providerCheckFailed || (configReady && (!requiredPolicyVersions || !brokerReady || enabledProviders.length === 0)));

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <DetailPageHeader
          title="로그인"
          titleMode="pixel"
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
        />

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Image accessibilityLabel="DABBOBA" source={WORDMARK} resizeMode="contain" style={styles.wordmark} />
          <Text style={styles.title}>다뽀바를 계속 즐겨보세요</Text>
          <Text style={styles.subtitle}>관심 상품과 계정 정보를 안전하게 저장해요.</Text>
          {!configReady ? (
            <Text accessibilityLiveRegion="polite" style={styles.policyAvailabilityStatus}>현재 약관 버전을 확인하고 있어요.</Text>
          ) : !requiredPolicyVersions ? (
            <Text accessibilityRole="alert" style={styles.policyAvailabilityError}>약관 정보를 확인할 수 없어 로그인을 잠시 이용할 수 없어요.</Text>
          ) : null}
          {checking ? <ActivityIndicator color={colors.ink} style={styles.status} /> : null}
          {!checking && providerAvailabilityMessage && requiredPolicyVersions ? (
            <Text accessibilityRole="alert" style={styles.message}>{providerAvailabilityMessage}</Text>
          ) : null}
          {connectionRetryVisible ? (
            <SeedActionButton
              label="로그인 연결 다시 확인"
              variant="neutralSolid"
              size="small"
              onPress={() => {
                setMessage("");
                void Promise.all([refreshPublicConfig(), refreshProviderAvailability()]);
              }}
              style={styles.connectionRetry}
            />
          ) : null}

          {showLoginActions ? (
            <View style={[styles.actions, connectionRetryVisible && styles.actionsAfterRetry]}>
              {providerAvailable("KAKAO") ? (
                <ProviderButton
                  label="카카오로 계속하기"
                  mark="K"
                  backgroundColor="#FEE500"
                  foregroundColor="#191919"
                  loading={busy === "KAKAO"}
                  disabled={unavailable}
                  onPress={() => void loginSocial("KAKAO")}
                />
              ) : null}
              {providerAvailable("NAVER") ? (
                <ProviderButton
                  label="네이버로 계속하기"
                  mark="N"
                  backgroundColor="#03C75A"
                  foregroundColor="#FFFFFF"
                  loading={busy === "NAVER"}
                  disabled={unavailable}
                  onPress={() => void loginSocial("NAVER")}
                />
              ) : null}
              {providerAvailable("GOOGLE") ? (
                <ProviderButton
                  label="구글로 계속하기"
                  icon="logo-google"
                  backgroundColor="#FFFFFF"
                  foregroundColor="#202124"
                  loading={busy === "GOOGLE"}
                  disabled={unavailable}
                  onPress={() => void loginSocial("GOOGLE")}
                />
              ) : null}
              {providerAvailable("APPLE") ? (
                <ProviderButton
                  label="애플로 계속하기"
                  icon="logo-apple"
                  backgroundColor="#111111"
                  foregroundColor="#FFFFFF"
                  loading={busy === "APPLE"}
                  disabled={unavailable}
                  onPress={() => void loginSocial("APPLE")}
                />
              ) : null}

              {hasSocialProvider && phoneProviderAvailable ? (
                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerLabel}>또는</Text>
                  <View style={styles.divider} />
                </View>
              ) : null}

              {phoneProviderAvailable && (phoneStep === "NUMBER" ? (
              <>
                <Text style={styles.fieldLabel}>휴대폰 번호</Text>
                <SeedInputShell focused={phoneFocused}>
                  <TextInput
                    accessibilityLabel="휴대폰 번호"
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    placeholder="010-1234-5678"
                    placeholderTextColor={seed.color.foreground.muted}
                    maxLength={16}
                    style={styles.input}
                  />
                </SeedInputShell>
                <SeedActionButton
                  label="문자 인증번호 받기"
                  variant="neutralSolid"
                  loading={busy === "PHONE"}
                  disabled={unavailable || !phoneProviderAvailable}
                  onPress={() => void sendOtp()}
                  style={styles.otpButton}
                />
              </>
            ) : (
              <>
                <View style={styles.phoneSummaryRow}>
                  <View style={styles.phoneOtpLabel}>
                    <Text style={styles.fieldLabel}>인증번호</Text>
                    <Text numberOfLines={1} style={styles.verifiedPhone}>{verifiedPhone}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="휴대폰 번호 변경"
                    accessibilityState={{ disabled: busy !== null }}
                    disabled={busy !== null}
                    onPress={() => {
                      void clearPendingPhoneOtp();
                      setPhoneStep("NUMBER");
                      setOtp("");
                      setOtpExpiresAt(null);
                      setResendAvailableAt(null);
                      setMessage("");
                    }}
                    style={({ pressed }) => [styles.changePhoneButton, pressed && styles.pressed, busy !== null && styles.disabled]}
                  >
                    <Text style={styles.changePhone}>번호 변경</Text>
                  </Pressable>
                </View>
                <SeedInputShell focused={otpFocused}>
                  <TextInput
                    accessibilityLabel="문자 인증번호"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    value={otp}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    onFocus={() => setOtpFocused(true)}
                    onBlur={() => setOtpFocused(false)}
                    placeholder="6자리 입력"
                    placeholderTextColor={seed.color.foreground.muted}
                    maxLength={6}
                    style={styles.input}
                  />
                </SeedInputShell>
                <View style={styles.otpStatusRow}>
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.otpTimer, otpExpired && styles.otpTimerExpired]}
                  >
                    {otpExpired ? "인증번호가 만료됐어요." : `남은 시간 ${formatCountdown(otpSeconds)}`}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={resendSeconds > 0 ? `인증번호 재전송, ${resendSeconds}초 후 가능` : "인증번호 재전송"}
                    accessibilityState={{ disabled: unavailable || !phoneProviderAvailable || resendSeconds > 0 }}
                    disabled={unavailable || !phoneProviderAvailable || resendSeconds > 0}
                    onPress={() => void sendOtp(verifiedPhone)}
                    style={({ pressed }) => [styles.resendButton, pressed && styles.pressed, (unavailable || resendSeconds > 0) && styles.disabled]}
                  >
                    <Text style={styles.resendLabel}>{resendSeconds > 0 ? `재전송 ${resendSeconds}초` : "인증번호 재전송"}</Text>
                  </Pressable>
                </View>
                <SeedActionButton
                  label="휴대폰으로 로그인"
                  loading={busy === "PHONE"}
                  disabled={unavailable || !phoneProviderAvailable || otpExpired || otp.length !== 6}
                  onPress={() => void loginPhone()}
                  style={styles.otpButton}
                />
              </>
              ))}

              {__DEV__ && internalSessionState === "failed" ? (
                <View style={styles.sessionRecovery}>
                  <SeedActionButton
                    label="로그인 다시 시도"
                    variant="neutralSolid"
                    loading={busy === "SESSION_RECOVERY"}
                    disabled={busy !== null}
                    onPress={() => void retryInternalSession()}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {storeReviewEnabled ? (
            <View style={styles.storeReview}>
              {reviewFormOpen ? (
                <>
                  <Text style={styles.fieldLabel}>심사용 아이디</Text>
                  <SeedInputShell focused={reviewEmailFocused}>
                    <TextInput
                      accessibilityLabel="심사용 아이디"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      keyboardType="email-address"
                      textContentType="username"
                      value={reviewEmail}
                      onChangeText={setReviewEmail}
                      onFocus={() => setReviewEmailFocused(true)}
                      onBlur={() => setReviewEmailFocused(false)}
                      placeholder="이메일"
                      placeholderTextColor={seed.color.foreground.muted}
                      maxLength={254}
                      style={styles.input}
                    />
                  </SeedInputShell>
                  <Text style={[styles.fieldLabel, styles.storeReviewFieldGap]}>비밀번호</Text>
                  <SeedInputShell focused={reviewPasswordFocused}>
                    <TextInput
                      accessibilityLabel="심사용 비밀번호"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="password"
                      secureTextEntry
                      textContentType="password"
                      value={reviewPassword}
                      onChangeText={setReviewPassword}
                      onFocus={() => setReviewPasswordFocused(true)}
                      onBlur={() => setReviewPasswordFocused(false)}
                      maxLength={256}
                      style={styles.input}
                    />
                  </SeedInputShell>
                  <SeedActionButton
                    label="심사용 계정으로 로그인"
                    variant="neutralSolid"
                    loading={busy === "STORE_REVIEW"}
                    disabled={unavailable || !reviewEmail.trim() || !reviewPassword}
                    onPress={() => void loginReviewer()}
                    style={styles.storeReviewSubmit}
                  />
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy !== null }}
                  disabled={busy !== null}
                  onPress={() => setReviewFormOpen(true)}
                  style={({ pressed }) => [styles.storeReviewToggle, pressed && styles.pressed]}
                >
                  <Text style={styles.storeReviewToggleLabel}>앱 심사용 계정으로 로그인</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          <View style={styles.legalLinks}>
            <PolicyAcceptanceRow
              label="[필수] 만 14세 이상입니다"
              checked={ageConfirmed}
              onToggle={() => setAgeConfirmed((value) => !value)}
            />
            <PolicyAcceptanceRow
              label="[필수] 서비스 이용약관 동의"
              checked={termsAccepted}
              onToggle={() => setTermsAccepted((value) => !value)}
              onOpen={() => openCurrentPolicy("terms")}
            />
            <PolicyAcceptanceRow
              label="[필수] 개인정보처리방침 동의"
              checked={privacyAccepted}
              onToggle={() => setPrivacyAccepted((value) => !value)}
              onOpen={() => openCurrentPolicy("privacy")}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PolicyAcceptanceRow({
  label,
  checked,
  onToggle,
  onOpen,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  return (
    <View style={styles.requiredPolicyRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={onToggle}
        style={({ pressed }) => [styles.requiredPolicyToggle, pressed && styles.pressed]}
      >
        <View style={[styles.requiredPolicyCheck, checked && styles.requiredPolicyCheckSelected]}>
          {checked ? <DecorativeIonicon accessible={false} name="checkmark" size={16} color={colors.white} /> : null}
        </View>
        <Text style={styles.legalNotice}>{label}</Text>
      </Pressable>
      {onOpen ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${label.replace(" 동의", "")} 보기`}
          onPress={onOpen}
          style={({ pressed }) => [styles.legalLinkTarget, pressed && styles.pressed]}
        >
          <Text style={styles.legalLink}>보기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProviderButton({
  label,
  mark,
  icon,
  backgroundColor,
  foregroundColor,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  mark?: string;
  icon?: DecorativeIoniconName;
  backgroundColor: string;
  foregroundColor: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerButton,
        { backgroundColor },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foregroundColor} />
      ) : icon ? (
        <View style={styles.providerMark}><DecorativeIonicon name={icon} size={20} color={foregroundColor} /></View>
      ) : (
        <Text variant="subtitle" style={[styles.providerMarkText, { color: foregroundColor }]}>{mark}</Text>
      )}
      <Text style={[styles.providerLabel, { color: foregroundColor }]}>{label}</Text>
      <View style={styles.providerSpacer} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  content: { flexGrow: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: 44, paddingBottom: 36 },
  wordmark: { width: 138, height: 20, alignSelf: "center" },
  title: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "900", textAlign: "center", marginTop: 32 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  actions: { width: "100%", maxWidth: 480, alignSelf: "center", marginTop: 42, gap: 12 },
  actionsAfterRetry: { marginTop: seed.spacing.x4 },
  providerButton: { minHeight: 54, borderRadius: seed.radius.r3, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  providerMark: { width: 24, alignItems: "center", justifyContent: "center" },
  providerMarkText: { width: 24, fontWeight: "900", textAlign: "center" },
  providerLabel: { fontSize: 15, fontWeight: "700" },
  providerSpacer: { width: 24 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  dividerLabel: { color: colors.muted, fontSize: 11 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  input: { flex: 1, minHeight: 48, color: colors.ink, fontSize: 15, paddingVertical: 0 },
  otpButton: { marginTop: 2 },
  sessionRecovery: {
    marginTop: 12,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
  },
  phoneSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  phoneOtpLabel: { flex: 1, minWidth: 0, marginRight: 12 },
  verifiedPhone: { color: colors.muted, ...seed.typography.finePrint, marginTop: 3 },
  changePhoneButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2, alignItems: "center", justifyContent: "center" },
  changePhone: { color: colors.greenInk, fontSize: 12, fontWeight: "700" },
  otpStatusRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  otpTimer: { flex: 1, color: colors.muted, ...seed.typography.finePrint },
  otpTimerExpired: { color: seed.color.foreground.critical, fontWeight: "700" },
  resendButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2, alignItems: "center", justifyContent: "center" },
  resendLabel: { color: colors.greenInk, fontSize: 12, fontWeight: "700" },
  status: { marginTop: 24 },
  message: { color: seed.color.foreground.critical, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 20 },
  connectionRetry: { alignSelf: "center", marginTop: seed.spacing.x3 },
  storeReview: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    marginTop: 28,
    paddingTop: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
  },
  storeReviewFieldGap: { marginTop: 4 },
  storeReviewSubmit: { marginTop: 4 },
  storeReviewToggle: { minHeight: seed.size.touchTarget, alignSelf: "center", alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x2 },
  storeReviewToggleLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  legalLinks: { alignItems: "center", marginTop: 28, paddingHorizontal: seed.spacing.x3 },
  requiredPolicyRow: { width: "100%", minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  requiredPolicyToggle: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  requiredPolicyCheck: { width: 24, height: 24, borderRadius: seed.radius.r1_5, borderWidth: 1, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  requiredPolicyCheckSelected: { borderColor: colors.greenInk, backgroundColor: colors.greenInk },
  legalNotice: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  legalLinkTarget: { minWidth: seed.size.touchTarget, minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x2 },
  legalLink: { color: colors.ink, fontSize: 11, fontWeight: "700", textDecorationLine: "underline" },
  policyAvailabilityStatus: { marginTop: seed.spacing.x3, color: colors.muted, ...seed.typography.caption, textAlign: "center" },
  policyAvailabilityError: { marginTop: seed.spacing.x3, color: seed.color.foreground.critical, ...seed.typography.caption, textAlign: "center" },
});
