import { Children, isValidElement, type ReactNode } from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";

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

export function AppText({ children, style, ...props }: TextProps) {
  const script = HANGUL_PATTERN.test(readableText(children)) ? "korean" : "latin";
  return (
    <NativeText {...props} style={[style, fontStyle(style, script)]}>
      {children}
    </NativeText>
  );
}

export function BalancedAppText({
  children,
  lineBreakStrategyIOS = "hangul-word",
  textBreakStrategy = "balanced",
  ...props
}: TextProps) {
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
}: Omit<TextProps, "children"> & { paragraphs: readonly string[] }) {
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
  return <NativeTextInput {...props} style={[style, fontStyle(style, "korean")]} />;
}
