import Link from "next/link";
import { EmptyState, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { AdminShippingRequest, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function ShippingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("shipping.manage");
  const q = first(query.q) || ""; const status = first(query.status) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<AdminShippingRequest>>(`/v1/admin/commerce/shipping${queryString({ q, status, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="FULFILLMENT QUEUE" title="배송 운영" description="허용된 상태 전이만 적용하고, 출고 시 택배사·운송장 번호와 전후 상태를 감사 이력에 남깁니다." />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="배송 ID · 회원 · 운송장" /></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PAYMENT_PENDING", "REQUESTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="배송 신청이 없습니다." /> : <table className="data-table"><thead><tr><th>배송 신청</th><th>회원</th><th>상품</th><th>상태</th><th>운송장</th><th>신청</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td><Link href={`/commerce/shipping/${item.id}`}><strong>{shortId(item.id)}</strong></Link><br /><span className="muted">v{item.version}</span></td><td>{item.user.nickname}<br /><span className="muted">{item.user.emailMasked}</span></td><td>{item.itemCount}개</td><td><StatusBadge value={item.status} /></td><td>{item.trackingCarrier || "-"}<br /><span className="muted">{item.trackingNumber || "-"}</span></td><td>{formatDate(item.requestedAt)}</td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/commerce/shipping" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
