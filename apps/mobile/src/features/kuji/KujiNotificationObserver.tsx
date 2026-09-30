import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { installNotificationResponseDispatcher } from "@/features/notifications/notification-response";

/**
 * Kuji turn taps are routed by the shared kind-based dispatcher (see
 * `notification-response.ts`), which validates the product ID and always
 * returns to the authoritative room gate.
 */
export function KujiNotificationObserver() {
  const router = useRouter();

  useEffect(
    () => installNotificationResponseDispatcher((path) => router.push(path as Href)),
    [router],
  );

  return null;
}
