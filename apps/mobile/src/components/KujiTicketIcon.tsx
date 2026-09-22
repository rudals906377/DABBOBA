import { Image, View, type ColorValue } from "react-native";
import { colors } from "@/theme";

const KUJI_TICKET_INACTIVE = require("../../assets/icons/kuji-ticket-chunky.png");
const KUJI_TICKET_ACTIVE = require("../../assets/icons/kuji-ticket-chunky-active.png");

type KujiTicketIconProps = {
  color: ColorValue;
  size: number;
};

export function KujiTicketIcon({ color, size }: KujiTicketIconProps) {
  const visualSize = Math.min(30, Math.max(26, size + 5));
  const isActive = color === colors.kujiOrangeDark;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Image
        source={isActive ? KUJI_TICKET_ACTIVE : KUJI_TICKET_INACTIVE}
        resizeMode="contain"
        style={{ width: visualSize, height: visualSize, opacity: isActive ? 1 : 0.78 }}
      />
    </View>
  );
}
