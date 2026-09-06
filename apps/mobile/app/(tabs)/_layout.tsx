import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { PpobaMachineIcon } from "@/components/PpobaMachineIcon";
import {
  RootFloatingTabBar,
  RootNavigationMotionProvider,
} from "@/components/RootFloatingTabBar";
import { seed } from "@/design-system/seed";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function RootTabs() {
  return (
    <RootNavigationMotionProvider>
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        tabBar={(props) => <RootFloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: seed.color.layer.basement },
          tabBarActiveTintColor: seed.color.foreground.brand,
          tabBarInactiveTintColor: seed.color.foreground.muted,
        }}
      >
        <Tabs.Screen
          name="exchange"
          options={{ title: "교환방", tabBarIcon: tabIcon("swap-horizontal-outline") }}
        />
        <Tabs.Screen
          name="ppoba"
          options={{ title: "뽀바", tabBarIcon: PpobaMachineIcon }}
        />
        <Tabs.Screen
          name="index"
          options={{ title: "홈", tabBarIcon: tabIcon("home-outline") }}
        />
        <Tabs.Screen
          name="dukroom"
          options={{ title: "보관함", tabBarIcon: tabIcon("cube-outline") }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: "내정보", tabBarIcon: tabIcon("person-circle-outline") }}
        />
      </Tabs>
    </RootNavigationMotionProvider>
  );
}
