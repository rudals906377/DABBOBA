import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function RootTabs() {
  return (
    <Tabs
      initialRouteName="index"
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.greenInk,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: {
          minHeight: 68,
          paddingTop: 7,
          paddingBottom: 7,
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
        },
      }}
    >
      <Tabs.Screen
        name="exchange"
        options={{ title: "교환방", tabBarIcon: tabIcon("swap-horizontal-outline") }}
      />
      <Tabs.Screen
        name="ppoba"
        options={{ title: "뽀바", tabBarIcon: tabIcon("storefront-outline") }}
      />
      <Tabs.Screen
        name="index"
        options={{ title: "홈", tabBarIcon: tabIcon("home-outline") }}
      />
      <Tabs.Screen
        name="dukroom"
        options={{ title: "덕룸", tabBarIcon: tabIcon("grid-outline") }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "프로필", tabBarIcon: tabIcon("person-circle-outline") }}
      />
    </Tabs>
  );
}
