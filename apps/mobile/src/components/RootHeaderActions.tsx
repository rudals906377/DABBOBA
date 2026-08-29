import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { SeedIconButton } from "@/design-system/components";
import { seed } from "@/design-system/seed";

const PRODUCT_HISTORY_CAPSULE = require("../../assets/product-history-capsule.png");

const CAPSULE_OUTLINE_OFFSETS = [
  [-0.8, 0],
  [0.8, 0],
  [0, -0.8],
  [0, 0.8],
  [-0.57, -0.57],
  [0.57, -0.57],
  [-0.57, 0.57],
  [0.57, 0.57],
] as const;

const ACTIONS: ReadonlyArray<{
  label: string;
  route: "/search" | "/product-history" | "/notifications";
  icon: "search-outline" | "notifications-outline" | "product-capsule";
}> = [
  { label: "검색 열기", route: "/search", icon: "search-outline" },
  { label: "알림함 열기", route: "/notifications", icon: "notifications-outline" },
  { label: "상품 기록 열기", route: "/product-history", icon: "product-capsule" },
];

export function RootHeaderActions() {
  const router = useRouter();

  return (
    <View style={styles.actions}>
      {ACTIONS.map((action) => (
        <SeedIconButton
          key={action.label}
          label={action.label}
          onPress={() => router.push(action.route as Href)}
        >
          {action.icon === "product-capsule" ? (
            <ProductHistoryCapsuleIcon />
          ) : (
            <Ionicons name={action.icon} size={23} color={seed.color.foreground.neutral} />
          )}
        </SeedIconButton>
      ))}
    </View>
  );
}

function ProductHistoryCapsuleIcon() {
  return (
    <View style={styles.capsuleFrame}>
      {CAPSULE_OUTLINE_OFFSETS.map(([translateX, translateY]) => (
        <Image
          key={`${translateX}:${translateY}`}
          source={PRODUCT_HISTORY_CAPSULE}
          resizeMode="contain"
          style={[
            styles.capsuleOutline,
            { transform: [{ translateX }, { translateY }] },
          ]}
        />
      ))}
      <Image source={PRODUCT_HISTORY_CAPSULE} resizeMode="contain" style={styles.capsuleImage} />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  capsuleFrame: {
    width: 25,
    height: 25,
    transform: [{ rotate: "15deg" }],
  },
  capsuleOutline: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 25,
    height: 25,
    tintColor: seed.color.foreground.neutral,
  },
  capsuleImage: { width: 25, height: 25 },
});
