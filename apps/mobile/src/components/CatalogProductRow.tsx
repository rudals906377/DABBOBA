import { Pressable, StyleSheet, View } from "react-native";
import type { CatalogProduct } from "@dabboba/contracts";
import { CatalogProductImage } from "@/components/CatalogProductImage";
import { GachaMachineFrame } from "@/components/GachaMachineFrame";
import { KujiProductFrame } from "@/components/KujiProductFrame";
import { ProductInfoDivider } from "@/components/ProductInfoDivider";
import { RemainingInventoryMeter } from "@/components/RemainingInventoryMeter";
import { AppText as Text } from "@/components/Typography";
import { catalogProductCardSurface, catalogProductImageSurface } from "@/design-system/catalog";
import { seed } from "@/design-system/seed";
import { catalogQuantityLabel, remainingInventoryLabel } from "@/features/catalog/remaining-inventory";
import { useCommerceCapability } from "@/features/commerce/CommerceCapabilityProvider";
import { productPriceLabel } from "@/features/commerce/product-commerce-presentation";
import { productSubjectTitle } from "@/features/shop/product-title";
import { categoryLabel } from "@/features/shop/shop-api";
import { resolveCatalogImageUrl } from "@/lib/runtime-config";
import { colors } from "@/theme";

type CatalogProductRowProduct = Pick<
  CatalogProduct,
  "id" | "name" | "category" | "price" | "imageUrl"
> & Partial<Pick<CatalogProduct, "version" | "availableQuantity" | "totalQuantity" | "storefrontImageUrl">>;

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
  const { commerceEnabled } = useCommerceCapability();
  const priceLabel = productPriceLabel(product, commerceEnabled);
  const primaryUri = resolveCatalogImageUrl(product.imageUrl, assetBaseUrl, product.version);
  const storefrontUri = resolveCatalogImageUrl(product.storefrontImageUrl ?? null, assetBaseUrl, product.version);
  const uri = product.category === "gacha" ? storefrontUri ?? primaryUri : primaryUri;
  const resizeMode = product.category === "kuji" || (product.category === "gacha" && !storefrontUri)
    ? "contain"
    : "cover";
  const inventoryAccessibilityLabel = typeof product.availableQuantity === "number"
    ? `, ${remainingInventoryLabel(product.category)} ${catalogQuantityLabel({
      availableQuantity: product.availableQuantity,
      totalQuantity: product.totalQuantity ?? null,
    })}`
    : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${categoryLabel(product.category)} 상품, ${ipName}, ${product.name}, ${priceLabel}${inventoryAccessibilityLabel}, 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <GachaMachineFrame category={product.category} clean>
        <KujiProductFrame category={product.category} clean>
          <View style={styles.imageFrame}>
            <CatalogProductImage
              uri={uri}
              requestKey={product.version ?? 0}
              resizeMode={resizeMode}
              fallbackSources={product.category === "gacha" && storefrontUri ? [{ uri: primaryUri, resizeMode: "contain" }] : []}
              style={styles.image}
            />
          </View>
        </KujiProductFrame>
      </GachaMachineFrame>
      <ProductInfoDivider orientation="vertical" style={styles.mediaDivider} />
      <View style={styles.copy}>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.ipName}>{ipName}</Text>
          <View style={[styles.categoryBadge, product.category === "kuji" && styles.categoryBadgeKuji]}><Text style={styles.categoryLabel}>{categoryLabel(product.category)}</Text></View>
        </View>
        <Text numberOfLines={2} style={styles.name}>{productSubjectTitle(product.name, ipName)}</Text>
        <ProductInfoDivider style={styles.fieldDivider} />
        <Text style={styles.price}>{priceLabel}</Text>
        {typeof product.availableQuantity === "number" ? (
          <RemainingInventoryMeter
            category={product.category}
            availableQuantity={product.availableQuantity}
            totalQuantity={product.totalQuantity ?? null}
            compact
            style={styles.inventory}
          />
        ) : null}
        {caption ? <Text numberOfLines={1} style={styles.caption}>{caption}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 118, padding: seed.spacing.componentDefault, ...catalogProductCardSurface, flexDirection: "row", gap: seed.spacing.x3_5 },
  pressed: { opacity: seed.state.pressedOpacity },
  imageFrame: { width: 92, height: 92, ...catalogProductImageSurface },
  image: { width: "100%", height: "100%" },
  mediaDivider: { marginVertical: seed.spacing.x0_5 },
  copy: { flex: 1, minWidth: 0, justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  ipName: { flex: 1, color: colors.muted, ...seed.typography.catalogMetadata },
  categoryBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: seed.radius.r1_5, backgroundColor: colors.brand },
  categoryBadgeKuji: { backgroundColor: colors.kujiOrange },
  categoryLabel: { color: colors.ink, ...seed.typography.finePrint, fontWeight: "900" },
  name: { color: seed.color.foreground.neutral, ...seed.typography.catalogTitle, marginTop: 7 },
  fieldDivider: { marginTop: seed.spacing.x1_5 },
  price: { color: seed.color.foreground.neutral, ...seed.typography.catalogPrice, marginTop: seed.spacing.x1_5 },
  inventory: { marginTop: seed.spacing.x1 },
  caption: { color: colors.greenInk, ...seed.typography.finePrint, fontWeight: "700", marginTop: 5 },
});
