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
  mostRestrictiveCommerceCapability,
  resolveMobileRuntimeConfig,
  type CommerceCapability,
  type MobilePlatform,
} from "@/lib/runtime-config";

const PUBLIC_CONFIG_REFRESH_INTERVAL_MS = 30_000;

export type RequiredPolicyVersions = {
  terms: string;
  privacy: string;
};

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
  const [serverCapability, setServerCapability] = useState<CommerceCapability | null>(null);
  const [requiredPolicyVersions, setRequiredPolicyVersions] = useState<RequiredPolicyVersions | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const requestActive = useRef(false);

  const refresh = useCallback(async () => {
    if (requestActive.current) return;
    requestActive.current = true;
    try {
      const response = await fetch(`${runtime.apiBaseUrl}/v1/public/config`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`public config ${response.status}`);
      const body: unknown = await response.json();
      if (!isPublicConfig(body)) throw new Error("invalid public config");
      setServerCapability(body.commerceMode);
      setRequiredPolicyVersions(body.requiredPolicyVersions);
    } catch (error) {
      // A missing or invalid response must never unlock commerce.
      setServerCapability(null);
      console.warn(
        "DABBOBA public config refresh failed; commerce remains unavailable.",
        error instanceof Error ? error.message : error,
      );
    } finally {
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

function isPublicConfig(value: unknown): value is {
  commerceMode: CommerceCapability;
  requiredPolicyVersions: RequiredPolicyVersions;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.commerceMode !== "PRELAUNCH" && candidate.commerceMode !== "LIVE") return false;
  if (!candidate.requiredPolicyVersions || typeof candidate.requiredPolicyVersions !== "object") return false;
  const policies = candidate.requiredPolicyVersions as Record<string, unknown>;
  return typeof policies.terms === "string"
    && policies.terms.length > 0
    && typeof policies.privacy === "string"
    && policies.privacy.length > 0;
}
