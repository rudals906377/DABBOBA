import { ExchangeListingDetailScreen } from "@/features/exchange/ExchangeListingDetailScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function ExchangeListingDetailRoute() {
  return <CommerceRouteGate fallback="/(tabs)/storage"><ExchangeListingDetailScreen /></CommerceRouteGate>;
}
