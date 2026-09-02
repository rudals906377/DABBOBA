import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { seed } from "@/design-system/seed";

export function GachaMachineFrame({
  category,
  compact = false,
  children,
}: {
  category: CatalogProduct["category"];
  compact?: boolean;
  children: ReactNode;
}) {
  if (category !== "gacha") return <>{children}</>;

  return (
    <View style={[styles.cabinet, compact && styles.cabinetCompact]}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.canopy, compact && styles.canopyCompact]}
      >
        <View style={[styles.canopyIndicator, compact && styles.canopyIndicatorCompact]} />
      </View>
      {children}
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.controlPanel, compact && styles.controlPanelCompact]}
      >
        <View style={[styles.coinSlot, compact && styles.coinSlotCompact]} />
        <View style={[styles.crank, compact && styles.crankCompact]}>
          <View style={[styles.crankHandle, compact && styles.crankHandleCompact]} />
        </View>
        <View style={[styles.chute, compact && styles.chuteCompact]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cabinet: {
    alignSelf: "stretch",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: seed.color.stroke.neutral,
    borderRadius: seed.radius.r4,
    backgroundColor: seed.color.layer.default,
  },
  cabinetCompact: {
    alignSelf: "flex-start",
    flexShrink: 0,
    borderRadius: seed.radius.r3_5,
  },
  canopy: {
    height: 10,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: seed.color.stroke.muted,
    backgroundColor: seed.color.layer.default,
  },
  canopyCompact: {
    height: 7,
  },
  canopyIndicator: {
    width: "28%",
    height: 2,
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.background.brandSolid,
  },
  canopyIndicatorCompact: {
    height: 1,
  },
  controlPanel: {
    height: 25,
    paddingHorizontal: seed.spacing.x2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: seed.color.stroke.muted,
    backgroundColor: seed.color.background.neutralWeak,
  },
  controlPanelCompact: {
    height: 18,
    paddingHorizontal: seed.spacing.x1_5,
  },
  coinSlot: {
    width: 18,
    height: 3,
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.stroke.contrast,
  },
  coinSlotCompact: {
    width: 12,
    height: 2,
  },
  crank: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: seed.color.stroke.contrast,
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.layer.default,
  },
  crankCompact: {
    width: 9,
    height: 9,
  },
  crankHandle: {
    width: 7,
    height: 2,
    borderRadius: seed.radius.full,
    backgroundColor: seed.color.background.brandSolid,
    transform: [{ rotate: "-28deg" }],
  },
  crankHandleCompact: {
    width: 5,
    height: 1,
  },
  chute: {
    width: 23,
    height: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: seed.color.stroke.contrast,
    borderTopLeftRadius: seed.radius.r2,
    borderTopRightRadius: seed.radius.r2,
    borderBottomWidth: 0,
    backgroundColor: seed.color.layer.default,
  },
  chuteCompact: {
    width: 16,
    height: 7,
    borderTopLeftRadius: seed.radius.r1_5,
    borderTopRightRadius: seed.radius.r1_5,
  },
});
