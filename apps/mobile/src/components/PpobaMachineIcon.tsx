import { StyleSheet, View, type ColorValue } from "react-native";

type PpobaMachineIconProps = {
  color: ColorValue;
  size: number;
};

const BASE_SIZE = 28;

export function PpobaMachineIcon({ color, size }: PpobaMachineIconProps) {
  const visualSize = Math.min(30, Math.max(22, size));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.iconSlot, { width: size, height: size }]}
    >
      <View style={[styles.canvas, { transform: [{ scale: visualSize / BASE_SIZE }] }]}>
        <View style={[styles.cabinet, { borderColor: color }]} />
        <View style={[styles.displayTop, { backgroundColor: color }]} />
        <View style={[styles.displayBottom, { backgroundColor: color }]} />

        <View style={[styles.controlSlot, { borderColor: color }]}>
          <View style={[styles.controlSlotMark, { backgroundColor: color }]} />
        </View>

        <View style={[styles.capsuleDial, { borderColor: color }]}>
          <View style={[styles.dialHalfLeft, { backgroundColor: color }]} />
          <View style={[styles.dialHalfRight, { backgroundColor: color }]} />
        </View>

        <View style={[styles.sideButton, { backgroundColor: color }]} />
        <View style={[styles.dispensingChute, { borderColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    width: BASE_SIZE,
    height: BASE_SIZE,
  },
  cabinet: {
    position: "absolute",
    top: 0,
    left: 1.4,
    width: 25.2,
    height: 28,
    borderWidth: 2.2,
    borderRadius: 2.4,
  },
  displayTop: {
    position: "absolute",
    top: 5.4,
    left: 3.6,
    width: 20.8,
    height: 2.1,
  },
  displayBottom: {
    position: "absolute",
    top: 14.2,
    left: 3.6,
    width: 20.8,
    height: 2.1,
  },
  controlSlot: {
    position: "absolute",
    top: 17.5,
    left: 3.9,
    width: 6.5,
    height: 4.1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderRadius: 1.4,
  },
  controlSlotMark: {
    width: 3,
    height: 1.2,
    borderRadius: 0.6,
  },
  capsuleDial: {
    position: "absolute",
    top: 17,
    left: 11,
    width: 6.1,
    height: 6.1,
    borderWidth: 1.6,
    borderRadius: 3.1,
  },
  dialHalfLeft: {
    position: "absolute",
    top: 1.1,
    left: 1,
    width: 1,
    height: 2.9,
    borderRadius: 0.5,
  },
  dialHalfRight: {
    position: "absolute",
    top: 1.1,
    right: 1,
    width: 1,
    height: 2.9,
    borderRadius: 0.5,
  },
  sideButton: {
    position: "absolute",
    top: 17.6,
    left: 20.2,
    width: 2.8,
    height: 4.2,
    borderRadius: 1.4,
  },
  dispensingChute: {
    position: "absolute",
    top: 21.9,
    left: 9.2,
    width: 9.6,
    height: 6.1,
    borderWidth: 2.1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
});
