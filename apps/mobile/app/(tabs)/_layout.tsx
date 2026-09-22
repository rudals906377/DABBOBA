import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { GachaCapsuleIcon } from "@/components/GachaCapsuleIcon";
import { KujiTicketIcon } from "@/components/KujiTicketIcon";
import {
  HomeTabIcon,
  ProfileTabIcon,
  StorageTabIcon,
} from "@/components/RootObjectTabIcon";
import {
  RootFloatingTabBar,
  RootNavigationMotionProvider,
} from "@/components/RootFloatingTabBar";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

export default function RootTabs() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <RootNavigationMotionProvider>
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        tabBar={(props) => <RootFloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          animation: reduceMotion ? "none" : "fade",
          sceneStyle: { backgroundColor: seed.color.layer.basement },
          tabBarActiveTintColor: seed.color.foreground.brand,
          tabBarInactiveTintColor: seed.color.foreground.muted,
        }}
      >
        <Tabs.Screen
          name="gacha"
          options={{ title: "가챠샵", tabBarIcon: GachaCapsuleIcon }}
        />
        <Tabs.Screen
          name="kuji"
          options={{
            title: "쿠지샵",
            tabBarIcon: KujiTicketIcon,
            tabBarActiveTintColor: colors.kujiOrangeDark,
          }}
        />
        <Tabs.Screen
          name="index"
          options={{ title: "홈", tabBarIcon: HomeTabIcon }}
        />
        <Tabs.Screen
          name="storage"
          options={{ title: "보관함", tabBarIcon: StorageTabIcon }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: "내정보", tabBarIcon: ProfileTabIcon }}
        />
      </Tabs>
    </RootNavigationMotionProvider>
  );
}
