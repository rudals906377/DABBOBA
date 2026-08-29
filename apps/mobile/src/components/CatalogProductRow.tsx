import { Image, Pressable, StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { AppText as Text } from "@/components/Typography";
import { seed } from "@/design-system/seed";
import { productSubjectTitle } from "@/features/shop/product-title";
import { categoryLabel } from "@/features/shop/shop-api";
import { resolveCatalogImageUrl } from "@/lib/runtime-config";
import { colors } from "@/theme";

type CatalogProductRowProduct = Pick<
  CatalogProduct,
  "id" | "name" | "category" | "price" | "imageUrl"
> & Partial<Pick<CatalogProduct, "version">>;

export function CatalogProductRow({
  product,
  ipName,
  assetBaseUrl,
  caption,
  onPress,
}: {
  product: CatalogProductRowProduct;
  ipName: string;
  assetBaseUrl: string | null;
  caption?: string;
  onPress: () => void;
}) {
  const uri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name} 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.imageFrame}>
        {uri ? (
          <Image source={{ uri }} resizeMode="cover" style={styles.image} />
        ) : (
          <View style={styles.placeholder}><Text style={styles.placeholderText}>IMAGE</Text></View>
        )}
      </View>
      <View style={styles.copy}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.ipName}>{ipName}</Text>
          <View style={styles.categoryBadge}><Text style={styles.categoryLabel}>{categoryLabel(product.category)}</Text></View>
        </View>
        <Text numberOfLines={2} style={styles.name}>{productSubjectTitle(product.name, ipName)}</Text>
        <Text style={styles.price}>{product.price.toLocaleString("ko-KR")}원</Text>
        {caption ? <Text numberOfLines={1} style={styles.caption}>{caption}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 118, padding: seed.spacing.componentDefault, borderRadius: seed.radius.r4, borderWidth: 1, borderColor: seed.color.stroke.neutral, backgroundColor: seed.color.layer.default, flexDirection: "row", gap: seed.spacing.x3_5 },
  pressed: { opacity: seed.state.pressedOpacity },
  imageFrame: { width: 92, height: 92, overflow: "hidden", borderRadius: seed.radius.r3_5, backgroundColor: seed.color.background.neutralWeak },
  image: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  placeholderText: { color: colors.muted, fontFamily: "monospace", fontSize: 9, fontWeight: "800" },
  copy: { flex: 1, minWidth: 0, justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  ipName: { flex: 1, color: colors.muted, fontSize: 11 },
  categoryBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.brand },
  categoryLabel: { color: colors.ink, fontSize: 9, fontWeight: "900" },
  name: { color: seed.color.foreground.neutral, fontSize: 15, lineHeight: 21, fontWeight: "700", marginTop: 7 },
  price: { color: seed.color.foreground.neutral, ...seed.typography.bodyStrong, marginTop: seed.spacing.x1_5 },
  caption: { color: colors.greenInk, fontSize: 10, fontWeight: "700", marginTop: 5 },
});
