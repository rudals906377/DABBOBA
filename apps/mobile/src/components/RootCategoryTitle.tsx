import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { AppText as Text, type ReadableTextVariant } from "@/components/Typography";
import { colors } from "@/theme";

export type KoreanPixelTitleVariant = "root" | "hero" | "section" | "header" | "compact";
export type KoreanPixelTitleProps = {
  children: ReactNode;
  variant?: KoreanPixelTitleVariant;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
  style?: StyleProp<TextStyle>;
};

export function KoreanPixelTitle({
  children,
  variant = "section",
  numberOfLines = 1,
  maxFontSizeMultiplier = 2,
  style,
}: KoreanPixelTitleProps) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      numberOfLines={numberOfLines}
      style={[styles.base, styles[variant], style, styles.fixedPixelFace]}
    >
      {children}
    </Text>
  );
}

export type ReadablePageTitleProps = {
  children: ReactNode;
  variant?: Extract<ReadableTextVariant, "subheading" | "subtitle" | "sectionTitle" | "screenTitle">;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
};

/** Dynamic titles may wrap to two lines and retain the user's system text size. */
export function ReadablePageTitle({
  children,
  variant = "subtitle",
  numberOfLines = 2,
  style,
}: ReadablePageTitleProps) {
  return (
    <Text
      accessibilityRole="header"
      variant={variant}
      numberOfLines={numberOfLines}
      style={[styles.readablePageTitle, style]}
    >
      {children}
    </Text>
  );
}

export function RootCategoryTitle({ children }: { children: string }) {
  return <KoreanPixelTitle variant="root">{children}</KoreanPixelTitle>;
}

export function KoreanPixelTitleAccessory({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      maxFontSizeMultiplier={2}
      numberOfLines={1}
      style={[styles.accessory, style, styles.fixedPixelFace]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.ink,
  },
  fixedPixelFace: {
    fontFamily: "DabbobaKoreanPixelBold",
    fontWeight: "400",
  },
  root: {
    fontSize: 21,
    letterSpacing: -0.65,
    lineHeight: 29,
  },
  hero: {
    fontSize: 24,
    letterSpacing: -0.9,
    lineHeight: 33,
  },
  section: {
    fontSize: 19,
    letterSpacing: -0.45,
    lineHeight: 27,
  },
  header: {
    fontSize: 16,
    letterSpacing: -0.6,
    lineHeight: 24,
  },
  compact: {
    fontSize: 15,
    letterSpacing: -0.5,
    lineHeight: 22,
  },
  accessory: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: -0.35,
    lineHeight: 18,
  },
  readablePageTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.ink,
  },
});
