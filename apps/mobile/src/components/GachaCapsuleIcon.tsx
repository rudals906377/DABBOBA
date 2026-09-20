import { Image, View, type ColorValue } from "react-native";
import { seed } from "@/design-system/seed";

const GACHA_CAPSULE_INACTIVE = require("../../assets/icons/gacha-capsule-light.png");
const GACHA_CAPSULE_ACTIVE = require("../../assets/icons/gacha-capsule-light-active.png");

type GachaCapsuleIconProps = {
  color: ColorValue;
  size: number;
};

export function GachaCapsuleIcon({ color, size }: GachaCapsuleIconProps) {
  const visualSize = Math.min(29, Math.max(25, size + 4));
  const isActive = color === seed.color.foreground.brand;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Image
        source={isActive ? GACHA_CAPSULE_ACTIVE : GACHA_CAPSULE_INACTIVE}
        resizeMode="contain"
        style={{ width: visualSize, height: visualSize, opacity: isActive ? 1 : 0.82 }}
      />
    </View>
  );
}
