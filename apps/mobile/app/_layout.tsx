import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { initializeLocalDatabase } from "@/lib/local-database";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.canvas} />
      <Suspense fallback={<AppBootFallback />}>
        <SQLiteProvider
          databaseName="dabboba-local.db"
          onInit={initializeLocalDatabase}
          useSuspense
        >
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }} />
        </SQLiteProvider>
      </Suspense>
    </>
  );
}

function AppBootFallback() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { backgroundColor: colors.canvas },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
});
