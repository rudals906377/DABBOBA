import Link from "next/link";
import { reconcilePortOneRefundCancellation, requestPortOneLateRefund, updateRefundReview } from "../../../../../lib/actions";
import { Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, shortId } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import { can } from "../../../../../lib/capabilities";
import type { RefundReviewDetail, SearchParams } from "../../../../../lib/admin-types";

function reviewStatusOptions(current: string | undefined, unresolved: boolean) {
  const closable = unresolved ? [] : ["CLOSED"];
  if (!current) return ["PENDING", "IN_REVIEW"];
  if (current === "PENDING") return ["PENDING", "IN_REVIEW", "ESCALATED", ...closable];
  if (current === "IN_REVIEW") return ["IN_REVIEW", "WAITING_PROVIDER", "ESCALATED", ...closable];
  if (current === "WAITING_PROVIDER") return ["WAITING_PROVIDER", "IN_REVIEW", "ESCALATED", ...closable];
  if (current === "ESCALATED") return ["ESCALATED", "IN_REVIEW", "WAITING_PROVIDER", ...closable];
  return ["CLOSED"];
}

export default async function RefundReviewPage({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<SearchParams> }) {
  const { paymentId } = await params; const query = await searchParams; const session = await requireCapability("refunds.manage");
  const detail = await adminApi<RefundReviewDetail>(`/v1/admin/commerce/refund-reviews/${encodeURIComponent(paymentId)}`, { token: session.token });
  const returnTo = `/commerce/refunds/${encodeURIComponent(paymentId)}`;
  const unresolved = detail.status === "REFUND_REVIEW" || detail.orderStatus === "REFUND_REVIEW";
  return <>
    <PageHeader eyebrow="REFUND REVIEW DETAIL" title="환불 검토 상세" description="원장과 고객 자산을 대조합니다. 메모 저장만으로 결제 공급자 환불·주문 환불·자산 회수는 실행되지 않습니다." actions={<Link className="button-link" href="/commerce/refunds">목록</Link>} />
    <Feedback searchParams={query} />
    <dl className="definition-grid"><div><dt>결제</dt><dd><Link href={`/commerce/payments/${encodeURIComponent(detail.id)}`}>{shortId(detail.id)}</Link><br /><StatusBadge value={detail.status} /></dd></div><div><dt>주문</dt><dd>{shortId(detail.orderId)}<br /><StatusBadge value={detail.orderStatus} /></dd></div><div><dt>회원</dt><dd>{detail.user.nickname}<br />{detail.user.emailMasked}</dd></div><div><dt>금액</dt><dd>{detail.amount.toLocaleString("ko-KR")}원</dd></div><div><dt>운영 상태</dt><dd><StatusBadge value={detail.review?.status || "UNTRACKED"} /></dd></div><div><dt>공급자 취소 시도</dt><dd>{detail.providerCancellation ? <><StatusBadge value={detail.providerCancellation.status} /><br /><small>포트원: {detail.providerCancellation.providerStatus || "확인 전"}</small></> : "요청 없음"}</dd></div><div><dt>담당 관리자</dt><dd>{shortId(detail.review?.assignedAdminId)}</dd></div><div><dt>검토 버전</dt><dd>{detail.review?.version || 0}</dd></div></dl>
    {detail.providerCancellation && <section className="panel"><div className="panel-heading"><div><h2>포트원 취소·대사 기록</h2><p>취소 요청은 한 결제에 한 번만 전송됩니다. 결과가 불확실하면 포트원 거래 상태와 주문 원장을 확인해야 하며, 이 화면의 메모 저장은 재취소를 실행하지 않습니다.</p></div></div><dl className="definition-grid"><div><dt>취소 요청 ID</dt><dd>{detail.providerCancellation.providerCancellationId || "확인 전"}</dd></div><div><dt>마지막 오류 코드</dt><dd>{detail.providerCancellation.lastErrorCode || "없음"}</dd></div><div><dt>마지막 확인</dt><dd>{formatDate(detail.providerCancellation.updatedAt)}</dd></div></dl></section>}
    {detail.providerActionAvailable && can(session.actor, "refunds.cancel") && <section className="panel"><div className="panel-heading"><div><h2>결제 지연 전액 환불</h2><p>취소된 주문에 뒤늦게 승인된 결제만 처리합니다. 서버가 주문·배송 상태와 원장을 다시 확인한 후 포트원에 한 번만 전액 취소를 요청합니다. 결과가 불확실하면 재요청하지 않고 상태를 대사합니다.</p></div></div><form className="stack-form" action={requestPortOneLateRefund}>
      <input type="hidden" name="paymentId" value={detail.id} /><ReturnTo value={returnTo} />
      <p><strong>취소 요청 금액: {detail.amount.toLocaleString("ko-KR")}원</strong></p>
      <label>환불 사유<textarea name="reason" minLength={2} maxLength={500} required placeholder="취소된 주문과 뒤늦은 결제 승인을 확인한 사유를 기록하세요." /></label>
      <label className="check-field"><input type="checkbox" name="confirmFullRefund" value="yes" required /> 이 결제의 전액 취소 요청임을 확인했습니다.</label>
      <div className="form-actions"><button className="primary">포트원 전액 취소 요청</button></div>
    </form></section>}
    {detail.providerActionBlocker && can(session.actor, "refunds.cancel") && <section className="panel"><h2>자동 취소 불가</h2><p>{detail.providerActionBlocker} 운영 검토가 필요합니다.</p></section>}
    {detail.providerReconciliationAvailable && can(session.actor, "refunds.reconcile") && <section className="panel"><div className="panel-heading"><div><h2>포트원 상태 재조회</h2><p>기존 취소 시도의 결과가 불확실할 때만 사용하세요. 새 취소 요청은 보내지 않으며, 포트원에서 검증된 최종 상태는 주문·결제 원장에 반영될 수 있습니다.</p></div></div><form className="stack-form" action={reconcilePortOneRefundCancellation}>
      <input type="hidden" name="paymentId" value={detail.id} /><ReturnTo value={returnTo} />
      <ReasonField label="재조회 사유" /><div className="form-actions"><button className="primary">포트원 상태 다시 확인</button></div>
    </form></section>}
    <section className="panel"><div className="panel-heading"><div><h2>자산 안전 대조</h2><p>구매품 소유권 이동이나 추첨권 소비가 있으면 공급자 환불 후 자동 회수할 수 없습니다.</p></div></div><dl className="definition-grid"><div><dt>구매 예상/실제</dt><dd>{detail.assetSafety.expectedPurchaseUnits} / {detail.assetSafety.actualPurchaseUnits}</dd></div><div><dt>안전하지 않은 구매 자산</dt><dd>{detail.assetSafety.unsafePurchaseUnits}</dd></div><div><dt>추첨 예상/발급</dt><dd>{detail.assetSafety.expectedDrawUnits} / {detail.assetSafety.actualDrawEntitlements}</dd></div><div><dt>소비된 추첨권</dt><dd>{detail.assetSafety.consumedDrawEntitlements}</dd></div></dl></section>
    <section className="panel"><div className="panel-heading"><div><h2>검토 메모 추가</h2><p>{unresolved ? "원장이 REFUND_REVIEW인 동안 CLOSED로 종료할 수 없습니다." : "공급자 원장이 해소되어 운영 검토를 종료할 수 있습니다."}</p></div></div><form className="stack-form" action={updateRefundReview}>
      <input type="hidden" name="paymentId" value={detail.id} /><input type="hidden" name="expectedVersion" value={detail.review?.version || 0} /><ReturnTo value={returnTo} />
      <label>운영 상태<select name="status" defaultValue={detail.review?.status || "IN_REVIEW"}>{reviewStatusOptions(detail.review?.status, unresolved).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>검토 메모<textarea name="note" minLength={2} maxLength={5000} required placeholder="공급자 이벤트, 자산 상태, 후속 확인 항목을 기록하세요." /></label><ReasonField label="상태 변경 사유" /><div className="form-actions"><button className="primary">검토 메모 기록</button></div>
    </form></section>
    <section className="panel"><div className="panel-heading"><div><h2>불변 메모 이력</h2><p>기록된 메모는 수정하거나 삭제할 수 없습니다.</p></div></div>{detail.notes.length === 0 ? <p className="muted">아직 기록된 메모가 없습니다.</p> : <div className="message-list">{detail.notes.map((note) => <article className="message" data-role="ADMIN" key={note.id}><header><strong>{note.adminNickname} · {note.status}</strong><span>{formatDate(note.createdAt)}</span></header><p>{note.note}</p></article>)}</div>}</section>
  </>;
}
