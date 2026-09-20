import { ExchangeActivityScreen } from "@/features/exchange/ExchangeActivityScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function ExchangeActivityRoute() {
  return <CommerceRouteGate fallback="/(tabs)/profile"><ExchangeActivityScreen /></CommerceRouteGate>;
}
