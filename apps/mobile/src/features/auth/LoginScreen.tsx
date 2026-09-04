import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
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
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { exchangeBrokerSession, fetchAuthProviderAvailability } from "@/features/auth/auth-api";
import { resolveAfterLoginPath } from "@/features/auth/login-navigation";
import {
  beginSocialLogin,
  clearBrokerSession,
  requestPhoneOtp,
  resolveSupabaseBrokerConfig,
  verifyPhoneOtp,
  type DabbobaLoginProvider,
} from "@/features/auth/supabase-broker";
import { ensureDevelopmentAuthSession } from "@/lib/development-session";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { colors } from "@/theme";

const WORDMARK = require("../../../assets/dabboba-wordmark.png");

type PhoneStep = "NUMBER" | "OTP";
type LoginMethod = DabbobaLoginProvider | "DEVELOPMENT";

export function LoginScreen() {
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
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
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<LoginMethod | null>(null);
  const [message, setMessage] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("NUMBER");
  const [phoneInput, setPhoneInput] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [otp, setOtp] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const localConfigured = Boolean(resolveSupabaseBrokerConfig());
        const availability = await fetchAuthProviderAvailability(runtime.apiBaseUrl);
        if (active) {
          const allApprovedMethodsAvailable = ["KAKAO", "NAVER", "PHONE"].every((method) => (
            availability.methods.includes(method as (typeof availability.methods)[number])
          ));
          setBrokerReady(localConfigured && availability.brokerExchangeConfigured && allApprovedMethodsAvailable);
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

  const finish = async (supabaseAccessToken: string) => {
    let exchanged = false;
    try {
      await exchangeBrokerSession(runtime.apiBaseUrl, supabaseAccessToken);
      exchanged = true;
    } finally {
      await clearBrokerSession();
    }
    if (exchanged) router.replace(resolveAfterLoginPath(params.returnTo));
  };

  const loginSocial = async (provider: "KAKAO" | "NAVER") => {
    setBusy(provider);
    setMessage("");
    try {
      await finish(await beginSocialLogin(provider));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인을 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const sendOtp = async () => {
    setBusy("PHONE");
    setMessage("");
    try {
      const phone = await requestPhoneOtp(phoneInput);
      setVerifiedPhone(phone);
      setPhoneStep("OTP");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증번호를 보내지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const loginPhone = async () => {
    setBusy("PHONE");
    setMessage("");
    try {
      await finish(await verifyPhoneOtp(verifiedPhone, otp));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "휴대폰 로그인을 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const loginDevelopment = async () => {
    setBusy("DEVELOPMENT");
    setMessage("");
    try {
      await ensureDevelopmentAuthSession(runtime.apiBaseUrl);
      router.replace(resolveAfterLoginPath(params.returnTo));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "테스트 로그인을 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const unavailable = checking || !brokerReady || busy !== null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={27} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>로그인</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Image accessibilityLabel="DABBOBA" source={WORDMARK} resizeMode="contain" style={styles.wordmark} />
          <Text style={styles.title}>다뽀바를 계속 즐겨보세요</Text>
          <Text style={styles.subtitle}>주문과 뽑기 결과를 내 계정에 안전하게 저장해요.</Text>

          <View style={styles.actions}>
            <ProviderButton
              label="카카오로 계속하기"
              mark="K"
              backgroundColor="#FEE500"
              foregroundColor="#191919"
              loading={busy === "KAKAO"}
              disabled={unavailable}
              onPress={() => void loginSocial("KAKAO")}
            />
            <ProviderButton
              label="네이버로 계속하기"
              mark="N"
              backgroundColor="#03C75A"
              foregroundColor="#FFFFFF"
              loading={busy === "NAVER"}
              disabled={unavailable}
              onPress={() => void loginSocial("NAVER")}
            />

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerLabel}>또는</Text>
              <View style={styles.divider} />
            </View>

            {phoneStep === "NUMBER" ? (
              <>
                <Text style={styles.fieldLabel}>휴대폰번호</Text>
                <SeedInputShell>
                  <TextInput
                    accessibilityLabel="휴대폰번호"
                    keyboardType="phone-pad"
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    placeholder="01012345678"
                    placeholderTextColor={seed.color.foreground.muted}
                    maxLength={13}
                    style={styles.input}
                  />
                </SeedInputShell>
                <SeedActionButton
                  label="인증번호 받기"
                  variant="neutralSolid"
                  loading={busy === "PHONE"}
                  disabled={unavailable}
                  onPress={() => void sendOtp()}
                  style={styles.phoneButton}
                />
              </>
            ) : (
              <>
                <View style={styles.phoneSummaryRow}>
                  <Text style={styles.fieldLabel}>인증번호</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setPhoneStep("NUMBER");
                      setOtp("");
                      setMessage("");
                    }}
                  >
                    <Text style={styles.changePhone}>번호 변경</Text>
                  </Pressable>
                </View>
                <SeedInputShell>
                  <TextInput
                    accessibilityLabel="문자 인증번호"
                    keyboardType="number-pad"
                    value={otp}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6자리 입력"
                    placeholderTextColor={seed.color.foreground.muted}
                    maxLength={6}
                    style={styles.input}
                  />
                </SeedInputShell>
                <SeedActionButton
                  label="휴대폰번호로 로그인"
                  loading={busy === "PHONE"}
                  disabled={unavailable || otp.length !== 6}
                  onPress={() => void loginPhone()}
                  style={styles.phoneButton}
                />
              </>
            )}

            {__DEV__ ? (
              <View style={styles.developmentLogin}>
                <SeedActionButton
                  label="테스트 계정으로 로그인"
                  variant="neutralSolid"
                  loading={busy === "DEVELOPMENT"}
                  disabled={busy !== null}
                  onPress={() => void loginDevelopment()}
                />
                <Text style={styles.developmentHint}>개발 빌드에서만 사용할 수 있어요.</Text>
              </View>
            ) : null}
          </View>

          {checking ? <ActivityIndicator color={colors.ink} style={styles.status} /> : null}
          {!checking && !brokerReady && !message ? (
            <Text accessibilityRole="alert" style={styles.message}>로그인 서비스 연결 정보가 아직 설정되지 않았습니다.</Text>
          ) : null}
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProviderButton({
  label,
  mark,
  backgroundColor,
  foregroundColor,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  mark: string;
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
      ) : (
        <Text style={[styles.providerMark, { color: foregroundColor }]}>{mark}</Text>
      )}
      <Text style={[styles.providerLabel, { color: foregroundColor }]}>{label}</Text>
      <View style={styles.providerSpacer} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  header: {
    minHeight: seed.size.topNavigation,
    paddingHorizontal: seed.spacing.globalGutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.neutral,
  },
  backButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  headerSpacer: { width: seed.size.touchTarget },
  content: { flexGrow: 1, paddingHorizontal: seed.spacing.globalGutter, paddingTop: 44, paddingBottom: 36 },
  wordmark: { width: 138, height: 20, alignSelf: "center" },
  title: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "900", textAlign: "center", marginTop: 32 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  actions: { width: "100%", maxWidth: 480, alignSelf: "center", marginTop: 42, gap: 12 },
  providerButton: { minHeight: 54, borderRadius: seed.radius.r3, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  providerMark: { width: 24, fontSize: 17, fontWeight: "900", textAlign: "center" },
  providerLabel: { fontSize: 15, fontWeight: "700" },
  providerSpacer: { width: 24 },
  pressed: { opacity: seed.state.pressedOpacity },
  disabled: { opacity: seed.state.disabledOpacity },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: seed.color.stroke.neutral },
  dividerLabel: { color: colors.muted, fontSize: 11 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  input: { flex: 1, minHeight: 48, color: colors.ink, fontSize: 15, paddingVertical: 0 },
  phoneButton: { marginTop: 2 },
  developmentLogin: {
    marginTop: 12,
    paddingTop: 20,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
  },
  developmentHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  phoneSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  changePhone: { color: colors.greenInk, fontSize: 12, fontWeight: "700" },
  status: { marginTop: 24 },
  message: { color: seed.color.foreground.critical, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 20 },
});
