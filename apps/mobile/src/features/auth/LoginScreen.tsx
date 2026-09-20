import Constants from "expo-constants";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DecorativeIonicon, type DecorativeIoniconName } from "@/components/DecorativeIonicon";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  completeSocialCustomerLogin,
  exchangeBrokerSession,
  fetchAuthProviderAvailability,
} from "@/features/auth/auth-api";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { resolveAfterLoginPath } from "@/features/auth/login-navigation";
import { ensureInternalCustomerSession } from "@/features/demo/demo-api";
import {
  beginSocialLogin,
  clearPendingEmailOtp,
  clearBrokerSession,
  EMAIL_OTP_TTL_MS,
  readPendingEmailOtp,
  requestEmailOtp,
  resolveSupabaseBrokerConfig,
  verifyEmailOtp,
  type DabbobaLoginProvider,
  type DabbobaSocialLoginProvider,
  type PendingEmailOtp,
} from "@/features/auth/supabase-broker";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/brand/dabboba-wordmark.png");

type EmailStep = "ADDRESS" | "OTP";
type LoginMethod = DabbobaLoginProvider | "SESSION_RECOVERY";
type InternalSessionState = "checking" | "unavailable" | "failed";

export function LoginScreen() {
  const { requiredPolicyVersions, configReady } = useCommerceCapability();
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
  const [busy, setBusy] = useState<LoginMethod | null>(null);
  const [message, setMessage] = useState("");
  const [emailStep, setEmailStep] = useState<EmailStep>("ADDRESS");
  const [emailInput, setEmailInput] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [emailFocused, setEmailFocused] = useState(false);
  const [otpFocused, setOtpFocused] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [internalSessionState, setInternalSessionState] = useState<InternalSessionState>(
    __DEV__ ? "checking" : "unavailable",
  );

  const applyPendingEmailOtp = (pending: PendingEmailOtp) => {
    setEmailInput(pending.email);
    setVerifiedEmail(pending.email);
    setOtpExpiresAt(pending.expiresAt);
    setResendAvailableAt(pending.resendAvailableAt);
    setEmailStep("OTP");
    setOtp("");
    setClockMs(Date.now());
  };

  useEffect(() => {
    let active = true;
    void readPendingEmailOtp().then((pending) => {
      if (active && pending) applyPendingEmailOtp(pending);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (emailStep !== "OTP" || otpExpiresAt === null) return undefined;
    setClockMs(Date.now());
    const timer = setInterval(() => setClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [emailStep, otpExpiresAt]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const localConfigured = Boolean(resolveSupabaseBrokerConfig());
        const availability = await fetchAuthProviderAvailability(runtime.apiBaseUrl);
        if (active) {
          const ready = localConfigured && availability.brokerExchangeConfigured;
          setEnabledProviders(availability.methods);
          setBrokerReady(ready);
          if (!ready || availability.methods.length === 0) {
            setMessage("사용 가능한 로그인 방식이 아직 설정되지 않았습니다.");
          }
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "로그인 연결 상태를 확인하지 못했습니다.");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    void ensureInternalCustomerSession(runtime.apiBaseUrl, () => active)
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
        setMessage("로그인 정보를 자동으로 불러오지 못했습니다. 다시 시도해 주세요.");
      });
    return () => {
      active = false;
    };
  }, [returnPath, runtime.apiBaseUrl]);

  const finish = async (supabaseAccessToken: string) => {
    if (!requiredPolicyVersions || !termsAccepted || !privacyAccepted) {
      throw new Error("필수 약관을 각각 확인하고 동의해 주세요.");
    }
    let exchanged = false;
    try {
      await exchangeBrokerSession(runtime.apiBaseUrl, supabaseAccessToken, requiredPolicyVersions, "EMAIL");
      exchanged = true;
    } finally {
      await clearBrokerSession();
    }
    if (exchanged) router.replace(returnPath);
  };

  const loginSocial = async (provider: DabbobaSocialLoginProvider) => {
    if (!requiredPolicyVersions || !termsAccepted || !privacyAccepted) {
      setMessage("필수 약관을 각각 확인하고 동의해 주세요.");
      return;
    }
    setBusy(provider);
    setMessage("");
    try {
      const callbackUrl = await beginSocialLogin(provider, String(returnPath), requiredPolicyVersions);
      const completedReturnTo = await completeSocialCustomerLogin(runtime.apiBaseUrl, callbackUrl);
      router.replace(completedReturnTo as Href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인을 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const sendOtp = async (address = emailInput) => {
    setBusy("EMAIL");
    setMessage("");
    try {
      applyPendingEmailOtp(await requestEmailOtp(address));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증번호를 보내지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const loginEmail = async () => {
    setBusy("EMAIL");
    setMessage("");
    try {
      await finish(await verifyEmailOtp(verifiedEmail, otp));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이메일 로그인을 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const retryInternalSession = async () => {
    setBusy("SESSION_RECOVERY");
    setMessage("");
    try {
      const tokens = await ensureInternalCustomerSession(runtime.apiBaseUrl);
      if (!tokens) {
        setInternalSessionState("unavailable");
        return;
      }
      router.replace(returnPath);
    } catch {
      setInternalSessionState("failed");
      setMessage("로그인 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
    || !privacyAccepted;
  const providerAvailable = (provider: DabbobaLoginProvider) => (
    brokerReady && enabledProviders.includes(provider)
  );
  const otpExpired = otpExpiresAt !== null && clockMs >= otpExpiresAt;
  const resendSeconds = resendAvailableAt === null
    ? 0
    : Math.max(0, Math.ceil((resendAvailableAt - clockMs) / 1_000));
  const otpSeconds = otpExpiresAt === null
    ? Math.floor(EMAIL_OTP_TTL_MS / 1_000)
    : Math.max(0, Math.ceil((otpExpiresAt - clockMs) / 1_000));

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <DetailPageHeader
          title="로그인"
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
        />

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Image accessibilityLabel="DABBOBA" source={WORDMARK} resizeMode="contain" style={styles.wordmark} />
          <Text style={styles.title}>다뽀바를 계속 즐겨보세요</Text>
          <Text style={styles.subtitle}>관심 상품과 계정 정보를 안전하게 저장해요.</Text>

          <View style={styles.actions}>
            <ProviderButton
              label="카카오로 계속하기"
              mark="K"
              backgroundColor="#FEE500"
              foregroundColor="#191919"
              loading={busy === "KAKAO"}
              disabled={unavailable || !providerAvailable("KAKAO")}
              onPress={() => void loginSocial("KAKAO")}
            />
            <ProviderButton
              label="네이버로 계속하기"
              mark="N"
              backgroundColor="#03C75A"
              foregroundColor="#FFFFFF"
              loading={busy === "NAVER"}
              disabled={unavailable || !providerAvailable("NAVER")}
              onPress={() => void loginSocial("NAVER")}
            />
            <ProviderButton
              label="구글로 계속하기"
              icon="logo-google"
              backgroundColor="#FFFFFF"
              foregroundColor="#202124"
              loading={busy === "GOOGLE"}
              disabled={unavailable || !providerAvailable("GOOGLE")}
              onPress={() => void loginSocial("GOOGLE")}
            />
            <ProviderButton
              label="애플로 계속하기"
              icon="logo-apple"
              backgroundColor="#111111"
              foregroundColor="#FFFFFF"
              loading={busy === "APPLE"}
              disabled={unavailable || !providerAvailable("APPLE")}
              onPress={() => void loginSocial("APPLE")}
            />

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerLabel}>또는</Text>
              <View style={styles.divider} />
            </View>

            {emailStep === "ADDRESS" ? (
              <>
                <Text style={styles.fieldLabel}>이메일</Text>
                <SeedInputShell focused={emailFocused}>
                  <TextInput
                    accessibilityLabel="이메일 주소"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    value={emailInput}
                    onChangeText={setEmailInput}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    placeholder="name@example.com"
                    placeholderTextColor={seed.color.foreground.muted}
                    maxLength={254}
                    style={styles.input}
                  />
                </SeedInputShell>
                <SeedActionButton
                  label="이메일 인증번호 받기"
                  variant="neutralSolid"
                  loading={busy === "EMAIL"}
                  disabled={unavailable || !providerAvailable("EMAIL")}
                  onPress={() => void sendOtp()}
                  style={styles.emailButton}
                />
              </>
            ) : (
              <>
                <View style={styles.emailSummaryRow}>
                  <View style={styles.emailOtpLabel}>
                    <Text style={styles.fieldLabel}>인증번호</Text>
                    <Text numberOfLines={1} style={styles.verifiedEmail}>{verifiedEmail}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="이메일 주소 변경"
                    accessibilityState={{ disabled: busy !== null }}
                    disabled={busy !== null}
                    onPress={() => {
                      void clearPendingEmailOtp();
                      setEmailStep("ADDRESS");
                      setOtp("");
                      setOtpExpiresAt(null);
                      setResendAvailableAt(null);
                      setMessage("");
                    }}
                    style={({ pressed }) => [styles.changeEmailButton, pressed && styles.pressed, busy !== null && styles.disabled]}
                  >
                    <Text style={styles.changeEmail}>이메일 변경</Text>
                  </Pressable>
                </View>
                <SeedInputShell focused={otpFocused}>
                  <TextInput
                    accessibilityLabel="이메일 인증번호"
                    keyboardType="number-pad"
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
                    accessibilityState={{ disabled: unavailable || !providerAvailable("EMAIL") || resendSeconds > 0 }}
                    disabled={unavailable || !providerAvailable("EMAIL") || resendSeconds > 0}
                    onPress={() => void sendOtp(verifiedEmail)}
                    style={({ pressed }) => [styles.resendButton, pressed && styles.pressed, (unavailable || resendSeconds > 0) && styles.disabled]}
                  >
                    <Text style={styles.resendLabel}>{resendSeconds > 0 ? `재전송 ${resendSeconds}초` : "인증번호 재전송"}</Text>
                  </Pressable>
                </View>
                <SeedActionButton
                  label="이메일로 로그인"
                  loading={busy === "EMAIL"}
                  disabled={unavailable || !providerAvailable("EMAIL") || otpExpired || otp.length !== 6}
                  onPress={() => void loginEmail()}
                  style={styles.emailButton}
                />
              </>
            )}

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

          {checking ? <ActivityIndicator color={colors.ink} style={styles.status} /> : null}
          {!checking && !brokerReady && !message ? (
            <Text accessibilityRole="alert" style={styles.message}>로그인 서비스 연결 정보가 아직 설정되지 않았습니다.</Text>
          ) : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          <View style={styles.legalLinks}>
            <PolicyAcceptanceRow
              label="[필수] 서비스 이용약관 동의"
              checked={termsAccepted}
              onToggle={() => setTermsAccepted((value) => !value)}
              onOpen={() => router.push("/legal/terms" as Href)}
            />
            <PolicyAcceptanceRow
              label="[필수] 개인정보처리방침 동의"
              checked={privacyAccepted}
              onToggle={() => setPrivacyAccepted((value) => !value)}
              onOpen={() => router.push("/legal/privacy" as Href)}
            />
            {!configReady ? <Text style={styles.legalStatus}>현재 약관 버전을 확인하고 있어요.</Text> : null}
            {configReady && !requiredPolicyVersions ? <Text accessibilityRole="alert" style={styles.legalStatus}>약관 정보를 확인할 수 없어 로그인을 잠시 이용할 수 없어요.</Text> : null}
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
  onOpen: () => void;
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
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${label.replace(" 동의", "")} 보기`}
        onPress={onOpen}
        style={({ pressed }) => [styles.legalLinkTarget, pressed && styles.pressed]}
      >
        <Text style={styles.legalLink}>보기</Text>
      </Pressable>
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
        <Text style={[styles.providerMarkText, { color: foregroundColor }]}>{mark}</Text>
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
  providerButton: { minHeight: 54, borderRadius: seed.radius.r3, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  providerMark: { width: 24, alignItems: "center", justifyContent: "center" },
  providerMarkText: { width: 24, fontSize: 17, fontWeight: "900", textAlign: "center" },
  providerLabel: { fontSize: 15, fontWeight: "700" },
  providerSpacer: { width: 24 },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ translateY: seed.state.pressedTranslateY }, { scale: seed.state.pressedScale }] },
  disabled: { opacity: seed.state.disabledOpacity },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  dividerLabel: { color: colors.muted, fontSize: 11 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  input: { flex: 1, minHeight: 48, color: colors.ink, fontSize: 15, paddingVertical: 0 },
  emailButton: { marginTop: 2 },
  sessionRecovery: {
    marginTop: 12,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
  },
  emailSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  emailOtpLabel: { flex: 1, minWidth: 0, marginRight: 12 },
  verifiedEmail: { color: colors.muted, ...seed.typography.finePrint, marginTop: 3 },
  changeEmailButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2, alignItems: "center", justifyContent: "center" },
  changeEmail: { color: colors.greenInk, fontSize: 12, fontWeight: "700" },
  otpStatusRow: { minHeight: seed.size.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  otpTimer: { flex: 1, color: colors.muted, ...seed.typography.finePrint },
  otpTimerExpired: { color: seed.color.foreground.critical, fontWeight: "700" },
  resendButton: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x2, alignItems: "center", justifyContent: "center" },
  resendLabel: { color: colors.greenInk, fontSize: 12, fontWeight: "700" },
  status: { marginTop: 24 },
  message: { color: seed.color.foreground.critical, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 20 },
  legalLinks: { alignItems: "center", marginTop: 28, paddingHorizontal: seed.spacing.x3 },
  requiredPolicyRow: { width: "100%", minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2 },
  requiredPolicyToggle: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  requiredPolicyCheck: { width: 24, height: 24, borderRadius: seed.radius.r1_5, borderWidth: 1, borderColor: seed.color.stroke.contrast, alignItems: "center", justifyContent: "center" },
  requiredPolicyCheckSelected: { borderColor: colors.greenInk, backgroundColor: colors.greenInk },
  legalNotice: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  legalLinkTarget: { minWidth: seed.size.touchTarget, minHeight: seed.size.touchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: seed.spacing.x2 },
  legalLink: { color: colors.ink, fontSize: 11, fontWeight: "700", textDecorationLine: "underline" },
  legalStatus: { marginTop: seed.spacing.x1, color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
});
