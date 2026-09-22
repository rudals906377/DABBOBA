import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { seed } from "@/design-system/seed";

export function KujiProductFrame({
  category,
  compact = false,
  clean = false,
  embedded = false,
  children,
}: {
  category: CatalogProduct["category"];
  compact?: boolean;
  clean?: boolean;
  embedded?: boolean;
  children: ReactNode;
}) {
  if (category !== "kuji") return <>{children}</>;
  if (clean) return <View style={styles.cleanFrame}>{children}</View>;

  return <View style={[styles.frame, compact && styles.frameCompact, embedded && styles.frameEmbedded]}>{children}</View>;
}

const styles = StyleSheet.create({
  cleanFrame: {
    alignSelf: "stretch",
    overflow: "hidden",
  },
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
  frameEmbedded: {
    borderWidth: 0,
    borderRadius: 0,
  },
});
