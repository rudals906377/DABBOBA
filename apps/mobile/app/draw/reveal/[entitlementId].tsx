import { DrawRevealScreen } from "@/features/draw/DrawRevealScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function DrawRevealRoute() {
  return <CommerceRouteGate fallback="/(tabs)/gacha"><DrawRevealScreen /></CommerceRouteGate>;
}
