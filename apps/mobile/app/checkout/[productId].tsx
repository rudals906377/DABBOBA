import { DirectPurchaseCheckoutScreen } from "@/features/checkout/DirectPurchaseCheckoutScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function CheckoutRoute() {
  return <CommerceRouteGate fallback="/(tabs)/gacha"><DirectPurchaseCheckoutScreen /></CommerceRouteGate>;
}
