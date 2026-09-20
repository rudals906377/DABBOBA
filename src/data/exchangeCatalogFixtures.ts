import type { ProductCategoryId } from "../domain/catalog";

export type ExchangeCatalogItem = {
  id: string;
  productId: string;
  ipId: string;
  categoryId: ProductCategoryId;
  name: string;
  estimatedPrice: number;
  searchCount: number;
  postCount: number;
};

// Exchange choices are loaded from the authenticated inventory API.
export const POPULAR_EXCHANGE_CATALOG_ITEMS: ExchangeCatalogItem[] = [];
