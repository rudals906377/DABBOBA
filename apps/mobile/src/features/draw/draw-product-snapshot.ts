import { fetchProductDetail, type ProductDetailSnapshot } from "@/features/shop/shop-api";

export async function fetchCommittedDrawProductSnapshot(
  apiBaseUrl: string,
  productId: string,
  accessToken: string,
): Promise<ProductDetailSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const snapshot = await fetchProductDetail(apiBaseUrl, productId, accessToken, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new Error("상품 정보 조회 시간이 초과됐습니다.");
    return snapshot;
  } finally {
    clearTimeout(timer);
  }
}
