import { CheckoutScreen } from "@/features/checkout/CheckoutScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function CheckoutRoute() {
  return <CommerceRouteGate fallback="/(tabs)/gacha"><CheckoutScreen /></CommerceRouteGate>;
}
