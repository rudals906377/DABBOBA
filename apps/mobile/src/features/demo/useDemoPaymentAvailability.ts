import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  fetchDemoCapabilities,
  TemporaryDemoCapabilityError,
} from "@/features/demo/demo-api";

const DEMO_CAPABILITY_REFRESH_INTERVAL_MS = 5_000;
const DEMO_CAPABILITY_RESTART_GRACE_MS = 15_000;

/**
 * Keeps the development checkout in sync with the exact server capability.
 * A transient network failure retains the last verified value; every mutating
 * TEST_PG action still revalidates the capability immediately before use.
 */
export function useDemoPaymentAvailability(apiBaseUrl: string): boolean {
  const [enabled, setEnabled] = useState(false);
  const verifiedBaseUrlRef = useRef<string | null>(null);
  const lastVerifiedAtRef = useRef<number | null>(null);

  useFocusEffect(useCallback(() => {
    if (!__DEV__) {
      setEnabled(false);
      return undefined;
    }

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    if (verifiedBaseUrlRef.current !== apiBaseUrl) {
      verifiedBaseUrlRef.current = apiBaseUrl;
      lastVerifiedAtRef.current = null;
      setEnabled(false);
    }

    const refresh = async () => {
      try {
        const capabilities = await fetchDemoCapabilities(apiBaseUrl);
        if (active) {
          const nextEnabled = Boolean(capabilities);
          lastVerifiedAtRef.current = nextEnabled ? Date.now() : null;
          setEnabled(nextEnabled);
        }
      } catch (error) {
        if (!active) return;
        const lastVerifiedAt = lastVerifiedAtRef.current;
        const insideRestartGrace = error instanceof TemporaryDemoCapabilityError
          && lastVerifiedAt !== null
          && Date.now() - lastVerifiedAt <= DEMO_CAPABILITY_RESTART_GRACE_MS;
        if (!insideRestartGrace) {
          lastVerifiedAtRef.current = null;
          setEnabled(false);
        }
      } finally {
        if (active) {
          retryTimer = setTimeout(() => void refresh(), DEMO_CAPABILITY_REFRESH_INTERVAL_MS);
        }
      }
    };

    void refresh();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [apiBaseUrl]));

  return enabled;
}
