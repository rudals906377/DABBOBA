import { Redirect } from "expo-router";

export default function HomeDeepLinkRoute() {
  return <Redirect href="/(tabs)" />;
}
