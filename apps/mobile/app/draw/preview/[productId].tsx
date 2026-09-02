import { Redirect } from "expo-router";
import { DrawRevealScreen } from "@/features/draw/DrawRevealScreen";

export default function DrawPreviewRoute() {
  if (!__DEV__) return <Redirect href="/(tabs)/ppoba" />;
  return <DrawRevealScreen preview />;
}
