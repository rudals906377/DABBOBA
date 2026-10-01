import Link from "next/link";
import { statusLabel, EmptyState, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { AdminPayment, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("payments.read");
  const q = first(query.q) || ""; const status = first(query.status) || ""; const provider = first(query.provider) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<AdminPayment>>(`/v1/admin/commerce/payments${queryString({ q, status, provider, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="PAYMENT RECONCILIATION" title="결제 운영" description="공급자 이벤트와 불변 결제 원장을 조회합니다. 이 화면에서는 승인·취소·환불을 직접 실행하지 않습니다." />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="결제·주문·PG ID · 회원" /></label><label>공급자<input name="provider" defaultValue={provider} /></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="결제가 없습니다." /> : <table className="data-table"><thead><tr><th>결제</th><th>주문</th><th>회원</th><th>금액</th><th>공급자</th><th>상태</th><th>생성</th></tr></thead><tbody>{page.items.map((payment) => <tr key={payment.id}>
      <td><Link href={`/commerce/payments/${payment.id}`}><strong>{shortId(payment.id)}</strong></Link><br /><span className="muted">{payment.providerPaymentId || "PG ID 대기"}</span></td>
      <td><Link href={`/commerce/orders/${payment.orderId}`}>{shortId(payment.orderId)}</Link><br /><StatusBadge value={payment.orderStatus} /></td><td>{payment.user.nickname}<br /><span className="muted">{payment.user.emailMasked}</span></td>
      <td>{payment.amount.toLocaleString("ko-KR")}원</td><td>{payment.provider}</td><td><StatusBadge value={payment.status} /></td><td>{formatDate(payment.createdAt)}</td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/commerce/payments" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
