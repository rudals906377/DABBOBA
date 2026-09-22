import { Image, View, type ColorValue, type ImageSourcePropType } from "react-native";
import { seed } from "@/design-system/seed";

const ROOT_OBJECT_ASSETS = {
  home: {
    inactive: require("../../assets/icons/home-chunky.png"),
    active: require("../../assets/icons/home-chunky-active.png"),
  },
  storage: {
    inactive: require("../../assets/icons/storage-chunky.png"),
    active: require("../../assets/icons/storage-chunky-active.png"),
  },
  profile: {
    inactive: require("../../assets/icons/profile-chunky.png"),
    active: require("../../assets/icons/profile-chunky-active.png"),
  },
} satisfies Record<string, { inactive: ImageSourcePropType; active: ImageSourcePropType }>;

type RootObjectIconKind = keyof typeof ROOT_OBJECT_ASSETS;

type RootObjectTabIconProps = {
  color: ColorValue;
  size: number;
  kind: RootObjectIconKind;
};

function RootObjectTabIcon({ color, size, kind }: RootObjectTabIconProps) {
  const visualSize = Math.min(30, Math.max(26, size + 5));
  const isActive = color === seed.color.foreground.brand;
  const assets = ROOT_OBJECT_ASSETS[kind];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Image
        source={isActive ? assets.active : assets.inactive}
        resizeMode="contain"
        style={{ width: visualSize, height: visualSize, opacity: isActive ? 1 : 0.78 }}
      />
    </View>
  );
}

export function HomeTabIcon(props: Omit<RootObjectTabIconProps, "kind">) {
  return <RootObjectTabIcon {...props} kind="home" />;
}

export function StorageTabIcon(props: Omit<RootObjectTabIconProps, "kind">) {
  return <RootObjectTabIcon {...props} kind="storage" />;
}

export function ProfileTabIcon(props: Omit<RootObjectTabIconProps, "kind">) {
  return <RootObjectTabIcon {...props} kind="profile" />;
}
