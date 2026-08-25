import Link from "next/link";
import {
  Feedback,
  PageHeader,
  ReasonField,
  ReturnTo,
  StatusBadge,
  formatDate,
  privacySafeMetadata,
  shortId,
} from "../../../../components/operations";
import { decideAccountDeletion } from "../../../../lib/actions";
import { adminApi } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type {
  AccountDeletionBlockers,
  AdminAccountDeletionDetail,
  SearchParams,
} from "../../../../lib/admin-types";

const blockerLabels: ReadonlyArray<[keyof AccountDeletionBlockers, string]> = [
  ["pointBalance", "포인트 잔액"],
  ["activeOrderCount", "진행 주문"],
  ["activePaymentCount", "진행 결제"],
  ["availableDrawEntitlementCount", "미사용 추첨권"],
  ["activeInventoryCount", "보유·이동 자산"],
  ["activeShippingRequestCount", "진행 배송"],
  ["activeExchangeListingCount", "진행 교환글"],
  ["activeExchangeOfferCount", "진행 교환 제안"],
];

function Blockers({ value, title }: { value: AccountDeletionBlockers; title: string }) {
  return <section className="panel">
    <div className="panel-heading"><div><h2>{title}</h2><p>승인 시에는 서버가 이 값을 다시 계산하며 하나라도 남아 있으면 요청을 거부합니다.</p></div></div>
    <dl className="definition-grid">
      {blockerLabels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value[key].toLocaleString("ko-KR")}</dd></div>)}
    </dl>
  </section>;
}

export default async function AccountDeletionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { requestId } = await params;
  const query = await searchParams;
  const session = await requireCapability("accountDeletions.manage");
  const detail = await adminApi<AdminAccountDeletionDetail>(
    `/v1/admin/account-deletions/${encodeURIComponent(requestId)}`,
    { token: session.token },
  );
  const returnTo = `/account-deletions/${encodeURIComponent(requestId)}`;

  return <>
    <PageHeader
      eyebrow="ACCOUNT EXIT DETAIL"
      title="탈퇴 요청 상세"
      description={`${detail.user.nickname} · ${detail.user.emailMasked} · ${shortId(detail.id)}`}
      actions={<Link className="button-link" href="/account-deletions">목록으로</Link>}
    />
    <Feedback searchParams={query} />
    <dl className="definition-grid">
      <div><dt>상태</dt><dd><StatusBadge value={detail.status} /></dd></div>
      <div><dt>요청 횟수</dt><dd>{detail.requestCount}회</dd></div>
      <div><dt>최초 요청</dt><dd>{formatDate(detail.requestedAt)}</dd></div>
      <div><dt>최근 요청</dt><dd>{formatDate(detail.lastRequestedAt)}</dd></div>
      <div><dt>결정 시각</dt><dd>{formatDate(detail.decidedAt)}</dd></div>
      <div><dt>결정 관리자</dt><dd>{detail.decidedBy?.nickname || "-"}</dd></div>
      <div><dt>실제 삭제 실행</dt><dd>실행되지 않음</dd></div>
      <div><dt>완료 기능</dt><dd>정책 확정 전 지원하지 않음</dd></div>
    </dl>

    <Blockers value={detail.currentBlockers} title="현재 서버 차단 항목" />
    <Blockers value={detail.blockers} title="마지막 요청 시점 스냅샷" />

    {detail.rejectionAvailable ? <section className="panel">
      <div className="panel-heading"><div><h2>운영 결정 기록</h2><p>
        {detail.approvalEligible
          ? "현재 차단 항목이 없어 승인할 수 있습니다. 승인과 동시에 사용자 변경 요청을 차단하고 남은 세션을 폐기합니다."
          : "차단 항목이 남아 있어 승인은 허용되지 않습니다. 반려만 기록하거나 원인을 해소한 뒤 새로고침하세요."}
      </p></div></div>
      <form className="stack-form" action={decideAccountDeletion}>
        <input type="hidden" name="requestId" value={detail.id} />
        <ReturnTo value={returnTo} />
        <label>결정<select name="decision" defaultValue={detail.approvalEligible ? "APPROVED" : "REJECTED"}>
          {detail.approvalEligible ? <option value="APPROVED">APPROVED · 승인 기록</option> : null}
          <option value="REJECTED">REJECTED · 반려</option>
        </select></label>
        <ReasonField label="검토 결정 사유" />
        <div className="form-actions"><button className="primary" type="submit">결정 이력 저장</button></div>
      </form>
    </section> : <section className="panel">
      <div className="panel-heading"><div><h2>운영 결정 완료</h2><p>이 요청은 더 이상 승인·반려할 수 없습니다. 승인된 계정의 접근과 새 변경은 차단되지만 실제 삭제나 익명화는 별도 보존 정책과 수동 절차가 마련되기 전까지 제공되지 않습니다.</p></div></div>
      {detail.decisionReason ? <p><strong>결정 사유</strong><br />{detail.decisionReason}</p> : null}
    </section>}

    <section className="panel">
      <div className="panel-heading"><div><h2>불변 처리 이력</h2><p>고객 요청, 재평가, 관리자 결정을 시간순으로 확인합니다. 이 이벤트는 수정하거나 삭제할 수 없습니다.</p></div></div>
      {detail.events.length === 0 ? <p className="muted">기록된 이벤트가 없습니다.</p> : <div className="message-list">
        {detail.events.map((event) => <article className="message" data-role={event.admin ? "ADMIN" : "USER"} key={event.id}>
          <header><strong>{event.eventType} · {event.status}</strong><span>{formatDate(event.createdAt)}</span></header>
          <p>{event.admin ? `${event.admin.nickname} · ` : ""}{event.reason || "고객 요청에 따른 자동 기록"}</p>
          <p className="muted">세션 해지 {event.revokedSessionCount}건 · 요청 {shortId(event.correlationId)}</p>
          <pre>{JSON.stringify(privacySafeMetadata(event.metadata), null, 2)}</pre>
        </article>)}
      </div>}
    </section>
  </>;
}
