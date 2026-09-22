import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { createMobileDabbobaClient } from "@/lib/mobile-api-client";
import { resolveMobileRuntimeConfig, type MobilePlatform } from "@/lib/runtime-config";
import {
  applyStorefrontCategorySettings,
  storefrontCategoryOptions,
  storefrontCategorySettingsRevision,
  type CustomerCategorySurface,
} from "./product-categories";

const CATEGORY_REFRESH_INTERVAL_MS = 10_000;

type StorefrontCategoryContextValue = {
  revision: string;
  refresh: () => Promise<void>;
};

const StorefrontCategoryContext = createContext<StorefrontCategoryContextValue>({
  revision: "defaults",
  refresh: async () => undefined,
});

export function StorefrontCategorySettingsProvider({ children }: { children: ReactNode }) {
  const runtime = useMemo(() => resolveMobileRuntimeConfig({
    configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
    configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
    metroHostUri: Constants.expoConfig?.hostUri,
    platform: Platform.OS as MobilePlatform,
    development: __DEV__,
  }), []);
  const [revision, setRevision] = useState(storefrontCategorySettingsRevision);
  const requestActive = useRef(false);

  const refresh = useCallback(async () => {
    if (requestActive.current) return;
    requestActive.current = true;
    try {
      const client = createMobileDabbobaClient({ baseUrl: runtime.apiBaseUrl, requestId: randomUUID });
      const result = await client.GET("/v1/catalog/category-settings");
      if (result.data?.items.length) setRevision(applyStorefrontCategorySettings(result.data.items));
    } catch (error) {
      console.warn(
        "DABBOBA category settings refresh failed; keeping the last verified settings.",
        error instanceof Error ? error.message : error,
      );
    } finally {
      requestActive.current = false;
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), CATEGORY_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);

  const value = useMemo(() => ({ revision, refresh }), [refresh, revision]);
  return <StorefrontCategoryContext.Provider value={value}>{children}</StorefrontCategoryContext.Provider>;
}

export function useStorefrontCategorySettings(): StorefrontCategoryContextValue {
  return useContext(StorefrontCategoryContext);
}

export function useStorefrontCategoryOptions(surface: CustomerCategorySurface) {
  const { revision } = useStorefrontCategorySettings();
  return useMemo(() => storefrontCategoryOptions(surface), [revision, surface]);
}
