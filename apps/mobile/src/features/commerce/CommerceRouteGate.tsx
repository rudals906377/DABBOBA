import { Redirect, type Href } from "expo-router";
import type { ReactNode } from "react";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";

export function CommerceRouteGate({
  children,
  fallback = "/(tabs)",
}: {
  children: ReactNode;
  fallback?: Href;
}) {
  const { commerceEnabled } = useCommerceCapability();
  if (!commerceEnabled) return <Redirect href={fallback} />;
  return children;
}
