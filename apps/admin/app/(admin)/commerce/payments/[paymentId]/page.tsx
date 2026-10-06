import Link from "next/link";
import { reconcilePortOnePayment, requestPointOrderRefund, requestPortOneFullDrawRefund } from "../../../../../lib/actions";
import { EmptyState, Feedback, PageHeader, ReturnTo, StatusBadge, formatDate, shortId } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import { can } from "../../../../../lib/capabilities";
import type { AdminPaymentDetail, SearchParams } from "../../../../../lib/admin-types";

export default async function PaymentDetailPage({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<SearchParams> }) {
  const { paymentId } = await params; const query = await searchParams; const session = await requireCapability("payments.read");
  const payment = await adminApi<AdminPaymentDetail>(`/v1/admin/commerce/payments/${encodeURIComponent(paymentId)}`, { token: session.token });
  const usedPoints = `${payment.orderPointTotal.toLocaleString("ko-KR")} P`;
  return <>
    <PageHeader eyebrow="PAYMENT DETAIL" title="결제 상세" description="서명된 공급자 이벤트의 처리 결과와 결제 원장만 표시하며 원문 payload와 서명은 노출하지 않습니다." actions={<Link className="button-link" href="/commerce/payments">목록</Link>} />
    <Feedback searchParams={query} />
    <dl className="definition-grid"><div><dt>결제 ID</dt><dd>{payment.id}</dd></div><div><dt>상태</dt><dd><StatusBadge value={payment.status} /></dd></div><div><dt>주문</dt><dd><Link href={`/commerce/orders/${payment.orderId}`}>{shortId(payment.orderId)}</Link><br /><StatusBadge value={payment.orderStatus} /></dd></div><div><dt>금액</dt><dd>{payment.amount.toLocaleString("ko-KR")}원</dd></div><div><dt>공급자</dt><dd>{payment.provider}</dd></div><div><dt>공급자 결제 ID</dt><dd>{payment.providerPaymentId || "-"}</dd></div><div><dt>회원</dt><dd>{payment.user.nickname}<br />{payment.user.emailMasked}</dd></div><div><dt>실패 코드</dt><dd>{payment.failureCode || "-"}</dd></div></dl>
    {payment.providerReconciliationAvailable && can(session.actor, "payments.reconcile") && <section className="panel"><div className="panel-heading"><div><h2>포트원 결제 상태 재조회</h2><p>앱 복귀 또는 웹훅이 누락된 결제를 확인합니다. 새 결제·취소 요청은 보내지 않지만, 확인된 결과는 주문 상태와 뽑기권에 반영될 수 있습니다.</p></div></div><form className="stack-form" action={reconcilePortOnePayment}>
      <input type="hidden" name="paymentId" value={payment.id} /><ReturnTo value={`/commerce/payments/${encodeURIComponent(payment.id)}`} />
      <label>재조회 사유<textarea name="reason" minLength={2} maxLength={500} required placeholder="웹훅 누락, 고객 문의 등 확인 사유를 기록하세요." /></label><div className="form-actions"><button className="primary">포트원 상태 다시 확인</button></div>
    </form></section>}
    {payment.status === "REFUND_REVIEW" || payment.orderStatus === "REFUND_REVIEW" ? <section className="panel"><div className="panel-heading"><div><h2>환불 검토 필요</h2><p>공급자 환불 실행이 아니라 운영 메모와 대조 상태만 기록할 수 있습니다.</p></div><Link className="button-link primary" href={`/commerce/refunds/${payment.id}`}>검토 열기</Link></div></section> : null}
    {can(session.actor, "refunds.cancel") && payment.refundActionKind === "CARD_CANCELLATION" && payment.refundActionAvailable && <section className="panel"><div className="panel-heading"><div><h2>미사용 뽑기 주문 전액 환불</h2><p>가챠·쿠지 추첨권이 모두 미사용인 경우에만 가능합니다. 요청 즉시 서버가 뽑기를 잠그고 포트원에 결제 전액 취소를 한 번만 보냅니다. 결과가 불확실하면 재취소하지 않고 대사해야 합니다.</p></div></div><form className="stack-form" action={requestPortOneFullDrawRefund}>
      <input type="hidden" name="paymentId" value={payment.id} /><ReturnTo value={`/commerce/payments/${encodeURIComponent(payment.id)}`} />
      <p><strong>취소 요청 금액: {payment.amount.toLocaleString("ko-KR")}원</strong>{payment.orderPointTotal > 0 && <><br />함께 사용한 포인트 {usedPoints}는 카드 취소가 확인되면 회원에게 포인트로 되돌려집니다.</>}</p>
      <label>환불 사유<textarea name="reason" minLength={2} maxLength={500} required placeholder="고객 요청과 확인한 사유를 기록하세요." /></label>
      <label className="check-field"><input type="checkbox" name="confirmFullRefund" value="yes" required /> 이 결제의 전액 취소 요청임을 확인했습니다.</label>
      <div className="form-actions"><button className="primary">전액 환불 요청</button></div>
    </form></section>}
    {can(session.actor, "refunds.cancel") && payment.refundActionKind === "POINT_ORDER" && payment.refundActionAvailable && <section className="panel"><div className="panel-heading"><div><h2>미사용 포인트 주문 전액 환불</h2><p>카드 결제 없이 포인트·쿠폰으로만 결제한 가챠·쿠지 주문입니다. 뽑기권이 모두 미사용인 경우에만 가능하며, 결제사 요청 없이 서버가 한 번에 뽑기권을 취소하고 사용 포인트를 되돌립니다. 같은 주문의 포인트는 한 번만 되돌려집니다.</p></div></div><form className="stack-form" action={requestPointOrderRefund}>
      <input type="hidden" name="paymentId" value={payment.id} /><ReturnTo value={`/commerce/payments/${encodeURIComponent(payment.id)}`} />
      <p><strong>되돌릴 포인트: {usedPoints}</strong></p>
      <label>환불 사유<textarea name="reason" minLength={2} maxLength={500} required placeholder="고객 요청과 확인한 사유를 기록하세요." /></label>
      <label className="check-field"><input type="checkbox" name="confirmPointRefund" value="yes" required /> {payment.orderPointTotal > 0 ? `사용한 포인트 ${usedPoints}를 회원에게 되돌리고 뽑기권을 취소합니다.` : "결제 금액이 없는 이 주문의 뽑기권을 취소합니다."}</label>
      <div className="form-actions"><button className="primary">포인트 주문 환불</button></div>
    </form></section>}
    {can(session.actor, "refunds.cancel") && payment.status === "PAID" && payment.refundActionBlocker && <section className="panel"><h2>자동 전액 환불 불가</h2><p>{payment.refundActionBlocker} 고객센터 검토 후 별도 처리해야 합니다.</p></section>}
    <section className="panel"><div className="panel-heading"><div><h2>결제 원장</h2><p>결제·환불·보정 항목은 수정·삭제할 수 없습니다.</p></div></div>{payment.ledger.length === 0 ? <EmptyState title="원장 항목이 없습니다." /> : <div className="data-panel"><table className="data-table"><thead><tr><th>유형</th><th>금액</th><th>참조</th><th>사유</th><th>기록</th></tr></thead><tbody>{payment.ledger.map((entry) => <tr key={entry.id}><td><StatusBadge value={entry.entryType} /></td><td>{entry.amount.toLocaleString("ko-KR")}원</td><td>{entry.referenceId}</td><td>{entry.reason || "-"}</td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>공급자 이벤트</h2><p>중복 제거된 이벤트 ID와 처리 결과입니다. 상태가 모순될 때만 결제사가 보고한 금액을 표시하며 원문 payload는 노출하지 않습니다.</p></div></div>{payment.providerEvents.length === 0 ? <EmptyState title="공급자 이벤트가 없습니다." /> : <div className="data-panel"><table className="data-table"><thead><tr><th>이벤트</th><th>유형</th><th>결제사 상태·금액</th><th>발생</th><th>처리</th><th>오류</th></tr></thead><tbody>{payment.providerEvents.map((event) => <tr key={event.id}><td>{event.providerEventId}</td><td>{event.eventType}</td><td>{event.providerObservation ? `${event.providerObservation.status} · 결제 ${event.providerObservation.paidAmount.toLocaleString("ko-KR")}원 · 취소 ${event.providerObservation.cancelledAmount.toLocaleString("ko-KR")}원` : event.eventType === "PAYMENT_STATE_ANOMALY" ? "대조 정보 확인 불가" : "-"}</td><td>{formatDate(event.occurredAt)}</td><td>{formatDate(event.processedAt)}</td><td>{event.processingError || "-"}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
