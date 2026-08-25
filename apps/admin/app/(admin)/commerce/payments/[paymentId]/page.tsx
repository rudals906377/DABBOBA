import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge, formatDate, shortId } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import type { AdminPaymentDetail } from "../../../../../lib/admin-types";

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params; const session = await requireCapability("payments.read");
  const payment = await adminApi<AdminPaymentDetail>(`/v1/admin/commerce/payments/${encodeURIComponent(paymentId)}`, { token: session.token });
  return <>
    <PageHeader eyebrow="PAYMENT DETAIL" title="결제 상세" description="서명된 공급자 이벤트의 처리 결과와 결제 원장만 표시하며 원문 payload와 서명은 노출하지 않습니다." actions={<Link className="button-link" href="/commerce/payments">목록</Link>} />
    <dl className="definition-grid"><div><dt>결제 ID</dt><dd>{payment.id}</dd></div><div><dt>상태</dt><dd><StatusBadge value={payment.status} /></dd></div><div><dt>주문</dt><dd><Link href={`/commerce/orders/${payment.orderId}`}>{shortId(payment.orderId)}</Link><br /><StatusBadge value={payment.orderStatus} /></dd></div><div><dt>금액</dt><dd>{payment.amount.toLocaleString("ko-KR")}원</dd></div><div><dt>공급자</dt><dd>{payment.provider}</dd></div><div><dt>공급자 결제 ID</dt><dd>{payment.providerPaymentId || "-"}</dd></div><div><dt>회원</dt><dd>{payment.user.nickname}<br />{payment.user.emailMasked}</dd></div><div><dt>실패 코드</dt><dd>{payment.failureCode || "-"}</dd></div></dl>
    {payment.status === "REFUND_REVIEW" || payment.orderStatus === "REFUND_REVIEW" ? <section className="panel"><div className="panel-heading"><div><h2>환불 검토 필요</h2><p>공급자 환불 실행이 아니라 운영 메모와 대조 상태만 기록할 수 있습니다.</p></div><Link className="button-link primary" href={`/commerce/refunds/${payment.id}`}>검토 열기</Link></div></section> : null}
    <section className="panel"><div className="panel-heading"><div><h2>결제 원장</h2><p>결제·환불·보정 항목은 수정·삭제할 수 없습니다.</p></div></div>{payment.ledger.length === 0 ? <EmptyState title="원장 항목이 없습니다." /> : <div className="data-panel"><table className="data-table"><thead><tr><th>유형</th><th>금액</th><th>참조</th><th>사유</th><th>기록</th></tr></thead><tbody>{payment.ledger.map((entry) => <tr key={entry.id}><td><StatusBadge value={entry.entryType} /></td><td>{entry.amount.toLocaleString("ko-KR")}원</td><td>{entry.referenceId}</td><td>{entry.reason || "-"}</td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>공급자 이벤트</h2><p>중복 제거된 이벤트 ID와 처리 결과입니다.</p></div></div>{payment.providerEvents.length === 0 ? <EmptyState title="공급자 이벤트가 없습니다." /> : <div className="data-panel"><table className="data-table"><thead><tr><th>이벤트</th><th>유형</th><th>발생</th><th>처리</th><th>오류</th></tr></thead><tbody>{payment.providerEvents.map((event) => <tr key={event.id}><td>{event.providerEventId}</td><td>{event.eventType}</td><td>{formatDate(event.occurredAt)}</td><td>{formatDate(event.processedAt)}</td><td>{event.processingError || "-"}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
