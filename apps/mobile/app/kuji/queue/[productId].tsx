import { KujiQueueScreen } from "@/features/kuji/KujiQueueScreen";
import { CommerceRouteGate } from "@/features/commerce/CommerceRouteGate";

export default function KujiQueueRoute() {
  return <CommerceRouteGate fallback="/(tabs)/kuji"><KujiQueueScreen /></CommerceRouteGate>;
}
