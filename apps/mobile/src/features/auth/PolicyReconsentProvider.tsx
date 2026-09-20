import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ReadablePageTitle } from "@/components/RootCategoryTitle";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import {
  registerPolicyReconsentHandler,
  type PolicyReconsentChallenge,
  type RequiredPolicyVersions,
} from "@/features/auth/policy-reconsent";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import { colors } from "@/theme";

const TERMS_URL = process.env.EXPO_PUBLIC_DABBOBA_TERMS_URL?.trim() || "https://dabboba.com/terms";
const PRIVACY_URL = process.env.EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL?.trim() || "https://dabboba.com/privacy";

type PendingConsent = {
  challenge: PolicyReconsentChallenge;
  resolve: (accepted: boolean) => void;
};

export function PolicyReconsentProvider({ children }: { children: ReactNode }) {
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
  const pendingRef = useRef<PendingConsent | null>(null);
  const [pending, setPending] = useState<PendingConsent | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unregister = registerPolicyReconsentHandler((challenge) => new Promise<boolean>((resolve) => {
      const next = { challenge, resolve };
      pendingRef.current = next;
      setPending(next);
      setTermsAccepted(false);
      setPrivacyAccepted(false);
      setSubmitting(false);
      setError("");
    }));
    return () => {
      unregister();
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  const settle = (accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    setSubmitting(false);
    setError("");
    current?.resolve(accepted);
  };

  const submit = async () => {
    if (!pending || submitting || !termsAccepted || !privacyAccepted) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await acceptCurrentPolicies(
        runtime.apiBaseUrl,
        pending.challenge.accessToken,
        pending.challenge.requiredPolicyVersions,
      );
      if (result.accepted) {
        settle(true);
        return;
      }
      if (result.requiredPolicyVersions) {
        const next: PendingConsent = {
          ...pending,
          challenge: {
            ...pending.challenge,
            requiredPolicyVersions: result.requiredPolicyVersions,
          },
        };
        pendingRef.current = next;
        setPending(next);
        setTermsAccepted(false);
        setPrivacyAccepted(false);
        setError("약관 버전이 변경됐어요. 두 문서를 다시 확인하고 동의해 주세요.");
        return;
      }
      setError(result.message || "약관 동의를 저장하지 못했습니다. 다시 시도해 주세요.");
    } catch {
      setError("약관 동의를 저장하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {children}
      <Modal
        animationType="fade"
        transparent
        visible={pending !== null}
        onRequestClose={() => settle(false)}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={styles.sheet}
          >
            <ScrollView contentContainerStyle={styles.content}>
              <ReadablePageTitle variant="subtitle">새 약관 확인이 필요해요</ReadablePageTitle>
              <Text style={styles.body}>
                계속 이용하려면 변경된 이용약관과 개인정보처리방침을 각각 확인하고 동의해 주세요.
              </Text>
              {pending ? (
                <>
                  <PolicyConsentRow
                    checked={termsAccepted}
                    label={`이용약관 (${pending.challenge.requiredPolicyVersions.terms})`}
                    link={TERMS_URL}
                    onToggle={() => setTermsAccepted((value) => !value)}
                    onLinkError={() => setError("이용약관 링크를 열지 못했습니다.")}
                  />
                  <PolicyConsentRow
                    checked={privacyAccepted}
                    label={`개인정보처리방침 (${pending.challenge.requiredPolicyVersions.privacy})`}
                    link={PRIVACY_URL}
                    onToggle={() => setPrivacyAccepted((value) => !value)}
                    onLinkError={() => setError("개인정보처리방침 링크를 열지 못했습니다.")}
                  />
                </>
              ) : null}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <SeedActionButton
                  label="나중에"
                  variant="neutralOutline"
                  disabled={submitting}
                  onPress={() => settle(false)}
                  style={styles.secondaryAction}
                />
                <SeedActionButton
                  label="동의하고 계속"
                  loading={submitting}
                  disabled={!termsAccepted || !privacyAccepted}
                  onPress={() => void submit()}
                  style={styles.primaryAction}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function PolicyConsentRow({
  checked,
  label,
  link,
  onToggle,
  onLinkError,
}: {
  checked: boolean;
  label: string;
  link: string;
  onToggle: () => void;
  onLinkError: () => void;
}) {
  return (
    <View style={styles.policyRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${label} 동의`}
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={styles.checkboxAction}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          <Text style={[styles.checkmark, checked && styles.checkmarkChecked]}>✓</Text>
        </View>
        <Text style={styles.policyLabel}>{label}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${label} 전문 보기`}
        hitSlop={8}
        onPress={() => void Linking.openURL(link).catch(onLinkError)}
        style={styles.linkAction}
      >
        <Text style={styles.linkLabel}>전문 보기</Text>
      </Pressable>
    </View>
  );
}

async function acceptCurrentPolicies(
  apiBaseUrl: string,
  accessToken: string,
  versions: RequiredPolicyVersions,
): Promise<{
  accepted: boolean;
  requiredPolicyVersions?: RequiredPolicyVersions;
  message?: string;
}> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/account/policy-acceptances`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-request-id": randomUUID(),
    },
    body: JSON.stringify({ acceptedPolicies: versions }),
  });
  if (response.status === 204) return { accepted: true };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A safe local fallback is used below.
  }
  const envelope = body && typeof body === "object" && !Array.isArray(body)
    ? body as { error?: { message?: unknown; details?: unknown } }
    : null;
  if (response.status === 428) {
    const required = parseVersions(envelope?.error?.details);
    if (required) return { accepted: false, requiredPolicyVersions: required };
  }
  return {
    accepted: false,
    message: typeof envelope?.error?.message === "string" ? envelope.error.message : undefined,
  };
}

function parseVersions(value: unknown): RequiredPolicyVersions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nested = "requiredPolicyVersions" in value
    ? (value as { requiredPolicyVersions?: unknown }).requiredPolicyVersions
    : value;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  const candidate = nested as Record<string, unknown>;
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  return typeof candidate.terms === "string"
    && typeof candidate.privacy === "string"
    && pattern.test(candidate.terms)
    && pattern.test(candidate.privacy)
    ? { terms: candidate.terms, privacy: candidate.privacy }
    : null;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: seed.spacing.globalGutter,
    backgroundColor: "rgba(16, 20, 17, 0.48)",
  },
  sheet: {
    maxHeight: "88%",
    overflow: "hidden",
    borderRadius: seed.radius.r5,
    backgroundColor: seed.color.layer.elevated,
  },
  content: { padding: seed.spacing.x5, paddingBottom: seed.spacing.x6 },
  body: { color: colors.muted, ...seed.typography.body, marginTop: seed.spacing.x2, marginBottom: seed.spacing.x3 },
  policyRow: {
    minHeight: 64,
    marginTop: seed.spacing.x2,
    paddingHorizontal: seed.spacing.x3,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    borderRadius: seed.radius.r3,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  checkboxAction: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: seed.color.stroke.contrast,
    borderRadius: seed.radius.r1_5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { borderColor: colors.greenInk, backgroundColor: colors.greenInk },
  checkmark: { color: "transparent", fontSize: 15, fontWeight: "900" },
  checkmarkChecked: { color: seed.color.foreground.onBrand },
  policyLabel: { flex: 1, color: colors.ink, ...seed.typography.caption, fontWeight: "700" },
  linkAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: seed.spacing.x1 },
  linkLabel: { color: colors.greenInk, ...seed.typography.caption, fontWeight: "800", textDecorationLine: "underline" },
  error: { color: seed.color.foreground.critical, ...seed.typography.caption, marginTop: seed.spacing.x3 },
  actions: { flexDirection: "row", gap: seed.spacing.x2, marginTop: seed.spacing.x5 },
  secondaryAction: { flex: 1 },
  primaryAction: { flex: 1.6 },
});
