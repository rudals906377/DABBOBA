import { Redirect } from "expo-router";
import { KujiDrawScreen } from "@/features/kuji/KujiDrawScreen";

export default function KujiDrawRoute() {
  if (!__DEV__) return <Redirect href="/(tabs)/ppoba" />;
  return <KujiDrawScreen />;
}
