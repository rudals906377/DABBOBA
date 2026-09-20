import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View, type ImageProps } from "react-native";
import {
  CatalogProductImage,
  type CatalogProductImageFallback,
} from "@/components/CatalogProductImage";
import {
  MIN_SAFE_COVER_VISIBLE_FRACTION,
  catalogArtworkVisibleFraction,
} from "@/components/catalog-discovery-image-state";
import { seed } from "@/design-system/seed";

export function CatalogDiscoveryImage({
  storefrontUri,
  primaryUri,
  requestKey = 0,
  targetAspectRatio,
}: {
  storefrontUri: string | null;
  primaryUri: string | null;
  requestKey?: string | number;
  targetAspectRatio: number;
}) {
  const presentationUri = storefrontUri ?? primaryUri;
  const [primaryResizeMode, setPrimaryResizeMode] = useState<NonNullable<ImageProps["resizeMode"]>>("contain");

  useEffect(() => {
    setPrimaryResizeMode("contain");
  }, [primaryUri, requestKey, storefrontUri, targetAspectRatio]);

  const handleDimensions = useCallback((width: number, height: number) => {
    const visibleFraction = catalogArtworkVisibleFraction(width, height, targetAspectRatio);
    setPrimaryResizeMode(
      visibleFraction >= MIN_SAFE_COVER_VISIBLE_FRACTION ? "cover" : "contain",
    );
  }, [targetAspectRatio]);

  const fallbackSources: CatalogProductImageFallback[] = storefrontUri && primaryUri
    ? [{ uri: primaryUri, resizeMode: "contain" }]
    : [];

  return (
    <View style={styles.container}>
      <CatalogProductImage
        uri={presentationUri}
        requestKey={requestKey}
        resizeMode={primaryResizeMode}
        fallbackSources={fallbackSources}
        onDimensions={handleDimensions}
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: seed.color.background.neutralWeak,
  },
  image: { width: "100%", height: "100%" },
});
