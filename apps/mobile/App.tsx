import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

const WEB_PORT = 4174;
const DABBOBA_WORDMARK = require("./assets/dabboba-wordmark.png");

function withEmbedParams(baseUrl: string) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}embed=1&platform=${Platform.OS}`;
}

function resolveWebUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_DABBOBA_WEB_URL?.trim();
  if (configuredUrl) return withEmbedParams(configuredUrl.replace(/\/$/, ""));

  const metroHost = Constants.expoConfig?.hostUri?.split(":")[0];
  if (metroHost) return withEmbedParams(`http://${metroHost}:${WEB_PORT}`);

  const simulatorHost = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
  return withEmbedParams(`http://${simulatorHost}:${WEB_PORT}`);
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState("");
  const webUrl = useMemo(resolveWebUrl, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  const handleNavigation = (navigation: WebViewNavigation) => {
    setCanGoBack(navigation.canGoBack);
    setLoadError("");
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor="#F5F5F1" />
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        <WebView
          ref={webViewRef}
          source={{ uri: webUrl }}
          style={styles.webView}
          originWhitelist={["http://*", "https://*"]}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          onNavigationStateChange={handleNavigation}
          onError={(event) => setLoadError(event.nativeEvent.description || "웹앱을 불러오지 못했습니다.")}
          renderLoading={() => <LoadingView label="DABBOBA를 불러오는 중" />}
          startInLoadingState
        />
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
            <Text style={styles.errorUrl}>{webUrl}</Text>
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
    ...StyleSheet.absoluteFillObject,
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
    ...StyleSheet.absoluteFillObject,
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
