import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Platform } from "react-native";
import { useStorefrontCategorySettings } from "@/features/catalog/StorefrontCategorySettingsProvider";
import {
  fetchProfileSnapshot,
  createGuestSnapshot,
  ProfileApiError,
  type ProfileSnapshotScope,
  type ProfileSnapshot,
} from "@/features/profile/profile-api";
import {
  authenticatedProfileSession,
  expiredProfileSession,
  failedProfileSession,
  guestProfileSession,
  loadingProfileSession,
} from "@/features/profile/profile-session-state";
import {
  resolveMobileRuntimeConfig,
  type MobilePlatform,
} from "@/lib/runtime-config";
import { readAuthTokens } from "@/lib/session-store";

export function useProfileSnapshot(scope: ProfileSnapshotScope = "full") {
  const { revision: categorySettingsRevision } = useStorefrontCategorySettings();
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
  const [session, setSession] = useState(loadingProfileSession);
  const [refreshing, setRefreshing] = useState(false);
  const loadGeneration = useRef(0);
  const loadRef = useRef<(manual?: boolean) => Promise<void>>(async () => undefined);

  const load = useCallback(async (manual = false) => {
    const generation = ++loadGeneration.current;
    let requestedAccessToken: string | null | undefined;
    if (manual) setRefreshing(true);
    try {
      const tokens = await readAuthTokens();
      requestedAccessToken = tokens?.accessToken ?? null;
      if (generation !== loadGeneration.current) return;
      if (!tokens) {
        setSession((current) => current.status === "guest"
          ? { ...current, message: "", publicLoading: true }
          : guestProfileSession(createGuestSnapshot([], {}, [], []), "", true));
        try {
          const guestSnapshot = await fetchProfileSnapshot(runtime.apiBaseUrl, undefined, { scope });
          const currentTokens = await readAuthTokens();
          if (generation !== loadGeneration.current) return;
          if (currentTokens) {
            void loadRef.current();
            return;
          }
          setSession(guestProfileSession(guestSnapshot));
        } catch {
          const currentTokens = await readAuthTokens();
          if (generation !== loadGeneration.current) return;
          if (currentTokens) {
            void loadRef.current();
            return;
          }
          setSession(guestProfileSession(
            createGuestSnapshot([], {}, [], []),
            "공개 정보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
          ));
        }
        return;
      }

      setSession((current) => (
        current.status === "authenticated" && current.accessToken === tokens.accessToken
          ? { ...current, message: "" }
          : loadingProfileSession()
      ));
      try {
        const next = await fetchProfileSnapshot(runtime.apiBaseUrl, tokens.accessToken, { scope });
        const currentTokens = await readAuthTokens();
        if (
          generation !== loadGeneration.current
        ) return;
        if (currentTokens?.accessToken !== tokens.accessToken) {
          setSession(loadingProfileSession());
          void loadRef.current();
          return;
        }
        setSession(authenticatedProfileSession(next, tokens.accessToken));
      } catch (error) {
        const currentTokens = await readAuthTokens();
        if (generation !== loadGeneration.current) return;
        if (error instanceof ProfileApiError && error.status === 401) {
          if (currentTokens?.accessToken && currentTokens.accessToken !== tokens.accessToken) {
            setSession(loadingProfileSession());
            void loadRef.current();
            return;
          }
          const expiredSnapshot = createGuestSnapshot([], {}, [], []);
          setSession(expiredProfileSession(expiredSnapshot, true));
          try {
            const guestSnapshot = await fetchProfileSnapshot(runtime.apiBaseUrl, undefined, { scope });
            const latestTokens = await readAuthTokens();
            if (generation !== loadGeneration.current) return;
            if (latestTokens?.accessToken && latestTokens.accessToken !== tokens.accessToken) {
              setSession(loadingProfileSession());
              void loadRef.current();
              return;
            }
            setSession(expiredProfileSession(guestSnapshot));
          } catch {
            const latestTokens = await readAuthTokens();
            if (generation !== loadGeneration.current) return;
            if (latestTokens?.accessToken && latestTokens.accessToken !== tokens.accessToken) {
              setSession(loadingProfileSession());
              void loadRef.current();
            } else {
              setSession(expiredProfileSession(expiredSnapshot));
            }
          }
          return;
        }
        if ((currentTokens?.accessToken ?? null) !== tokens.accessToken) {
          setSession(loadingProfileSession());
          void loadRef.current();
          return;
        }
        throw error;
      }
    } catch (error) {
      if (generation === loadGeneration.current) {
        const failureMessage = error instanceof Error ? error.message : "내정보를 불러오지 못했어요.";
        setSession((current) => (
          requestedAccessToken
          && current.status === "authenticated"
          && current.accessToken === requestedAccessToken
            ? { ...current, message: failureMessage }
            : failedProfileSession(failureMessage)
        ));
      }
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, [categorySettingsRevision, runtime.apiBaseUrl, scope]);
  loadRef.current = load;

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  const setSnapshot = useCallback(
    (update: SetStateAction<ProfileSnapshot | null>) => {
      setSession((current) => ({
        ...current,
        snapshot: typeof update === "function" ? update(current.snapshot) : update,
      }));
    },
    [],
  );

  return {
    status: session.status,
    snapshot: session.snapshot,
    setSnapshot,
    accessToken: session.accessToken,
    runtime,
    message: session.message,
    publicLoading: session.publicLoading,
    refreshing,
    reload,
  };
}
