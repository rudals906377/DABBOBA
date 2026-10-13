import { DirectPurchaseCheckoutScreen } from "@/features/checkout/DirectPurchaseCheckoutScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function DirectPurchaseCheckoutRoute() {
  return <CommerceRouteGate fallback="/(tabs)/gacha"><DirectPurchaseCheckoutScreen /></CommerceRouteGate>;
}
