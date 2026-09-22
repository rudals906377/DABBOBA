import Link from "next/link";
import { EmptyState, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { AdminOrder, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("orders.read");
  const q = first(query.q) || "";
  const status = first(query.status) || "";
  const userId = first(query.userId) || "";
  const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<AdminOrder>>(`/v1/admin/commerce/orders${queryString({ q, status, userId, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="COMMERCE LEDGER" title="주문 운영" description="서버 주문 원장과 결제 상태를 함께 조회합니다. 주문 상태는 결제·재고 처리 결과로만 변경됩니다." />
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="주문 ID · 회원 · 상품" /></label>
      <label>회원 ID<input name="userId" defaultValue={userId} placeholder="UUID" /></label>
      <label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PENDING_PAYMENT", "PAID", "FULFILLED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="주문이 없습니다." /> : <table className="data-table"><thead><tr><th>주문</th><th>회원</th><th>금액</th><th>상품</th><th>주문 상태</th><th>결제</th><th>접수</th></tr></thead><tbody>{page.items.map((order) => <tr key={order.id}>
      <td><Link href={`/commerce/orders/${order.id}`}><strong>{shortId(order.id)}</strong></Link></td>
      <td>{order.user.nickname}<br /><span className="muted">{order.user.emailMasked}</span></td>
      <td>{order.total.toLocaleString("ko-KR")}원<br /><span className="muted">할인 {order.discountTotal.toLocaleString("ko-KR")} · 포인트 {order.pointTotal.toLocaleString("ko-KR")}</span></td>
      <td>{order.lineCount}종 · {order.unitCount}개</td><td><StatusBadge value={order.status} /></td>
      <td><StatusBadge value={order.payment.status} /><br /><span className="muted">{order.payment.provider}</span></td><td>{formatDate(order.createdAt)}</td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/commerce/orders" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
