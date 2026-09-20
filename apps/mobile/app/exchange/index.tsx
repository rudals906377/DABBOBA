import { ExchangeRoomScreen } from "@/features/exchange/ExchangeRoomScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function ExchangeRoomRoute() {
  return <CommerceRouteGate fallback="/(tabs)/storage"><ExchangeRoomScreen /></CommerceRouteGate>;
}
