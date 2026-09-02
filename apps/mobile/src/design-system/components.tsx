import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { AppText as Text, BalancedAppText, BalancedParagraphText } from "@/components/Typography";
import { seed, type SeedActionVariant } from "@/design-system/seed";

type SeedActionButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: SeedActionVariant;
  size?: keyof typeof seed.size.actionButton;
  leading?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SeedActionButton({
  label,
  variant = "brandSolid",
  size = "large",
  leading,
  trailing,
  loading = false,
  disabled,
  style,
  ...props
}: SeedActionButtonProps) {
  const unavailable = Boolean(disabled || loading);
  const variantStyle = actionVariants[variant];
  const labelStyle = actionLabelVariants[variant];

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.actionButton,
        { minHeight: seed.size.actionButton[size] },
        variantStyle,
        pressed && styles.actionPressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={labelStyle.color} /> : leading}
      <Text numberOfLines={1} style={[styles.actionLabel, labelStyle]}>{label}</Text>
      {loading ? null : trailing}
    </Pressable>
  );
}

type SeedChipProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SeedChip({ label, selected = false, disabled = false, style, ...props }: SeedChipProps) {
  const unavailable = Boolean(disabled);
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: unavailable }}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

type SeedIconButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SeedIconButton({ label, children, disabled, style, ...props }: SeedIconButtonProps) {
  const unavailable = Boolean(disabled);
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable }}
      disabled={unavailable}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed, unavailable && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

export function SeedCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SeedInlineGuidance({
  style,
  paragraphs,
  children,
  ...props
}: TextProps & { paragraphs?: readonly string[] }) {
  if (paragraphs) {
    return (
      <BalancedParagraphText
        {...props}
        paragraphs={paragraphs}
        style={[styles.inlineGuidance, style]}
      />
    );
  }

  return <BalancedAppText {...props} style={[styles.inlineGuidance, style]}>{children}</BalancedAppText>;
}

export function SeedInputShell({ children, focused = false, error = false, variant = "default", style }: {
  children: ReactNode;
  focused?: boolean;
  error?: boolean;
  variant?: "default" | "search";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[
      styles.inputShell,
      style,
      variant === "search" && styles.inputSearch,
      focused && styles.inputFocused,
      error && styles.inputError,
    ]}>
      {children}
    </View>
  );
}

const actionVariants = StyleSheet.create({
  brandSolid: { backgroundColor: seed.color.background.brandSolid },
  neutralSolid: { backgroundColor: seed.color.background.neutralSolid },
  neutralWeak: { backgroundColor: seed.color.background.neutralWeak },
  brandOutline: { backgroundColor: seed.color.background.transparent, borderWidth: 1, borderColor: seed.color.stroke.brand },
  neutralOutline: { backgroundColor: seed.color.background.transparent, borderWidth: 1, borderColor: seed.color.stroke.neutral },
  criticalSolid: { backgroundColor: seed.color.foreground.critical },
  ghost: { backgroundColor: seed.color.background.transparent },
});

const actionLabelVariants = StyleSheet.create({
  brandSolid: { color: seed.color.foreground.onBrand },
  neutralSolid: { color: seed.color.foreground.inverted },
  neutralWeak: { color: seed.color.foreground.neutral },
  brandOutline: { color: seed.color.foreground.brand },
  neutralOutline: { color: seed.color.foreground.neutral },
  criticalSolid: { color: seed.color.foreground.inverted },
  ghost: { color: seed.color.foreground.neutral },
});

const styles = StyleSheet.create({
  actionButton: {
    paddingHorizontal: seed.spacing.x4,
    borderRadius: seed.radius.r3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.x2,
  },
  actionPressed: { opacity: seed.state.pressedOpacity },
  actionLabel: seed.typography.button,
  disabled: { opacity: seed.state.disabledOpacity },
  chip: {
    minHeight: seed.size.chip,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: seed.radius.r2,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    borderColor: seed.color.background.brandSolid,
    backgroundColor: seed.color.background.brandSolid,
  },
  chipPressed: { backgroundColor: seed.color.background.neutralWeakPressed },
  chipLabel: { ...seed.typography.chip, color: seed.color.foreground.muted },
  chipLabelSelected: { color: seed.color.foreground.onBrand, fontWeight: "700" },
  iconButton: {
    width: seed.size.touchTarget,
    height: seed.size.touchTarget,
    borderRadius: seed.radius.r3,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPressed: { backgroundColor: seed.color.background.transparentPressed },
  card: {
    borderRadius: seed.radius.r4,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.default,
  },
  inlineGuidance: { color: seed.color.foreground.muted, ...seed.typography.caption },
  inputShell: {
    minHeight: seed.size.input,
    paddingHorizontal: seed.spacing.x3_5,
    borderRadius: seed.radius.r3,
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    backgroundColor: seed.color.layer.elevated,
    flexDirection: "row",
    alignItems: "center",
    gap: seed.spacing.x2,
  },
  inputSearch: { borderColor: seed.color.stroke.brand },
  inputFocused: { borderColor: seed.color.stroke.brand, borderWidth: 2 },
  inputError: { borderColor: seed.color.stroke.critical },
});
