import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { updateAccountBasicInfo } from "@/features/profile/profile-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

export function AccountBasicInfoEditScreen() {
  const profileState = useProfileSnapshot();
  const basicInfo = profileState.snapshot?.basicInfo;
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!basicInfo) return;
    setNickname(basicInfo.nickname);
    setBirthDate(formatBirthDate(basicInfo.birthDate));
  }, [basicInfo]);

  const save = async () => {
    if (!basicInfo || !profileState.snapshot) return;
    const nextNickname = nickname.trim();
    if (!nextNickname) {
      Alert.alert("닉네임을 입력해 주세요");
      return;
    }

    let nextBirthDate: string | null;
    try {
      nextBirthDate = normalizeBirthDate(birthDate);
    } catch (error) {
      Alert.alert("생년월일을 확인해 주세요", error instanceof Error ? error.message : "YYYY.MM.DD 형식으로 입력해 주세요.");
      return;
    }

    if (profileState.snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 계정 기본정보를 저장할 수 있어요.");
      return;
    }

    try {
      setSaving(true);
      const updated = await updateAccountBasicInfo(
        profileState.runtime.apiBaseUrl,
        profileState.accessToken,
        {
          nickname: nextNickname,
          birthDate: nextBirthDate,
          expectedVersion: basicInfo.version,
        },
      );
      profileState.setSnapshot((current) => current ? {
        ...current,
        actor: current.actor ? { ...current.actor, nickname: updated.nickname } : null,
        basicInfo: updated,
        profile: {
          ...current.profile,
          nickname: updated.nickname,
          version: updated.version,
          updatedAt: updated.updatedAt,
        },
      } : current);
      Alert.alert("계정 기본정보를 저장했어요", undefined, [
        { text: "확인", onPress: () => router.replace("/profile/member/personal") },
      ]);
    } catch (error) {
      Alert.alert("계정 기본정보를 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <Header />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!profileState.snapshot && !profileState.message ? <ActivityIndicator color={colors.ink} style={styles.loading} /> : null}
          {profileState.message ? <Text style={styles.error}>{profileState.message}</Text> : null}
          {basicInfo ? (
            <>
              <Field
                label="닉네임"
                value={nickname}
                onChangeText={(value) => setNickname(value.slice(0, 40))}
                placeholder="닉네임"
              />
              <ReadOnlyField label="이메일" value={basicInfo.email ?? "등록된 이메일 없음"} />
              <ReadOnlyField label="휴대폰" value={basicInfo.phoneMasked ?? "등록된 번호 없음"} />
              <Field
                label="생년월일"
                value={birthDate}
                onChangeText={(value) => setBirthDate(formatBirthDateInput(value))}
                placeholder="1995.03.18"
                keyboardType="number-pad"
                optional
              />
              <Text style={styles.verificationNote}>이메일과 휴대폰은 본인인증 후 변경할 수 있어요.</Text>
              <SeedActionButton
                label={saving ? "저장 중" : "계정 기본정보 저장"}
                loading={saving}
                onPress={() => void save()}
                style={styles.submit}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header() {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="chevron-back" size={25} color={colors.ink} /></Pressable><KoreanPixelTitle variant="header">계정 기본정보 수정</KoreanPixelTitle><View style={styles.headerAction} /></View>;
}

function Field({ label, optional = false, ...inputProps }: { label: string; optional?: boolean } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{optional ? <Text style={styles.optional}>선택</Text> : null}</View><TextInput {...inputProps} placeholderTextColor={colors.muted} style={styles.input} /></View>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>{label}</Text><Text style={styles.verificationBadge}>본인인증 후 변경</Text></View><View style={styles.readOnlyInput}><Text numberOfLines={1} style={styles.readOnlyValue}>{value}</Text><Ionicons name="lock-closed-outline" size={15} color={colors.muted} /></View></View>;
}

function formatBirthDate(value: string | null): string {
  return value ? value.replaceAll("-", ".") : "";
}

function formatBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

function normalizeBirthDate(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 8) throw new Error("YYYY.MM.DD 형식으로 입력해 주세요.");

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const candidate = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("존재하는 날짜를 입력해 주세요.");
  }
  const today = new Date().toISOString().slice(0, 10);
  if (candidate < "1900-01-01" || candidate > today) {
    throw new Error("1900년 이후의 지난 날짜를 입력해 주세요.");
  }
  return candidate;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: seed.color.layer.basement },
  flex: { flex: 1 },
  header: { minHeight: seed.size.topNavigation, paddingHorizontal: seed.spacing.globalGutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: seed.color.stroke.neutral, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerAction: { width: seed.size.touchTarget, height: seed.size.touchTarget, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: seed.spacing.globalGutter, paddingTop: seed.spacing.x3, paddingBottom: seed.spacing.screenBottom },
  loading: { marginTop: seed.spacing.x12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20, padding: seed.spacing.x3, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.criticalWeak },
  field: { marginTop: seed.spacing.x3 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x2, marginBottom: seed.spacing.x2 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  optional: { color: colors.muted, fontSize: 10 },
  verificationBadge: { color: colors.muted, fontSize: 9 },
  input: { minHeight: seed.size.input, paddingHorizontal: seed.spacing.x3_5, borderWidth: 1, borderColor: seed.color.stroke.brand, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, color: colors.ink, fontSize: 14 },
  readOnlyInput: { minHeight: seed.size.input, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: seed.spacing.x3, paddingHorizontal: seed.spacing.x3_5, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.background.neutralWeak },
  readOnlyValue: { flex: 1, color: colors.muted, fontSize: 13 },
  verificationNote: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: seed.spacing.x3 },
  submit: { marginTop: seed.spacing.x5 },
  pressed: { opacity: seed.state.pressedOpacity },
});
