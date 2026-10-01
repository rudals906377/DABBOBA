import "server-only";
import { adminApi, queryString } from "./api";
import type { CatalogIp, CatalogProduct, CursorPage } from "./admin-types";

// Read each page so an existing selection is not lost beyond the first 30 rows.
export async function catalogIpChoices(token: string): Promise<CatalogIp[]> {
  const items: CatalogIp[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: CursorPage<CatalogIp> = await adminApi(`/v1/admin/ips${queryString({ limit: "100", cursor })}`, { token });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("작품 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items.sort((a, b) => a.nameKo.localeCompare(b.nameKo, "ko"));
}

export async function catalogProductChoices(token: string): Promise<CatalogProduct[]> {
  const items: CatalogProduct[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: CursorPage<CatalogProduct> = await adminApi(`/v1/admin/products${queryString({ limit: "100", prizeOnly: "false", cursor })}`, { token });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
