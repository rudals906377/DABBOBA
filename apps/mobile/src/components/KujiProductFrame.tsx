import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { seed } from "@/design-system/seed";

export function KujiProductFrame({
  category,
  compact = false,
  children,
}: {
  category: CatalogProduct["category"];
  compact?: boolean;
  children: ReactNode;
}) {
  if (category !== "kuji") return <>{children}</>;

  return <View style={[styles.frame, compact && styles.frameCompact]}>{children}</View>;
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: "stretch",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    borderRadius: seed.radius.r4,
  },
  frameCompact: {
    alignSelf: "flex-start",
    flexShrink: 0,
    borderRadius: seed.radius.r3_5,
  },
});
