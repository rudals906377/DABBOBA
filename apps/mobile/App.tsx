import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";
import {
  APP_READY_INJECTION_SCRIPT,
  classifyNavigationRequest,
  createDeepLinkTarget,
  isAllowedWebUrl,
  parseDabbobaDeepLink,
  parseWebBridgeMessage,
  resolveShellConfiguration,
  serializeDeepLinkMessage,
  type DeepLinkTarget,
  type ShellConfiguration,
  type ShellPlatform,
} from "./webShell";

const DABBOBA_WORDMARK = require("./assets/brand/dabboba-wordmark.png");
const SHELL_PLATFORM: ShellPlatform = Platform.OS === "android" ? "android" : "ios";

type ShellResolution =
  | { configuration: ShellConfiguration; error: "" }
  | { configuration: null; error: string };

function resolveConfiguration(): ShellResolution {
  try {
    return {
      configuration: resolveShellConfiguration({
        configuredUrl: process.env.EXPO_PUBLIC_DABBOBA_WEB_URL,
        configuredAllowedOrigins: process.env.EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS,
        metroHostUri: Constants.expoConfig?.hostUri,
        platform: SHELL_PLATFORM,
        development: __DEV__,
      }),
      error: "",
    };
  } catch (error) {
    return {
      configuration: null,
      error: error instanceof Error ? error.message : "DABBOBA 웹 주소 설정을 확인해 주세요.",
    };
  }
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const webViewReadyRef = useRef(false);
  const pendingDeepLinkRef = useRef<DeepLinkTarget | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const shellResolution = useMemo(resolveConfiguration, []);
  const shellConfiguration = shellResolution.configuration;
  const [loadError, setLoadError] = useState(shellResolution.error);
  const webUrl = shellConfiguration?.webUrl ?? "";

  const deliverDeepLink = useCallback((target: DeepLinkTarget) => {
    pendingDeepLinkRef.current = target;
    if (!webViewReadyRef.current || !webViewRef.current) return;
    webViewRef.current.postMessage(serializeDeepLinkMessage(target));
    pendingDeepLinkRef.current = null;
  }, []);

  const markWebViewReady = useCallback(() => {
    webViewReadyRef.current = true;
    const pendingTarget = pendingDeepLinkRef.current;
    if (pendingTarget) deliverDeepLink(pendingTarget);
  }, [deliverDeepLink]);

  const openExternalUrl = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      setLoadError("외부 링크를 열 수 없습니다.");
    });
  }, []);

  const handleRequestedNavigation = useCallback(
    (rawUrl: string) => {
      if (!shellConfiguration) return false;
      const decision = classifyNavigationRequest(
        rawUrl,
        shellConfiguration.allowedOrigins,
        shellConfiguration.baseOrigin,
        SHELL_PLATFORM,
      );

      if (decision.action === "allow") return true;
      if (decision.action === "open-external") {
        openExternalUrl(decision.url);
      } else if (decision.action === "dispatch-deep-link") {
        deliverDeepLink(decision.target);
      }
      return false;
    },
    [deliverDeepLink, openExternalUrl, shellConfiguration],
  );

  const handleBridgeMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (
        !shellConfiguration ||
        !isAllowedWebUrl(event.nativeEvent.url, [shellConfiguration.baseOrigin])
      ) {
        return;
      }

      const message = parseWebBridgeMessage(event.nativeEvent.data);
      if (!message) return;

      if (message.type === "APP_READY") {
        markWebViewReady();
      } else if (message.type === "OPEN_EXTERNAL_URL") {
        openExternalUrl(message.payload.url);
      } else if (message.type === "NAVIGATE") {
        deliverDeepLink(
          createDeepLinkTarget(
            message.payload.route,
            shellConfiguration.baseOrigin,
            SHELL_PLATFORM,
          ),
        );
      }
    },
    [deliverDeepLink, markWebViewReady, openExternalUrl, shellConfiguration],
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  useEffect(() => {
    if (!shellConfiguration) return;

    let active = true;
    const handleDeepLink = (rawUrl: string) => {
      const target = parseDabbobaDeepLink(
        rawUrl,
        shellConfiguration.baseOrigin,
        SHELL_PLATFORM,
      );
      if (target) deliverDeepLink(target);
    };

    void Linking.getInitialURL()
      .then((initialUrl) => {
        if (active && initialUrl) handleDeepLink(initialUrl);
      })
      .catch(() => undefined);

    const subscription = Linking.addEventListener("url", ({ url }) => handleDeepLink(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [deliverDeepLink, shellConfiguration]);

  const handleNavigation = (navigation: WebViewNavigation) => {
    if (
      !shellConfiguration ||
      !isAllowedWebUrl(navigation.url, shellConfiguration.allowedOrigins)
    ) {
      return;
    }
    setCanGoBack(navigation.canGoBack);
    setLoadError("");
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        {shellConfiguration ? (
          <WebView
            ref={webViewRef}
            source={{ uri: webUrl }}
            style={styles.webView}
            // The library auto-opens URLs rejected by originWhitelist. Route every scheme
            // through the callback so unknown schemes can be blocked instead.
            originWhitelist={["*"]}
            onShouldStartLoadWithRequest={(request) => handleRequestedNavigation(request.url)}
            onMessage={handleBridgeMessage}
            onLoadStart={(event) => {
              if (isAllowedWebUrl(event.nativeEvent.url, shellConfiguration.allowedOrigins)) {
                webViewReadyRef.current = false;
              }
            }}
            injectedJavaScript={APP_READY_INJECTION_SCRIPT}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows={false}
            onNavigationStateChange={handleNavigation}
            onError={(event) =>
              setLoadError(event.nativeEvent.description || "웹앱을 불러오지 못했습니다.")
            }
            renderLoading={() => <LoadingView label="DABBOBA를 불러오는 중" />}
            startInLoadingState
          />
        ) : null}
        {loadError ? (
          <View style={styles.errorLayer}>
            <Image
              source={DABBOBA_WORDMARK}
              style={styles.errorWordmark}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityLabel="DABBOBA"
            />
            <Text style={styles.errorTitle}>웹앱에 연결할 수 없어요.</Text>
            <Text style={styles.errorBody}>{loadError}</Text>
            <Text style={styles.errorUrl}>
              {webUrl || "EXPO_PUBLIC_DABBOBA_WEB_URL"}
            </Text>
            {shellConfiguration ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                onPress={() => {
                  setLoadError("");
                  webViewRef.current?.reload();
                }}
              >
                <Text style={styles.retryLabel}>다시 연결</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function LoadingView({ label }: { label: string }) {
  return (
    <View style={styles.loadingLayer}>
      <Image
        source={DABBOBA_WORDMARK}
        style={styles.loadingWordmark}
        resizeMode="contain"
        fadeDuration={0}
        accessibilityLabel="DABBOBA"
      />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F1",
  },
  webView: {
    flex: 1,
    backgroundColor: "#F5F5F1",
  },
  loadingLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#F5F5F1",
  },
  loadingWordmark: {
    width: 195,
    height: 26,
  },
  errorWordmark: {
    width: 180,
    height: 24,
  },
  loadingLabel: {
    color: "#687068",
    fontSize: 13,
    fontWeight: "600",
  },
  errorLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "#F5F5F1",
  },
  errorTitle: {
    marginTop: 24,
    color: "#141714",
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
  },
  errorBody: {
    marginTop: 8,
    color: "#687068",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  errorUrl: {
    marginTop: 10,
    color: "#858B85",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 150,
    minHeight: 50,
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#91E98E",
  },
  retryButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  retryLabel: {
    color: "#141714",
    fontSize: 15,
    fontWeight: "800",
  },
});
