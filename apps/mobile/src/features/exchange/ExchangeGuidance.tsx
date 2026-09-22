import { StyleSheet, View } from "react-native";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

const exchangeRules = [
  "가챠로 직접 뽑아 현재 보관함에 있는 상품만 등록하거나 신청할 수 있어요.",
  "등록한 글은 7일 동안 공개되며 교환이 성사되지 않으면 자동으로 종료돼요.",
  "교환이 진행 중인 상품은 배송 신청, 포인트 환급, 다른 교환에 사용할 수 없어요.",
  "상대방의 상품과 교환 조건을 충분히 확인한 뒤 신청해 주세요.",
  "제안이 수락되면 양쪽 사용자의 확인이 모두 끝난 뒤 소유권이 변경되며, 남은 보관 기간이 14일보다 짧으면 14일로 연장돼요.",
  "교환으로 받은 상품은 포인트 환급 대상이 아니며, 본인이 가챠에서 직접 뽑아 보관 중인 상품만 포인트로 환급할 수 있어요.",
  "교환 중 문제가 생기면 다뽀바 문의를 통해 접수해 주세요.",
] as const;

export function ExchangeSafetyNotice({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.notice, compact && styles.noticeCompact]}>
      <View style={styles.noticeTitleRow}>
        <DecorativeIonicon name="information-circle" size={20} color={colors.greenInk} />
        <Text style={styles.noticeTitle}>교환 전 확인해 주세요</Text>
      </View>
      <Text style={styles.noticeBody}>
        다뽀바 밖에서 연락하거나 거래하면 보호받기 어려워요. 상품 확인과 교환 진행은 다뽀바 안에서 완료해 주세요.
      </Text>
    </View>
  );
}

export function ExchangeRuleList({ title = "교환방 이용 안내" }: { title?: string }) {
  return (
    <View style={styles.rules}>
      <Text style={styles.rulesTitle}>{title}</Text>
      {exchangeRules.map((rule) => (
        <View key={rule} style={styles.ruleRow}>
          <View style={styles.ruleDot} />
          <Text style={styles.ruleText}>{rule}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderRadius: seed.radius.r4,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.background.brandWeak,
    padding: seed.spacing.x4,
  },
  noticeCompact: { borderRadius: seed.radius.r3, paddingVertical: seed.spacing.x3 },
  noticeTitleRow: { flexDirection: "row", alignItems: "center", gap: seed.spacing.x2 },
  noticeTitle: { color: colors.ink, ...seed.typography.bodyStrong },
  noticeBody: { marginTop: seed.spacing.x2, color: colors.muted, ...seed.typography.bodyCompact },
  rules: {
    marginTop: seed.spacing.x6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.neutral,
    paddingTop: seed.spacing.x5,
    gap: seed.spacing.x3,
  },
  rulesTitle: { color: colors.ink, ...seed.typography.subheading },
  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: seed.spacing.x2_5 },
  ruleDot: { width: 5, height: 5, marginTop: 8, borderRadius: seed.radius.full, backgroundColor: colors.brand },
  ruleText: { flex: 1, color: colors.muted, ...seed.typography.bodyCompact },
});
