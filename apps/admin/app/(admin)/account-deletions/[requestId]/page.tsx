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
    <div className="panel-heading"><div><h2>{title}</h2><p>서버가 자동 삭제를 시작하기 전에 다시 계산합니다. 진행 항목이 있으면 BLOCKED로 유지하고 안전하게 재평가합니다.</p></div></div>
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
      <div><dt>자동 처리 시작</dt><dd>{formatDate(detail.processingStartedAt)}</dd></div>
      <div><dt>완료 시각</dt><dd>{formatDate(detail.completedAt)}</dd></div>
      <div><dt>하드 삭제</dt><dd>실행하지 않음</dd></div>
      <div><dt>처리 방식</dt><dd>{detail.status === "COMPLETED" ? "자동 익명화 완료" : detail.status === "PROCESSING" ? "자동 삭제 worker 처리 중" : "서버 자동 처리"}</dd></div>
      <div><dt>연결 로그인 삭제</dt><dd>{detail.authDeletionStatus === "NOT_REQUIRED" ? "연결 계정 없음" : detail.authDeletionStatus === "COMPLETED" ? `완료 · ${formatDate(detail.authDeletedAt)}` : "안전하게 재시도 중"}</dd></div>
    </dl>

    <section className="panel">
      <div className="panel-heading"><div><h2>자동 삭제 작업</h2><p>회원탈퇴는 관리자 승인 없이 처리됩니다. 외부 Auth 삭제가 실패하면 identity를 유지한 채 로그인을 차단하고 worker가 재시도합니다.</p></div></div>
      {detail.deletionJob ? <dl className="definition-grid">
        <div><dt>작업 상태</dt><dd>{detail.deletionJob.status}</dd></div>
        <div><dt>시도 횟수</dt><dd>{detail.deletionJob.attempts}회</dd></div>
        <div><dt>다음 실행</dt><dd>{formatDate(detail.deletionJob.availableAt)}</dd></div>
        <div><dt>임대 만료</dt><dd>{formatDate(detail.deletionJob.leaseExpiresAt)}</dd></div>
        <div><dt>외부 삭제</dt><dd>{formatDate(detail.deletionJob.externalDeletedAt)}</dd></div>
        <div><dt>최근 오류</dt><dd>{detail.deletionJob.lastError || "-"}</dd></div>
      </dl> : <p className="muted">대기 중인 삭제 작업이 없습니다. 완료됐거나 연결 로그인 계정이 없는 요청입니다.</p>}
    </section>

    <Blockers value={detail.currentBlockers} title="현재 서버 차단 항목" />
    <Blockers value={detail.blockers} title="마지막 요청 시점 스냅샷" />

    {detail.rejectionAvailable ? <section className="panel">
      <div className="panel-heading"><div><h2>예외 처리 중단</h2><p>법적 보존 충돌이나 본인확인 오류처럼 자동 처리를 중단해야 하는 예외에만 사용합니다. 일반적인 진행 결제·배송 차단은 worker가 재평가하므로 반려 사유가 아닙니다.</p></div></div>
      <form className="stack-form" action={decideAccountDeletion}>
        <input type="hidden" name="requestId" value={detail.id} />
        <input type="hidden" name="decision" value="REJECTED" />
        <ReturnTo value={returnTo} />
        <ReasonField label="처리 중단 사유" />
        <div className="form-actions"><button className="danger" type="submit">자동 처리 중단 기록</button></div>
      </form>
    </section> : <section className="panel">
      <div className="panel-heading"><div><h2>운영 상태</h2><p>수동 승인·완료 버튼은 제공하지 않습니다. 서버 작업이 Supabase Auth 삭제와 개인정보 익명화를 순서대로 완료합니다.</p></div></div>
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
