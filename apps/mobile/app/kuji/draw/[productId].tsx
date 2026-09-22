import { KujiDrawScreen } from "@/features/kuji/KujiDrawScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function KujiDrawRoute() {
  return <CommerceRouteGate fallback="/(tabs)/kuji"><KujiDrawScreen /></CommerceRouteGate>;
}
