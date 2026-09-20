import { colors } from "@/theme";
import { brandAccentPolicy } from "@/design-system/brand-accent";

/**
 * Expo-native interpretation of SEED Design foundations.
 *
 * DABBOBA keeps its own brand colors and Noto typefaces. The values below map
 * those existing choices to role-based tokens so native screens share one
 * visual and interaction language without depending on SEED's web packages.
 */
export const seed = {
  color: {
    layer: {
      basement: colors.canvas,
      default: colors.surface,
      elevated: colors.white,
      inverted: colors.black,
    },
    foreground: {
      neutral: colors.ink,
      muted: colors.muted,
      brand: colors.greenInk,
      onBrand: colors.ink,
      inverted: colors.white,
      critical: colors.danger,
      disabled: "#A9AFA8",
    },
    background: {
      brandSolid: brandAccentPolicy.color.solid,
      brandSolidPressed: brandAccentPolicy.color.solidPressed,
      brandWeak: brandAccentPolicy.color.weak,
      brandWeakPressed: brandAccentPolicy.color.weakPressed,
      neutralSolid: colors.ink,
      neutralSolidPressed: "#242924",
      neutralWeak: "#EEF1EC",
      neutralWeakPressed: "#E2E6E0",
      criticalWeak: "#F8E9E5",
      disabled: "#E4E7E2",
      transparent: "transparent",
      transparentPressed: "rgba(17, 20, 17, 0.06)",
    },
    stroke: {
      neutral: colors.line,
      muted: "#E7E9E4",
      contrast: "#A7AEA6",
      brand: brandAccentPolicy.color.focusStroke,
      focus: colors.greenInk,
      critical: colors.danger,
    },
  },
  spacing: {
    x0_5: 2,
    x1: 4,
    x1_5: 6,
    x2: 8,
    x2_5: 10,
    x3: 12,
    x3_5: 14,
    x4: 16,
    x4_5: 18,
    x5: 20,
    x6: 24,
    x7: 28,
    x8: 32,
    x9: 36,
    x10: 40,
    x12: 48,
    x13: 52,
    x14: 56,
    x16: 64,
    globalGutter: 20,
    componentDefault: 12,
    navToTitle: 20,
    screenBottom: 56,
    betweenText: 6,
    betweenChips: 8,
  },
  radius: {
    none: 0,
    r0_25: 1,
    r0_5: 2,
    r1: 4,
    r1_5: 6,
    r1_75: 7,
    r2: 8,
    r2_5: 10,
    r3: 12,
    r3_5: 14,
    r4: 16,
    r5: 20,
    r5_5: 22,
    r6: 24,
    full: 9999,
  },
  typography: {
    micro: { fontSize: 10, lineHeight: 15, fontWeight: "500" as const },
    finePrint: { fontSize: 11, lineHeight: 16, fontWeight: "400" as const },
    screenTitle: { fontSize: 24, lineHeight: 34, fontWeight: "700" as const },
    articleBody: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
    sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: "700" as const },
    subtitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const },
    subheading: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
    body: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
    bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: "700" as const },
    bodyCompact: { fontSize: 13, lineHeight: 20, fontWeight: "400" as const },
    label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
    caption: { fontSize: 12, lineHeight: 18, fontWeight: "400" as const },
    button: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
    chip: { fontSize: 14, lineHeight: 20, fontWeight: "500" as const },
    input: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
    amount: { fontSize: 22, lineHeight: 30, fontWeight: "700" as const },
    stat: { fontSize: 34, lineHeight: 42, fontWeight: "700" as const },
    catalogTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" as const },
    catalogTitleWide: { fontSize: 16, lineHeight: 22, fontWeight: "700" as const },
    catalogPrice: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const },
    catalogMetadata: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  },
  size: {
    touchTarget: 44,
    chip: 36,
    input: 52,
    rootTopNavigation: 56,
    topNavigation: 60,
    bottomNavigation: 68,
    actionButton: {
      small: 44,
      medium: 44,
      large: 52,
    },
  },
  state: {
    pressedOpacity: 0.88,
    pressedTranslateY: 1,
    pressedScale: 0.995,
    disabledOpacity: 0.5,
  },
} as const;

export type SeedActionVariant =
  | "brandSolid"
  | "neutralSolid"
  | "neutralWeak"
  | "brandOutline"
  | "neutralOutline"
  | "criticalSolid"
  | "ghost";
