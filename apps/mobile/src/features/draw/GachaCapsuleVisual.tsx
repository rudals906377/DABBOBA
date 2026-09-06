import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { seed } from "@/design-system/seed";
import type { GachaCapsuleTone } from "@/features/draw/gacha-capsule-motion";
import { getGachaCapsuleSilhouette } from "@/features/draw/gacha-capsule-silhouette";

type GachaCapsuleVisualProps = {
  tone: GachaCapsuleTone;
  depth?: number;
  split?: boolean;
  heroDetail?: boolean;
  /** Untransformed layout size; no per-frame measurement is needed. */
  diameter?: number;
  style?: StyleProp<ViewStyle>;
  upperStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  lowerStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  testID?: string;
};

const PALETTES = {
  lime: {
    upper: "#C9F45A",
    lower: "#78B727",
    seam: "#E9FDB0",
    border: "#3D571C",
    cavity: "#15210D",
  },
  ivory: {
    upper: "#FFF2D0",
    lower: "#D7BB83",
    seam: "#FFF8E7",
    border: "#806F51",
    cavity: "#241D14",
  },
} as const;

export function GachaCapsuleVisual({
  tone,
  depth = 2,
  split = false,
  heroDetail = false,
  diameter = 200,
  style,
  upperStyle,
  lowerStyle,
  testID,
}: GachaCapsuleVisualProps) {
  const palette = PALETTES[tone];
  const depthShadeOpacity = depth >= 2 ? 0.01 : depth === 1 ? 0.05 : 0.13;
  const highlightOpacity = depth >= 2 ? 0.9 : depth === 1 ? 0.72 : 0.5;
  // Keep the small poured pile's molded base; only the hero is now spherical.
  const silhouette = getGachaCapsuleSilhouette(diameter, heroDetail);
  const upperRadius = silhouette.borderTopLeftRadius;
  const lowerRadius = silhouette.borderBottomLeftRadius;

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.root,
        silhouette,
        { borderColor: palette.border },
        split && styles.splitRoot,
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.upperHalf,
          split && styles.splitUpperHalf,
          split && { borderTopLeftRadius: upperRadius, borderTopRightRadius: upperRadius },
          split && heroDetail && styles.heroSplitHalf,
          { backgroundColor: palette.upper, borderColor: palette.border },
          upperStyle,
        ]}
      >
        {heroDetail ? <View style={styles.upperMaterialDepth} /> : null}
        <View style={[styles.highlight, { opacity: highlightOpacity }]} />
        <View style={[styles.highlightPixel, { opacity: highlightOpacity * 0.72 }]} />
        {heroDetail ? (
          <>
            <View style={styles.heroGlossStepWide} />
            <View style={styles.heroGlossStepMedium} />
            <View style={styles.heroGlossStepSmall} />
            <View style={styles.heroUpperBounceLight} />
          </>
        ) : null}
        <View style={styles.upperSideShade} />
        {split ? heroDetail ? (
          <>
            <View style={[styles.heroUpperCavity, { backgroundColor: palette.cavity }]} />
            <View style={[styles.heroUpperInnerLip, { backgroundColor: palette.seam }]} />
          </>
        ) : (
          <>
            <View style={[styles.splitUpperSeamShadow, { backgroundColor: palette.border }]} />
            <View style={[styles.splitUpperSeam, { backgroundColor: palette.seam }]} />
          </>
        ) : null}
      </Animated.View>
      <Animated.View
        style={[
          styles.lowerHalf,
          split && styles.splitLowerHalf,
          split && { borderBottomLeftRadius: lowerRadius, borderBottomRightRadius: lowerRadius },
          split && heroDetail && styles.heroSplitHalf,
          { backgroundColor: palette.lower, borderColor: palette.border },
          lowerStyle,
        ]}
      >
        <View style={styles.lowerRoundShade} />
        {heroDetail ? (
          <>
            <View style={styles.heroLowerCoreShade} />
            <View style={styles.heroLowerBounceLight} />
            <View style={styles.heroMakerMark}>
              <View style={styles.heroMakerMarkStem} />
              <View style={styles.heroMakerMarkBowl} />
            </View>
          </>
        ) : null}
        <View style={styles.lowerSideShade} />
        <View style={styles.bottomShade} />
        {split ? heroDetail ? (
          <>
            <View style={[styles.heroLowerCavity, { backgroundColor: palette.cavity }]} />
            <View style={[styles.heroLowerInnerLip, { backgroundColor: palette.seam }]} />
          </>
        ) : <View style={[styles.splitLowerSeam, { backgroundColor: palette.border }]} /> : null}
      </Animated.View>
      {!split ? (
        <>
          <View style={[styles.seamShadow, heroDetail && styles.heroSeamShadow, { backgroundColor: palette.border }]} />
          <View style={[styles.seam, heroDetail && styles.heroSeam, { backgroundColor: palette.seam }]} />
          {heroDetail ? (
            <>
              <View style={[styles.heroCouplingLip, { backgroundColor: palette.seam }]} />
              <View style={[styles.heroCouplingCore, { backgroundColor: palette.border }]} />
              <View style={[styles.heroCouplingGroove, { backgroundColor: palette.cavity }]} />
              <View style={[styles.heroCouplingLatchLeft, { backgroundColor: palette.seam }]} />
              <View style={[styles.heroCouplingLatchRight, { backgroundColor: palette.seam }]} />
            </>
          ) : null}
          <View style={[styles.innerRim, silhouette]} />
          <View style={[styles.depthShade, silhouette, { opacity: depthShadeOpacity }]} />
        </>
      ) : null}
      {heroDetail && !split ? (
        <>
          <View style={[styles.heroLightRim, silhouette]} />
          <View style={[styles.heroDarkRim, silhouette]} />
          <View style={styles.heroPixelEdgeTop} />
          <View style={styles.heroPixelEdgeBottom} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    height: "100%",
    borderRadius: seed.radius.full,
    borderWidth: 0.75,
    borderColor: "transparent",
    overflow: "hidden",
  },
  splitRoot: {
    borderWidth: 0,
    overflow: "visible",
  },
  upperHalf: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "52%",
  },
  lowerHalf: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  splitUpperHalf: {
    borderWidth: 0.75,
    borderBottomWidth: 0,
    borderTopLeftRadius: seed.radius.full,
    borderTopRightRadius: seed.radius.full,
    overflow: "hidden",
  },
  splitLowerHalf: {
    borderWidth: 0.75,
    borderTopWidth: 0,
    borderBottomLeftRadius: seed.radius.full,
    borderBottomRightRadius: seed.radius.full,
    overflow: "hidden",
  },
  heroSplitHalf: {
    borderWidth: 0.75,
  },
  seam: {
    position: "absolute",
    left: 1,
    right: 1,
    top: "47%",
    height: "6%",
    minHeight: 1,
    borderRadius: 1,
  },
  seamShadow: {
    position: "absolute",
    left: 1,
    right: 1,
    top: "52%",
    height: "5%",
    minHeight: 1,
    opacity: 0.48,
  },
  heroSeam: { top: "49%", height: "1%", minHeight: 0.5 },
  heroSeamShadow: { top: "50%", height: "1%", minHeight: 0.5 },
  splitUpperSeam: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "8%",
    minHeight: 1,
  },
  splitUpperSeamShadow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "14%",
    minHeight: 1,
    opacity: 0.48,
  },
  splitLowerSeam: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "7%",
    minHeight: 1,
    opacity: 0.48,
  },
  heroUpperCavity: {
    position: "absolute",
    left: "1%",
    right: "1%",
    bottom: 0,
    height: "16%",
  },
  heroUpperInnerLip: {
    position: "absolute",
    left: "1%",
    right: "1%",
    bottom: "15%",
    height: "1.5%",
    minHeight: 0.75,
  },
  heroLowerCavity: {
    position: "absolute",
    left: "1%",
    right: "1%",
    top: 0,
    height: "16%",
  },
  heroLowerInnerLip: {
    position: "absolute",
    left: "1%",
    right: "1%",
    top: "15%",
    height: "1.5%",
    minHeight: 0.75,
  },
  highlight: {
    position: "absolute",
    left: "23%",
    top: "20%",
    width: "18%",
    height: "22%",
    borderRadius: 1,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
  },
  highlightPixel: {
    position: "absolute",
    left: "17%",
    top: "48%",
    width: "12%",
    height: "11%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  upperMaterialDepth: {
    position: "absolute",
    left: "8%",
    right: "8%",
    bottom: 0,
    height: "18%",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  heroGlossStepWide: {
    position: "absolute",
    left: "22%",
    top: "13%",
    width: "34%",
    height: "7%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.58)",
  },
  heroGlossStepMedium: {
    position: "absolute",
    left: "17%",
    top: "21%",
    width: "22%",
    height: "9%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.76)",
  },
  heroGlossStepSmall: {
    position: "absolute",
    left: "14%",
    top: "32%",
    width: "10%",
    height: "9%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  heroUpperBounceLight: {
    position: "absolute",
    right: "12%",
    bottom: "8%",
    width: "24%",
    height: "8%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  upperSideShade: {
    position: "absolute",
    right: 0,
    top: "25%",
    width: "12%",
    height: "64%",
    backgroundColor: "rgba(9, 13, 10, 0.18)",
  },
  lowerRoundShade: {
    position: "absolute",
    right: "-8%",
    bottom: "-10%",
    width: "64%",
    height: "104%",
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(15, 20, 16, 0.14)",
  },
  heroLowerCoreShade: {
    position: "absolute",
    left: "16%",
    top: "15%",
    width: "72%",
    height: "72%",
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(11, 15, 12, 0.08)",
  },
  heroLowerBounceLight: {
    position: "absolute",
    left: "16%",
    bottom: "12%",
    width: "30%",
    height: "7%",
    minHeight: 1,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
  heroMakerMark: {
    position: "absolute",
    left: "43%",
    top: "25%",
    width: "16%",
    height: "28%",
    opacity: 0.32,
  },
  heroMakerMarkStem: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "27%",
    minWidth: 1,
    backgroundColor: "#172018",
  },
  heroMakerMarkBowl: {
    position: "absolute",
    left: "20%",
    top: 0,
    width: "80%",
    height: "100%",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: "#172018",
    borderTopRightRadius: seed.radius.full,
    borderBottomRightRadius: seed.radius.full,
  },
  lowerSideShade: {
    position: "absolute",
    right: 0,
    top: 0,
    width: "12%",
    height: "72%",
    backgroundColor: "rgba(9, 13, 10, 0.18)",
  },
  bottomShade: {
    position: "absolute",
    left: "18%",
    right: "12%",
    bottom: 0,
    height: "13%",
    minHeight: 1,
    backgroundColor: "rgba(8, 12, 9, 0.2)",
  },
  heroCouplingLip: {
    position: "absolute",
    left: "5%",
    right: "5%",
    top: "49%",
    height: "0.75%",
    minHeight: 0.5,
  },
  heroCouplingCore: {
    position: "absolute",
    left: "2%",
    right: "2%",
    top: "49.75%",
    height: "0.75%",
    minHeight: 0.5,
    opacity: 0.72,
  },
  heroCouplingGroove: {
    position: "absolute",
    left: "7%",
    right: "7%",
    top: "50.5%",
    height: "0.5%",
    minHeight: 0.5,
    opacity: 0.78,
  },
  heroCouplingLatchLeft: {
    position: "absolute",
    left: 0,
    top: "49%",
    width: "8%",
    height: "2%",
    minWidth: 2,
    minHeight: 1,
  },
  heroCouplingLatchRight: {
    position: "absolute",
    right: 0,
    top: "49%",
    width: "8%",
    height: "2%",
    minWidth: 2,
    minHeight: 1,
  },
  innerRim: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderRadius: seed.radius.full,
    borderColor: "rgba(255, 255, 255, 0.17)",
  },
  depthShade: {
    ...StyleSheet.absoluteFill,
    borderRadius: seed.radius.full,
    backgroundColor: "#08100B",
  },
  heroLightRim: {
    ...StyleSheet.absoluteFill,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: "rgba(255, 255, 255, 0.5)",
    borderLeftColor: "rgba(255, 255, 255, 0.24)",
    borderRadius: seed.radius.full,
  },
  heroDarkRim: {
    ...StyleSheet.absoluteFill,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderRightColor: "rgba(14, 20, 15, 0.42)",
    borderBottomColor: "rgba(14, 20, 15, 0.56)",
    borderRadius: seed.radius.full,
  },
  heroPixelEdgeTop: {
    position: "absolute",
    left: "30%",
    top: 0,
    width: "40%",
    height: 2,
    backgroundColor: "rgba(255, 255, 255, 0.34)",
  },
  heroPixelEdgeBottom: {
    position: "absolute",
    left: "30%",
    bottom: 0,
    width: "40%",
    height: 3,
    backgroundColor: "rgba(8, 12, 9, 0.38)",
  },
});
