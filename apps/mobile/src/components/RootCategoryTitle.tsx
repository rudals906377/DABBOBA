import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { AppText as Text } from "@/components/Typography";
import { colors } from "@/theme";

type KoreanPixelTitleVariant = "root" | "hero" | "section" | "header" | "compact";

export function KoreanPixelTitle({
  children,
  variant = "section",
  numberOfLines = 1,
  style,
}: {
  children: ReactNode;
  variant?: KoreanPixelTitleVariant;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.2}
      numberOfLines={numberOfLines}
      style={[styles.base, styles[variant], style]}
    >
      {children}
    </Text>
  );
}

export function RootCategoryTitle({ children }: { children: string }) {
  return <KoreanPixelTitle variant="root">{children}</KoreanPixelTitle>;
}

const styles = StyleSheet.create({
  base: {
    color: colors.ink,
    fontFamily: "Galmuri11",
    fontWeight: "400",
  },
  root: {
    fontSize: 22,
    letterSpacing: -0.8,
    lineHeight: 29,
  },
  hero: {
    fontSize: 24,
    letterSpacing: -0.9,
    lineHeight: 33,
  },
  section: {
    fontSize: 22,
    letterSpacing: -0.8,
    lineHeight: 30,
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
});
