import rawProducts from "../fixtures/product-seed.json";
import {
  categoryLabel,
  type ProductCategoryLabel,
  type ProductRecord,
} from "../domain/catalog";

export type CatalogProduct = ProductRecord & {
  category: ProductCategoryLabel;
};

export const PRODUCTS: CatalogProduct[] = (rawProducts as ProductRecord[]).map((product) => ({
  ...product,
  category: categoryLabel(product.categoryId) as ProductCategoryLabel,
}));

export function productsForIp(ipId: string) {
  return PRODUCTS.filter((product) => product.ipId === ipId);
}
