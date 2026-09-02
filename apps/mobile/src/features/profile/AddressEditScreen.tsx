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
import { upsertDefaultShippingAddress } from "@/features/profile/account-detail-api";
import { useProfileSnapshot } from "@/features/profile/use-profile-snapshot";
import { colors } from "@/theme";

export function AddressEditScreen() {
  const profileState = useProfileSnapshot();
  const address = profileState.snapshot?.defaultAddress;
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!address) return;
    setRecipient(address.recipient);
    setPhone(address.phone);
    setPostalCode(address.postalCode);
    setAddressLine1(address.addressLine1);
    setAddressLine2(address.addressLine2 ?? "");
    setDeliveryNote(address.deliveryNote ?? "");
  }, [address]);

  const save = async () => {
    const next = {
      recipient: recipient.trim(),
      phone: phone.trim(),
      postalCode: postalCode.trim(),
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim() || null,
      deliveryNote: deliveryNote.trim() || null,
      ...(address ? { expectedVersion: address.version } : {}),
    };
    if (!next.recipient || !next.phone || !next.postalCode || !next.addressLine1) {
      Alert.alert("필수 정보를 모두 입력해 주세요", "받는 사람, 연락처, 우편번호와 주소가 필요해요.");
      return;
    }
    if (!profileState.snapshot || profileState.snapshot.isExample || !profileState.accessToken) {
      Alert.alert("로그인이 필요해요", "로그인하면 기본 배송지를 등록할 수 있어요.");
      return;
    }
    try {
      setSaving(true);
      const saved = await upsertDefaultShippingAddress(profileState.runtime.apiBaseUrl, profileState.accessToken, next);
      profileState.setSnapshot((current) => current ? { ...current, defaultAddress: saved } : current);
      Alert.alert("기본 배송지를 저장했어요", "다음 배송 신청부터 이 주소가 표시돼요.", [
        { text: "확인", onPress: () => router.replace("/profile/member/address") },
      ]);
    } catch (error) {
      Alert.alert("배송지를 저장하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
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
          {profileState.snapshot ? (
            <>
              <Field label="받는 사람" value={recipient} onChangeText={(value) => setRecipient(value.slice(0, 80))} placeholder="이름" />
              <Field label="연락처" value={phone} onChangeText={(value) => setPhone(value.slice(0, 30))} placeholder="010-0000-0000" keyboardType="phone-pad" />
              <Field label="우편번호" value={postalCode} onChangeText={(value) => setPostalCode(value.slice(0, 20))} placeholder="우편번호" keyboardType="number-pad" />
              <Field label="주소" value={addressLine1} onChangeText={(value) => setAddressLine1(value.slice(0, 240))} placeholder="도로명 또는 지번 주소" />
              <Field label="상세주소" value={addressLine2} onChangeText={(value) => setAddressLine2(value.slice(0, 240))} placeholder="동·호수 등" optional />
              <Field label="배송 메모" value={deliveryNote} onChangeText={(value) => setDeliveryNote(value.slice(0, 300))} placeholder="문 앞에 놓아주세요" optional />
              <SeedActionButton label={saving ? "저장 중" : "배송지 저장"} loading={saving} onPress={() => void save()} style={styles.submit} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header() {
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Ionicons name="chevron-back" size={25} color={colors.ink} /></Pressable><KoreanPixelTitle variant="header">기본 배송지</KoreanPixelTitle><View style={styles.headerAction} /></View>;
}

function Field({ label, optional = false, ...inputProps }: { label: string; optional?: boolean } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{optional ? <Text style={styles.optional}>선택</Text> : null}</View><TextInput {...inputProps} placeholderTextColor={colors.muted} style={styles.input} /></View>;
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
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: seed.spacing.x2 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  optional: { color: colors.muted, fontSize: 10 },
  input: { minHeight: seed.size.input, paddingHorizontal: seed.spacing.x3_5, borderWidth: 1, borderColor: seed.color.stroke.brand, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, color: colors.ink, fontSize: 14 },
  submit: { marginTop: seed.spacing.x5 },
  pressed: { opacity: seed.state.pressedOpacity },
});
