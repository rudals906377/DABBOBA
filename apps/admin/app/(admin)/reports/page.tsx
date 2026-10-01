import { statusLabel, EmptyState, Feedback, FilterBar, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, preview, shortId } from "../../../components/operations";
import { resolveReport, startReportReview } from "../../../lib/actions";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CursorPage, Report, SearchParams } from "../../../lib/admin-types";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("reports.manage");
  const status = first(query.status) || ""; const targetType = first(query.targetType) || ""; const targetId = first(query.targetId) || ""; const reporterId = first(query.reporterId) || ""; const subjectUserId = first(query.subjectUserId) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<Report>>(`/v1/admin/reports${queryString({ status, targetType, targetId, reporterId, subjectUserId, cursor, limit: "30" })}`, { token: session.token });
  const returnTo = `/reports${queryString({ status, targetType, targetId, reporterId, subjectUserId, cursor })}`;
  return <>
    <PageHeader eyebrow="TRUST & SAFETY" title="신고 관리" description="신고 상태와 콘텐츠/사용자 조치를 하나의 서버 트랜잭션으로 처리하도록 요청합니다." />
    <Feedback searchParams={query} />
    <FilterBar><label>대상 유형<select name="targetType" defaultValue={targetType}><option value="">전체</option>{["POST", "COMMENT", "SNAP", "USER", "EXCHANGE_LISTING", "WANTED_REQUEST"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label><label>대상 ID<input name="targetId" defaultValue={targetId} placeholder="UUID" /></label><label>신고자 ID<input name="reporterId" defaultValue={reporterId} placeholder="UUID" /></label><label>작성자/대상 회원 ID<input name="subjectUserId" defaultValue={subjectUserId} placeholder="UUID" /></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PENDING", "REVIEWING", "RESOLVED", "REJECTED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="처리할 신고가 없습니다." /> : <table className="data-table"><thead><tr><th>대상</th><th>사유</th><th>신고자</th><th>상태</th><th>접수</th><th>처리</th></tr></thead><tbody>{page.items.map((report) => <tr key={report.id}>
      <td className="wide-cell"><strong>{report.targetType} · {report.targetStatus || "대상 없음"}</strong><br /><span>{preview(report.targetPreview, 180)}</span><br /><span className="muted">{shortId(report.targetId)} · 신고 {shortId(report.id)}</span></td>
      <td className="wide-cell"><strong>{report.reason}</strong><br /><span className="muted">{preview(report.details, 150)}</span></td><td>{shortId(report.reporterId)}</td><td><StatusBadge value={report.status} /></td><td>{formatDate(report.createdAt)}</td>
      <td>{report.status === "RESOLVED" || report.status === "REJECTED" ? <span className="muted">{preview(report.resolution, 80)}<br />{formatDate(report.resolvedAt)}</span> : <div className="stack-form">
        {report.status === "PENDING" ? <details className="inline-details"><summary>검토 시작</summary><form action={startReportReview}><input type="hidden" name="reportId" value={report.id} /><ReturnTo value={returnTo} /><ReasonField label="검토 시작 사유" /><div className="form-actions"><button className="secondary">REVIEWING으로 전환</button></div></form></details> : null}
        <details className="inline-details"><summary>판정</summary><form action={resolveReport}><input type="hidden" name="reportId" value={report.id} /><ReturnTo value={returnTo} />
          <label>처리 상태<select name="status"><option value="RESOLVED">{statusLabel("RESOLVED")}</option><option value="REJECTED">{statusLabel("REJECTED")}</option></select></label>
          <label>조치<select name="action"><option value="NO_ACTION">{statusLabel("NO_ACTION")}</option>{report.targetType === "POST" || report.targetType === "SNAP" ? <option value="HIDE_POST">{statusLabel("HIDE_POST")}</option> : null}{report.targetType === "COMMENT" ? <option value="HIDE_COMMENT">{statusLabel("HIDE_COMMENT")}</option> : null}{report.targetType === "EXCHANGE_LISTING" ? <option value="HIDE_EXCHANGE_LISTING">{statusLabel("HIDE_EXCHANGE_LISTING")}</option> : null}{report.targetType === "WANTED_REQUEST" ? <option value="HIDE_WANTED_REQUEST">{statusLabel("HIDE_WANTED_REQUEST")}</option> : null}<option value="WARN_USER">{statusLabel("WARN_USER")}</option><option value="SUSPEND_USER">{statusLabel("SUSPEND_USER")}</option></select></label>
          <label>정지 종료 시각 (한국 시간)<input type="datetime-local" name="suspendUntil" /></label><ReasonField label="판정 근거" /><div className="form-actions"><button className="danger">처리 확정</button></div>
        </form></details>
      </div>}</td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/reports" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
