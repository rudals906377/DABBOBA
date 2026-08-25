import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge, formatDate, shortId } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import type { AdminOrderDetail } from "../../../../../lib/admin-types";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await requireCapability("orders.read");
  const order = await adminApi<AdminOrderDetail>(`/v1/admin/commerce/orders/${encodeURIComponent(orderId)}`, { token: session.token });
  return <>
    <PageHeader eyebrow="ORDER DETAIL" title="주문 상세" description="가격 스냅샷, 결제 상태, 재고 예약 이력을 서버 원장에서 확인합니다." actions={<Link className="button-link" href="/commerce/orders">목록</Link>} />
    <dl className="definition-grid">
      <div><dt>주문 ID</dt><dd>{order.id}</dd></div><div><dt>주문 상태</dt><dd><StatusBadge value={order.status} /></dd></div>
      <div><dt>회원</dt><dd>{order.user.nickname}<br />{order.user.emailMasked}</dd></div><div><dt>최종 금액</dt><dd>{order.total.toLocaleString("ko-KR")}원</dd></div>
      <div><dt>결제</dt><dd><Link href={`/commerce/payments/${order.payment.id}`}>{shortId(order.payment.id)}</Link><br /><StatusBadge value={order.payment.status} /></dd></div>
      <div><dt>소계/할인/포인트</dt><dd>{order.subtotal.toLocaleString("ko-KR")} / {order.discountTotal.toLocaleString("ko-KR")} / {order.pointTotal.toLocaleString("ko-KR")}</dd></div>
      <div><dt>생성</dt><dd>{formatDate(order.createdAt)}</dd></div><div><dt>수정</dt><dd>{formatDate(order.updatedAt)}</dd></div>
    </dl>
    <section className="panel"><div className="panel-heading"><div><h2>주문 상품</h2><p>주문 당시 상품명·가격·확률표 버전 스냅샷입니다.</p></div></div>
      {order.lines.length === 0 ? <EmptyState /> : <div className="data-panel"><table className="data-table"><thead><tr><th>상품</th><th>분류</th><th>단가</th><th>수량</th><th>합계</th><th>확률표</th></tr></thead><tbody>{order.lines.map((line) => <tr key={line.id}><td><strong>{line.productName}</strong><br /><span className="muted">{line.productId}</span></td><td>{line.category}</td><td>{line.unitPrice.toLocaleString("ko-KR")}원</td><td>{line.quantity}</td><td>{line.lineTotal.toLocaleString("ko-KR")}원</td><td>{shortId(line.probabilityVersionId)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>재고 예약</h2><p>결제 전 예약과 해제·확정 이력을 확인합니다.</p></div></div>
      {order.reservations.length === 0 ? <EmptyState title="재고 예약이 없습니다." /> : <div className="data-panel"><table className="data-table"><thead><tr><th>예약</th><th>상품</th><th>수량</th><th>상태</th><th>만료</th><th>해결</th></tr></thead><tbody>{order.reservations.map((item) => <tr key={item.id}><td>{shortId(item.id)}</td><td>{item.productId}</td><td>{item.quantity}</td><td><StatusBadge value={item.status} /></td><td>{formatDate(item.expiresAt)}</td><td>{formatDate(item.resolvedAt)}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
