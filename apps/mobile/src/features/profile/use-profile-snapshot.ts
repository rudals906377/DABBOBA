import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { fetchProfileSnapshot, type ProfileSnapshot } from "@/features/profile/profile-api";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";

export function useProfileSnapshot() {
  const runtime = useMemo(
    () => resolveMobileRuntimeConfig({
      configuredApiUrl: process.env.EXPO_PUBLIC_DABBOBA_API_URL,
      configuredAssetBaseUrl: process.env.EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL,
      metroHostUri: Constants.expoConfig?.hostUri,
      platform: Platform.OS as MobilePlatform,
      development: __DEV__,
    }),
    [],
  );
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const tokens = await readAuthTokens();
      setAccessToken(tokens?.accessToken ?? null);
      const next = await fetchProfileSnapshot(runtime.apiBaseUrl, tokens?.accessToken);
      setSnapshot(next);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "내정보를 불러오지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }, [runtime.apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return {
    snapshot,
    setSnapshot,
    accessToken,
    runtime,
    message,
    refreshing,
    reload,
  };
}
