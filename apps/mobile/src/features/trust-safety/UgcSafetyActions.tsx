import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text, AppTextInput as TextInput } from "@/components/Typography";
import { SeedActionButton, SeedInputShell } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { openCustomerLogin } from "@/features/auth/login-navigation";
import { colors } from "@/theme";
import {
  blockCommunityUser,
  createUgcReport,
  type UgcReportReason,
  type UgcReportTargetType,
} from "./trust-safety-api";

const REPORT_REASONS: Array<{ value: UgcReportReason; label: string }> = [
  { value: "SUSPECTED_FRAUD", label: "사기·외부 거래 유도" },
  { value: "ABUSE", label: "괴롭힘·욕설" },
  { value: "INAPPROPRIATE", label: "부적절한 콘텐츠" },
  { value: "ADVERTISING", label: "광고·홍보" },
  { value: "SPAM", label: "반복 게시·도배" },
  { value: "COPYRIGHT", label: "저작권·권리 침해" },
  { value: "OTHER", label: "기타" },
];

export function UgcSafetyActions({
  apiBaseUrl,
  accessToken,
  targetType,
  targetId,
  targetUserId,
  targetLabel,
  returnTo,
  onBlocked,
  compact = false,
}: {
  apiBaseUrl: string;
  accessToken: string | null;
  targetType: UgcReportTargetType;
  targetId: string;
  targetUserId: string;
  targetLabel: string;
  returnTo: string;
  onBlocked: () => void;
  compact?: boolean;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<UgcReportReason>("SUSPECTED_FRAUD");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState<"report" | "block" | null>(null);

  const requireLogin = () => {
    if (accessToken) return true;
    openCustomerLogin("로그인하면 콘텐츠를 신고하거나 작성자를 차단할 수 있어요.", returnTo);
    return false;
  };

  const submitReport = async () => {
    if (!requireLogin() || !accessToken || pending) return;
    try {
      setPending("report");
      await createUgcReport(apiBaseUrl, accessToken, {
        targetType,
        targetId,
        reason,
        details,
      });
      setReportOpen(false);
      setDetails("");
      Alert.alert("신고가 접수됐어요", "운영팀이 내용을 확인해 필요한 조치를 진행합니다.");
    } catch (error) {
      Alert.alert("신고를 접수하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  };

  const requestBlock = () => {
    if (!requireLogin() || !accessToken || pending) return;
    Alert.alert(
      "작성자를 차단할까요?",
      `${targetLabel} 작성자의 글과 댓글이 즉시 숨겨지고 서로의 콘텐츠를 볼 수 없게 됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "차단하기",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setPending("block");
                await blockCommunityUser(apiBaseUrl, accessToken, targetUserId);
                onBlocked();
                Alert.alert("차단했어요", "이 사용자의 공개 콘텐츠를 더 이상 표시하지 않습니다.");
              } catch (error) {
                Alert.alert("사용자를 차단하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
              } finally {
                setPending(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <>
      <View style={[styles.actions, compact && styles.actionsCompact]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="콘텐츠 신고"
          disabled={Boolean(pending)}
          onPress={() => {
            if (requireLogin()) setReportOpen(true);
          }}
          style={({ pressed }) => [styles.action, compact && styles.actionCompact, pressed && styles.pressed]}
        >
          <DecorativeIonicon name="flag-outline" size={17} color={colors.muted} />
          <Text style={styles.actionLabel}>{compact ? "신고" : "콘텐츠 신고"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="작성자 차단"
          disabled={Boolean(pending)}
          onPress={requestBlock}
          style={({ pressed }) => [styles.action, compact && styles.actionCompact, pressed && styles.pressed]}
        >
          {pending === "block" ? <ActivityIndicator size="small" color={colors.muted} /> : <DecorativeIonicon name="person-remove-outline" size={17} color={colors.muted} />}
          <Text style={styles.actionLabel}>{compact ? "차단" : "작성자 차단"}</Text>
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={reportOpen}
        onRequestClose={() => {
          if (!pending) setReportOpen(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View accessibilityViewIsModal style={styles.modalCard}>
            <View style={styles.modalHeadingRow}>
              <View style={styles.modalHeadingCopy}>
                <Text style={styles.modalTitle}>콘텐츠 신고</Text>
                <Text style={styles.modalBody}>가장 가까운 신고 사유를 선택해 주세요.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="신고 창 닫기"
                disabled={Boolean(pending)}
                onPress={() => setReportOpen(false)}
                style={styles.closeButton}
              >
                <DecorativeIonicon name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView style={styles.reasonList} contentContainerStyle={styles.reasonListContent}>
              {REPORT_REASONS.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === item.value }}
                  onPress={() => setReason(item.value)}
                  style={({ pressed }) => [
                    styles.reason,
                    reason === item.value && styles.reasonSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.reasonLabel}>{item.label}</Text>
                  <DecorativeIonicon
                    name={reason === item.value ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={reason === item.value ? colors.greenInk : colors.muted}
                  />
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.detailsLabel}>추가 설명 (선택)</Text>
            <SeedInputShell style={styles.detailsShell}>
              <TextInput
                accessibilityLabel="신고 추가 설명"
                value={details}
                onChangeText={(value) => setDetails(value.slice(0, 1000))}
                editable={!pending}
                multiline
                maxLength={1000}
                placeholder="운영팀이 확인할 내용을 입력해 주세요"
                placeholderTextColor={colors.muted}
                style={styles.detailsInput}
              />
            </SeedInputShell>
            <SeedActionButton
              label="신고 접수"
              loading={pending === "report"}
              disabled={Boolean(pending)}
              onPress={() => void submitReport()}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: seed.spacing.x2, marginTop: seed.spacing.x3, marginBottom: seed.spacing.x4 },
  actionsCompact: { alignSelf: "flex-end", marginTop: seed.spacing.x2, marginBottom: 0 },
  action: { minHeight: seed.size.touchTarget, flex: 1, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, backgroundColor: seed.color.layer.default, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: seed.spacing.x1_5, paddingHorizontal: seed.spacing.x2 },
  actionCompact: { flex: 0, minWidth: 76 },
  actionLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  modalCard: { maxHeight: "88%", padding: seed.spacing.globalGutter, paddingBottom: seed.spacing.screenBottom, borderTopLeftRadius: seed.radius.r6, borderTopRightRadius: seed.radius.r6, backgroundColor: seed.color.layer.default },
  modalHeadingRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x3, marginBottom: seed.spacing.x4 },
  modalHeadingCopy: { flex: 1 },
  modalTitle: { color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: "900" },
  modalBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: seed.spacing.x1 },
  closeButton: { width: seed.size.touchTarget, height: seed.size.touchTarget, borderRadius: seed.radius.r3, alignItems: "center", justifyContent: "center", backgroundColor: seed.color.background.neutralWeak },
  reasonList: { maxHeight: 330 },
  reasonListContent: { gap: seed.spacing.x2 },
  reason: { minHeight: seed.size.touchTarget, paddingHorizontal: seed.spacing.x3, borderWidth: 1, borderColor: seed.color.stroke.neutral, borderRadius: seed.radius.r3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: seed.color.layer.default },
  reasonSelected: { borderColor: seed.color.stroke.brand, backgroundColor: seed.color.background.brandWeak },
  reasonLabel: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  detailsLabel: { color: colors.ink, fontSize: 13, fontWeight: "900", marginTop: seed.spacing.x4, marginBottom: seed.spacing.x2 },
  detailsShell: { minHeight: 90, alignItems: "stretch", marginBottom: seed.spacing.x4 },
  detailsInput: { minHeight: 88, color: colors.ink, fontSize: 14, lineHeight: 21, padding: seed.spacing.x3, textAlignVertical: "top" },
  pressed: { opacity: seed.state.pressedOpacity, transform: [{ scale: seed.state.pressedScale }] },
});
