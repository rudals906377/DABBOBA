import { ExchangeOfferScreen } from "@/features/exchange/ExchangeOfferScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function ExchangeOfferRoute() {
  return <CommerceRouteGate fallback="/(tabs)/storage"><ExchangeOfferScreen /></CommerceRouteGate>;
}
