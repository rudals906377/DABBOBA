import type { ProductCategoryId } from "../domain/catalog";

export const DUCKROOM_FILTERS = ["전체", "가챠", "피규어", "쿠지"] as const;
export type DuckroomFilter = (typeof DUCKROOM_FILTERS)[number];

export type DuckroomShowcase = {
  id: string;
  author: string;
  caption: string;
  categoryId: ProductCategoryId;
  productId: string;
  collectedCount: number;
  likes: number;
};

// Customer content comes from the API. Keep the local shell empty until real
// operator/customer records exist.
export const DUCKROOM_SHOWCASES: DuckroomShowcase[] = [];
