import { colors } from "@/theme";

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
      brandSolid: colors.brand,
      brandSolidPressed: "#79D778",
      brandWeak: "#E9F7E7",
      brandWeakPressed: "#DDF0DB",
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
      brand: colors.brand,
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
    globalGutter: 16,
    componentDefault: 12,
    navToTitle: 20,
    screenBottom: 56,
    betweenText: 6,
    betweenChips: 8,
  },
  radius: {
    r0_5: 2,
    r1: 4,
    r1_5: 6,
    r2: 8,
    r2_5: 10,
    r3: 12,
    r3_5: 14,
    r4: 16,
    r5: 20,
    r6: 24,
    full: 9999,
  },
  typography: {
    screenTitle: { fontSize: 26, lineHeight: 35, fontWeight: "700" as const },
    articleBody: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
    sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: "700" as const },
    subtitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const },
    body: { fontSize: 14, lineHeight: 19, fontWeight: "400" as const },
    bodyStrong: { fontSize: 14, lineHeight: 19, fontWeight: "700" as const },
    label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
    button: { fontSize: 14, lineHeight: 19, fontWeight: "700" as const },
    chip: { fontSize: 14, lineHeight: 19, fontWeight: "500" as const },
  },
  size: {
    touchTarget: 44,
    chip: 36,
    input: 52,
    topNavigation: 60,
    bottomNavigation: 68,
    actionButton: {
      small: 40,
      medium: 44,
      large: 52,
    },
  },
  state: {
    pressedOpacity: 0.76,
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
