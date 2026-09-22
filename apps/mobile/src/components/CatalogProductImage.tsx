import { useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  type ImageProps,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { AppText as Text } from "@/components/Typography";
import { catalogProductImageRequestId } from "@/components/catalog-product-image-state";
import { seed } from "@/design-system/seed";
import { colors } from "@/theme";

export type CatalogProductImageFallback = {
  uri: string | null;
  resizeMode?: NonNullable<ImageProps["resizeMode"]>;
};

export function CatalogProductImage({
  uri,
  requestKey = 0,
  resizeMode,
  style,
  onDimensions,
  fallbackSources = [],
}: {
  uri: string | null;
  requestKey?: string | number;
  resizeMode: NonNullable<ImageProps["resizeMode"]>;
  style: StyleProp<ImageStyle>;
  onDimensions?: (width: number, height: number) => void;
  fallbackSources?: readonly CatalogProductImageFallback[];
}) {
  const candidates: Array<{
    uri: string;
    resizeMode: NonNullable<ImageProps["resizeMode"]>;
    requestId: string;
  }> = [];
  const seenUris = new Set<string>();
  for (const source of [{ uri, resizeMode }, ...fallbackSources.map((fallback) => ({
    uri: fallback.uri,
    resizeMode: fallback.resizeMode ?? resizeMode,
  }))]) {
    if (!source.uri || seenUris.has(source.uri)) continue;
    const requestId = catalogProductImageRequestId(source.uri, requestKey);
    if (!requestId) continue;
    seenUris.add(source.uri);
    candidates.push({ uri: source.uri, resizeMode: source.resizeMode, requestId });
  }
  const [failedRequestIds, setFailedRequestIds] = useState<readonly string[]>([]);
  const [loadedRequestId, setLoadedRequestId] = useState<string | null>(null);
  const activeCandidate = candidates.find((candidate) => !failedRequestIds.includes(candidate.requestId));

  if (!activeCandidate) {
    return (
      <CatalogImagePlaceholder failed={candidates.length > 0} />
    );
  }

  const requestId = activeCandidate.requestId;

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.imageContainer}
    >
      <Image
        key={requestId}
        accessible={false}
        source={{ uri: activeCandidate.uri }}
        resizeMode={activeCandidate.resizeMode}
        style={style}
        onLoad={({ nativeEvent }) => {
          const { width, height } = nativeEvent.source;
          if (width > 0 && height > 0) onDimensions?.(width, height);
          setLoadedRequestId(requestId);
        }}
        onError={() => {
          setLoadedRequestId(null);
          setFailedRequestIds((current) => current.includes(requestId) ? current : [...current, requestId]);
        }}
      />
      {loadedRequestId === requestId ? null : (
        <View pointerEvents="none" style={styles.loadingPlaceholder}>
          <Text style={styles.placeholderLabel}>이미지 불러오는 중</Text>
        </View>
      )}
    </View>
  );
}

function CatalogImagePlaceholder({ failed }: { failed: boolean }) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.placeholder}
    >
      <Text style={styles.placeholderLabel}>
        {failed ? "이미지 로딩 실패" : "이미지 준비 중"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: { flex: 1, width: "100%", height: "100%" },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: seed.spacing.x3_5,
    backgroundColor: seed.color.background.neutralWeak,
  },
  loadingPlaceholder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: seed.spacing.x3_5,
    backgroundColor: seed.color.background.neutralWeak,
  },
  placeholderLabel: {
    color: colors.muted,
    ...seed.typography.caption,
    textAlign: "center",
  },
});
