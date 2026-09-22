import Link from "next/link";
import { EmptyState, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { AdminInventory, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("inventory.read");
  const q = first(query.q) || ""; const category = first(query.category) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<AdminInventory>>(`/v1/admin/commerce/inventory${queryString({ q, category, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="STOCK CONTROL" title="재고 운영" description="실재고·예약·판매 가능 수량과 유한 추첨 수용량을 함께 확인합니다. 수동 조정은 최고 관리자만 불변 원장으로 기록할 수 있습니다." />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="상품명 · SKU · 상품 ID" /></label><label>분류<select name="category" defaultValue={category}><option value="">전체</option>{["gacha", "figure", "kuji", "tcg"].map((value) => <option key={value}>{value}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="재고 상품이 없습니다." /> : <table className="data-table"><thead><tr><th>상품</th><th>분류</th><th>실재고</th><th>예약</th><th>판매 가능</th><th>추첨 수용량</th><th>버전/수정</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.productId}>
      <td className="wide-cell"><Link href={`/commerce/inventory/${encodeURIComponent(item.productId)}`}><strong>{item.name}</strong></Link><br /><span className="muted">{item.sku} · {item.productId}</span></td><td>{item.category}<br /><StatusBadge value={item.isActive} /></td><td>{item.onHand.toLocaleString("ko-KR")}</td><td>{item.reserved.toLocaleString("ko-KR")}</td><td>{item.available.toLocaleString("ko-KR")}</td><td>{item.drawCapacity ? item.drawCapacity.unlimited ? "무제한 풀" : `판매 상한 ${item.drawCapacity.sellableUnits?.toLocaleString("ko-KR")}` : "구매 상품"}</td><td>v{item.version}<br /><span className="muted">{formatDate(item.updatedAt)}</span></td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/commerce/inventory" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
