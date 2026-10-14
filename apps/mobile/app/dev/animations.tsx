import { Redirect } from "expo-router";

export default function AnimationCheckRoute() {
  if (!__DEV__) return <Redirect href="/(tabs)" />;
  // Packaged Metro builds replace this module with an empty production stub.
  const { DrawAnimationCheckScreen } = require("@/features/draw/DrawAnimationCheckScreen");
  return <DrawAnimationCheckScreen />;
}
