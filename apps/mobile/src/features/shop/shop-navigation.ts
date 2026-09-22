import type { ProductCategory } from "@/features/shop/shop-api";

export type ShopTabPath = "/(tabs)" | "/(tabs)/gacha" | "/(tabs)/kuji";

export function shopTabPathForCategory(
  category: ProductCategory | null | undefined,
): ShopTabPath {
  if (category === "gacha") return "/(tabs)/gacha";
  if (category === "kuji") return "/(tabs)/kuji";
  return "/(tabs)";
}
