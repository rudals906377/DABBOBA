import type { ProductCategoryId } from "../domain/catalog";

export const EXCHANGE_FILTERS = ["전체", "가챠", "쿠지", "피규어"] as const;
export type ExchangeFilter = (typeof EXCHANGE_FILTERS)[number];

export type ExchangePost = {
  id: string;
  authorId: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  title: string;
  offeredInventoryUnitId: string;
  offeredCatalogItemId: string;
  offeredItem: string;
  offeredItemImage: string;
  appReferenceValue: number;
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  body: string;
  time: string;
  applications: number;
  lifecycleStatus?: "OPEN" | "MATCHED" | "COMPLETED" | "CANCELLED" | "HIDDEN";
  acceptedOfferId?: string | null;
  authorConfirmedAt?: string | null;
  proposerConfirmedAt?: string | null;
};

export type ExchangeApplication = {
  id: string;
  authorId: string;
  author: string;
  offeredInventoryUnitId: string;
  offeredCatalogItemId: string;
  ipId: string;
  categoryId: ProductCategoryId;
  offeredItem: string;
  offeredItemImage: string;
  appReferenceValue: number;
  sourceType: "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
  time: string;
  status?: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
};

export const DEFAULT_EXCHANGE_POSTS: ExchangePost[] = [];
export const DEFAULT_EXCHANGE_APPLICATIONS: Record<string, ExchangeApplication[]> = {};

export type ProductRequest = {
  id: string;
  authorId: string;
  author: string;
  categoryId: ProductCategoryId;
  ipId: string;
  desiredItem: string;
  details: string;
  time: string;
  likes: number;
  version?: number;
};

export const REQUEST_CATEGORY_IDS: readonly ProductCategoryId[] = ["gacha", "kuji", "figure"];
export const DEFAULT_PRODUCT_REQUESTS: ProductRequest[] = [];
