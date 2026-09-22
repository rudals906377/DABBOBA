import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type DecorativeIoniconProps = ComponentProps<typeof Ionicons>;
export type DecorativeIoniconName = DecorativeIoniconProps["name"];

/**
 * Visual-only Ionicon. Interactive parents must provide the accessible name,
 * role, state, and hint so screen readers never announce the icon font glyph.
 */
export function DecorativeIonicon(props: DecorativeIoniconProps) {
  return (
    <Ionicons
      {...props}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
