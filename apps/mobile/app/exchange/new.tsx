import { ExchangeCreateScreen } from "@/features/exchange/ExchangeCreateScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function ExchangeCreateRoute() {
  return <CommerceRouteGate fallback="/(tabs)/storage"><ExchangeCreateScreen /></CommerceRouteGate>;
}
