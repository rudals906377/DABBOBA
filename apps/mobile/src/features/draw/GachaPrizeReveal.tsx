import { useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { DecorativeIonicon } from "@/components/DecorativeIonicon";
import { KoreanPixelTitle } from "@/components/RootCategoryTitle";
import { AppText, BalancedAppText } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import type { DrawResult } from "@/features/draw/draw-reveal-api";
import { sampleGachaRevealLighting } from "@/features/draw/gacha-reveal-timeline";
import { productSubjectTitle } from "@/features/shop/product-title";

export type GachaPrizeRevealProps = {
  result: DrawResult | null;
  imageUri?: string | null;
  ipName?: string;
  previewLabel?: string;
  progress: SharedValue<number>;
  reduceMotion: boolean;
  settled?: boolean;
};

/** The cinematic and completed screen share this exact, motion-free prize layout. */
export function GachaPrizeReveal({
  result,
  imageUri,
  ipName,
  previewLabel = "RESULT 01",
  progress,
  reduceMotion,
  settled = false,
}: GachaPrizeRevealProps) {
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const [loadedImageKey, setLoadedImageKey] = useState<string | null>(null);
  const resolvedImageUri = imageUri?.trim() || null;
  const imageKey = `${result?.id ?? "preview"}:${resolvedImageUri ?? ""}`;
  const activeImageKey = useRef(imageKey);
  activeImageKey.current = imageKey;
  // Keyed status resets on the next prize without restarting the settled image.
  const imageUnavailable = !resolvedImageUri || failedImageKey === imageKey;
  const imageLoaded = loadedImageKey === imageKey;
  const normalizedIpName = ipName?.trim() || undefined;
  const neutralPreviewLabel = /^RESULT\s+\d{1,2}$/.test(previewLabel.trim())
    ? previewLabel.trim()
    : "RESULT 01";
  const revealStyle = useAnimatedStyle(() => ({
    opacity: settled ? 1 : sampleGachaRevealLighting(progress.value, reduceMotion).prizeOpacity,
  }));

  return (
    <Animated.View
      testID="gacha-prize-reveal"
      pointerEvents="none"
      accessibilityElementsHidden={!settled}
      importantForAccessibility={settled ? "auto" : "no-hide-descendants"}
      style={[styles.container, revealStyle]}
    >
      <View style={styles.imageSlot}>
        {result && resolvedImageUri && !imageUnavailable ? (
          <>
            {imageLoaded ? <View pointerEvents="none" style={styles.contactShadow} /> : null}
            <Image
              key={imageKey}
              source={{ uri: resolvedImageUri }}
              resizeMode="contain"
              fadeDuration={0}
              accessible={false}
              onLoad={() => {
                if (activeImageKey.current === imageKey) setLoadedImageKey(imageKey);
              }}
              onError={() => {
                if (activeImageKey.current === imageKey) setFailedImageKey(imageKey);
              }}
              style={[styles.prizeImage, { opacity: imageLoaded ? 1 : 0 }]}
            />
            {!imageLoaded ? (
              <View style={[styles.placeholder, styles.loadingPlaceholder]}>
                <DecorativeIonicon name="image-outline" size={44} color={seed.color.foreground.muted} />
                <AppText style={styles.imageError}>상품 이미지를 불러오는 중이에요</AppText>
              </View>
            ) : null}
          </>
        ) : result ? (
          <View style={styles.placeholder}>
            <DecorativeIonicon name="image-outline" size={44} color={seed.color.foreground.muted} />
            <AppText style={styles.imageError}>상품 이미지를 불러오지 못했어요</AppText>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <DecorativeIonicon name="gift-outline" size={64} color={seed.color.foreground.muted} />
          </View>
        )}
      </View>

      <View style={styles.copy}>
        {result ? (
          <>
            {normalizedIpName ? <AppText style={styles.ipName}>{normalizedIpName}</AppText> : null}
            <BalancedAppText style={styles.prizeName}>
              {productSubjectTitle(result.prizeName, normalizedIpName)}
            </BalancedAppText>
          </>
        ) : (
          <KoreanPixelTitle variant="compact" style={styles.previewLabel}>
            {neutralPreviewLabel}
          </KoreanPixelTitle>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: seed.spacing.x6,
    paddingVertical: seed.spacing.x6,
  },
  imageSlot: {
    width: "100%",
    height: "58%",
    maxWidth: 380,
    maxHeight: 380,
    alignItems: "center",
    justifyContent: "center",
  },
  prizeImage: {
    width: "100%",
    height: "100%",
  },
  contactShadow: {
    position: "absolute",
    bottom: seed.spacing.x0_5,
    width: 96,
    height: 5,
    borderRadius: seed.radius.full,
    backgroundColor: "rgba(17, 20, 17, 0.045)",
    shadowColor: seed.color.foreground.neutral,
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: seed.spacing.x3,
  },
  loadingPlaceholder: {
    ...StyleSheet.absoluteFill,
  },
  imageError: {
    color: seed.color.foreground.muted,
    ...seed.typography.caption,
    textAlign: "center",
  },
  copy: {
    width: "100%",
    maxWidth: 380,
    marginTop: seed.spacing.x5,
    alignItems: "center",
    gap: seed.spacing.x1_5,
  },
  ipName: {
    color: seed.color.foreground.muted,
    ...seed.typography.caption,
    textAlign: "center",
  },
  prizeName: {
    color: seed.color.foreground.neutral,
    ...seed.typography.sectionTitle,
    textAlign: "center",
  },
  previewLabel: {
    color: seed.color.foreground.neutral,
  },
});
