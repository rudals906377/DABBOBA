import { PortOnePaymentScreen } from "@/features/checkout/PortOnePaymentScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function PortOnePaymentRoute() {
  return <CommerceRouteGate fallback="/(tabs)/gacha"><PortOnePaymentScreen /></CommerceRouteGate>;
}
