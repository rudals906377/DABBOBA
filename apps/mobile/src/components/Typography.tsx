import { Children, isValidElement, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { seed } from "@/design-system/seed";

export const readableFontFamilies = {
  latin: {
    regular: "NotoSans_400Regular",
    medium: "NotoSans_500Medium",
    bold: "NotoSans_700Bold",
    black: "NotoSans_900Black",
  },
  korean: {
    regular: "NotoSansKR_400Regular",
    medium: "NotoSansKR_500Medium",
    bold: "NotoSansKR_700Bold",
    black: "NotoSansKR_900Black",
  },
} as const;

export const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

type ReadableWeight = keyof typeof readableFontFamilies.korean;
export type ReadableTextVariant =
  | "micro"
  | "finePrint"
  | "catalogMetadata"
  | "caption"
  | "label"
  | "chip"
  | "bodyCompact"
  | "body"
  | "bodyStrong"
  | "articleBody"
  | "button"
  | "catalogTitle"
  | "catalogTitleWide"
  | "catalogPrice"
  | "subheading"
  | "subtitle"
  | "sectionTitle"
  | "amount"
  | "screenTitle"
  | "stat"
  | "input";

export const readableTextMetrics = {
  micro: seed.typography.micro,
  finePrint: seed.typography.finePrint,
  catalogMetadata: seed.typography.catalogMetadata,
  caption: seed.typography.caption,
  label: seed.typography.label,
  chip: seed.typography.chip,
  bodyCompact: seed.typography.bodyCompact,
  body: seed.typography.body,
  bodyStrong: seed.typography.bodyStrong,
  articleBody: seed.typography.articleBody,
  button: seed.typography.button,
  catalogTitle: seed.typography.catalogTitle,
  catalogTitleWide: seed.typography.catalogTitleWide,
  catalogPrice: seed.typography.catalogPrice,
  subheading: seed.typography.subheading,
  subtitle: seed.typography.subtitle,
  sectionTitle: seed.typography.sectionTitle,
  amount: seed.typography.amount,
  screenTitle: seed.typography.screenTitle,
  stat: seed.typography.stat,
  input: seed.typography.input,
} as const;

export type AppTextProps = TextProps & { variant?: ReadableTextVariant };

function readableWeight(fontWeight: TextStyle["fontWeight"]): ReadableWeight {
  if (fontWeight === "black" || fontWeight === "heavy") return "black";
  if (fontWeight === "bold" || fontWeight === "semibold") return "bold";
  if (fontWeight === "medium") return "medium";

  const numericWeight = typeof fontWeight === "string" ? Number.parseInt(fontWeight, 10) : Number.NaN;
  if (numericWeight >= 800) return "black";
  if (numericWeight >= 600) return "bold";
  if (numericWeight >= 500) return "medium";
  return "regular";
}

function readableText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return readableText(child.props.children);
    return "";
  }).join("");
}

function canonicalReadableVariant(style: TextProps["style"]): ReadableTextVariant | null {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flattened?.fontSize || flattened.fontFamily) return null;

  const { fontSize, lineHeight = 0 } = flattened;
  if (fontSize <= 10) return "micro";
  if (fontSize === 11) return "finePrint";
  if (fontSize === 12) return lineHeight > 0 && lineHeight <= 16 ? "catalogMetadata" : "caption";
  if (fontSize === 13) return lineHeight >= 20 ? "bodyCompact" : "label";
  if (fontSize === 14) return "body";
  if (fontSize === 15) return lineHeight === 21 ? "catalogTitle" : lineHeight >= 23 ? "articleBody" : "body";
  if (fontSize === 16 && lineHeight === 22) return "catalogTitleWide";
  if (fontSize <= 17) return "articleBody";
  if (fontSize === 18) return "subtitle";
  if (fontSize <= 20) return "sectionTitle";
  if (fontSize <= 23) return "amount";
  if (fontSize <= 33) return "screenTitle";
  return "stat";
}

function readableMetrics(
  style: TextProps["style"] | TextInputProps["style"],
  variant?: ReadableTextVariant,
) {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  if (flattened?.fontFamily) return undefined;
  const resolvedVariant = variant ?? canonicalReadableVariant(style as TextProps["style"]);
  if (!resolvedVariant) return undefined;
  const { fontSize, lineHeight, fontWeight } = readableTextMetrics[resolvedVariant];
  return { fontSize, lineHeight, fontWeight: flattened?.fontWeight ?? fontWeight };
}

function fontStyle(
  style: TextProps["style"] | TextInputProps["style"],
  script: "latin" | "korean",
) {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  if (flattened?.fontFamily) return undefined;

  return {
    fontFamily: readableFontFamilies[script][readableWeight(flattened?.fontWeight)],
    fontWeight: "400" as const,
  };
}

export function AppText({
  children,
  style,
  variant,
  ...props
}: AppTextProps) {
  const script = HANGUL_PATTERN.test(readableText(children)) ? "korean" : "latin";
  const metrics = readableMetrics(style, variant);
  return (
    <NativeText {...props} style={[style, metrics, fontStyle([style, metrics], script)]}>
      {children}
    </NativeText>
  );
}

export function BalancedAppText({
  children,
  lineBreakStrategyIOS = "hangul-word",
  textBreakStrategy = "balanced",
  ...props
}: AppTextProps) {
  return (
    <AppText
      {...props}
      lineBreakStrategyIOS={lineBreakStrategyIOS}
      textBreakStrategy={textBreakStrategy}
    >
      {children}
    </AppText>
  );
}

export function BalancedParagraphText({
  paragraphs,
  accessibilityLabel,
  ...props
}: Omit<AppTextProps, "children"> & { paragraphs: readonly string[] }) {
  const normalizedParagraphs = paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);

  return (
    <BalancedAppText
      {...props}
      accessibilityLabel={accessibilityLabel ?? normalizedParagraphs.join(" ")}
    >
      {normalizedParagraphs.join("\n")}
    </BalancedAppText>
  );
}

export function AppTextInput({ style, ...props }: TextInputProps) {
  const metrics = readableMetrics(style, "input");
  // Android clips Korean placeholder glyphs when a single-line TextInput uses
  // the fixed text line height with the Noto Sans KR font.
  const nativeLineHeight = Platform.OS === "android" && !props.multiline
    ? { lineHeight: undefined }
    : undefined;
  return <NativeTextInput {...props} style={[style, metrics, nativeLineHeight, fontStyle([style, metrics], "korean")]} />;
}
