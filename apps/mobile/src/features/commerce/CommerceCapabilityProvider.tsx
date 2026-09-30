import Constants from "expo-constants";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import {
  EMPTY_PUBLIC_CONFIG_STATE,
  parsePublicConfig,
  resolvePublicConfigState,
  type PublicConfigResponse,
  type RequiredPolicyVersions,
} from "@/features/commerce/public-config-grace";
import {
  mostRestrictiveCommerceCapability,
  resolveMobileRuntimeConfig,
  type CommerceCapability,
  type MobilePlatform,
} from "@/lib/runtime-config";

/**
 * Public commerce/legal config refresh.
 *
 * The server answer is refreshed every 30 seconds, on foreground, and with an
 * 8-second timeout. A valid answer always wins, including an explicit
 * `PRELAUNCH` mode. When a refresh fails, the last verified answer keeps
 * serving for at most `PUBLIC_CONFIG_GRACE_MS` (10 minutes) after its success
 * so one dropped request cannot disable login or eject a mounted commerce
 * route; past that window, or before any success, commerce and legal versions
 * are unknown (`null`) and the app stays fail-closed.
 */
const PUBLIC_CONFIG_REFRESH_INTERVAL_MS = 30_000;
const PUBLIC_CONFIG_TIMEOUT_MS = 8_000;

export type { RequiredPolicyVersions } from "@/features/commerce/public-config-grace";

type CommerceCapabilityContextValue = {
  buildCapability: CommerceCapability;
  serverCapability: CommerceCapability | null;
  effectiveCapability: CommerceCapability;
  commerceEnabled: boolean;
  requiredPolicyVersions: RequiredPolicyVersions | null;
  configReady: boolean;
  refresh: () => Promise<void>;
};

const CommerceCapabilityContext = createContext<CommerceCapabilityContextValue | null>(null);

export function CommerceCapabilityProvider({ children }: { children: ReactNode }) {
  const runtime = useMemo(() => resolveMobileRuntimeConfig({
    configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
    configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
    configuredCommerceCapability: process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY,
    metroHostUri: Constants.expoConfig?.hostUri,
    platform: Platform.OS as MobilePlatform,
    development: __DEV__,
  }), []);
  const [config, setConfig] = useState(EMPTY_PUBLIC_CONFIG_STATE);
  const [configReady, setConfigReady] = useState(false);
  const requestActive = useRef(false);

  const refresh = useCallback(async () => {
    if (requestActive.current) return;
    requestActive.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBLIC_CONFIG_TIMEOUT_MS);
    let fetched: PublicConfigResponse | null = null;
    let failure: unknown = null;
    try {
      const response = await fetch(`${runtime.apiBaseUrl}/v1/public/config`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`public config ${response.status}`);
      fetched = parsePublicConfig(await response.json());
      if (!fetched) throw new Error("invalid public config");
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timeout);
      const now = Date.now();
      // A missing or invalid response keeps the last verified answer only inside
      // the grace window; afterwards commerce and legal authority become unknown.
      setConfig((previous) => resolvePublicConfigState({
        previous,
        fetched,
        error: failure,
        now,
        lastSuccessAt: previous.lastSuccessAt,
      }));
      if (failure !== null) {
        console.warn(
          "DABBOBA public config refresh failed; keeping the last verified answer only within the grace window.",
          failure instanceof Error ? failure.message : failure,
        );
      }
      setConfigReady(true);
      requestActive.current = false;
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), PUBLIC_CONFIG_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);

  const { serverCapability, requiredPolicyVersions } = config;
  const effectiveCapability = mostRestrictiveCommerceCapability(
    runtime.commerceCapability,
    serverCapability,
  );
  const value = useMemo<CommerceCapabilityContextValue>(() => ({
    buildCapability: runtime.commerceCapability,
    serverCapability,
    effectiveCapability,
    commerceEnabled: effectiveCapability === "LIVE",
    requiredPolicyVersions,
    configReady,
    refresh,
  }), [configReady, effectiveCapability, refresh, requiredPolicyVersions, runtime.commerceCapability, serverCapability]);

  return (
    <CommerceCapabilityContext.Provider value={value}>
      {children}
    </CommerceCapabilityContext.Provider>
  );
}

export function useCommerceCapability(): CommerceCapabilityContextValue {
  const value = useContext(CommerceCapabilityContext);
  if (!value) throw new Error("useCommerceCapability must be used inside CommerceCapabilityProvider");
  return value;
}
