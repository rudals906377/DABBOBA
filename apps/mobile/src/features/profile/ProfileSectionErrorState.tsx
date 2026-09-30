import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { AppText as Text } from "@/components/Typography";
import { SeedActionButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

/**
 * Retryable failure for one personal profile section. It replaces the
 * section's empty state whenever that request failed, so a failed load is
 * never presented as an authenticated account with no records.
 */
export function ProfileSectionErrorState({
  message,
  onRetry,
  retryLabel = "다시 불러오기",
  style,
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="alert" style={[styles.box, style]}>
      <Text maxFontSizeMultiplier={2} style={styles.message}>{message}</Text>
      <SeedActionButton
        label={retryLabel}
        size="small"
        variant="neutralSolid"
        onPress={onRetry}
        style={styles.retry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    borderRadius: seed.radius.r4,
    padding: seed.spacing.x5,
    backgroundColor: seed.color.background.criticalWeak,
  },
  message: { color: colors.ink, ...seed.typography.bodyCompact, textAlign: "center" },
  retry: { marginTop: seed.spacing.x3, minWidth: 136 },
});
