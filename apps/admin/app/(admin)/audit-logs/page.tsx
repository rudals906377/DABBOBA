import { EmptyState, FilterBar, NextCursor, PageHeader, first, formatDate, privacySafeMetadata, shortId } from "../../../components/operations";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { AdminAuditLog, CursorPage, SearchParams } from "../../../lib/admin-types";

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("audit.read");
  const q = first(query.q) || ""; const action = first(query.action) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<AdminAuditLog>>(`/v1/admin/audit-logs${queryString({ q, action, cursor, limit: "50" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="PERMISSION CONTROLLED · APPEND ONLY" title="감사 로그" description="특권 작업의 관리자, 대상, 시각과 사유 메타데이터를 조회합니다. 민감 키는 화면에서 추가 마스킹합니다." />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="관리자 · 대상 · 작업" maxLength={120} /></label><label>작업 코드<input name="action" defaultValue={action} maxLength={100} /></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="조건에 맞는 감사 로그가 없습니다." /> : <table className="data-table"><thead><tr><th>시각/요청</th><th>관리자</th><th>작업/사유</th><th>대상</th><th>API 연결 정보</th><th>메타데이터</th></tr></thead><tbody>{page.items.map((log) => <tr key={log.id}>
      <td>{formatDate(log.createdAt)}<br /><span className="muted">{shortId(log.requestId)}</span></td><td>{log.adminEmailMasked}<br /><span className="muted">{shortId(log.adminId)}</span></td><td><strong>{log.action}</strong><br /><span className="muted">{log.reason}</span></td><td>{log.targetType}<br /><span className="muted">{shortId(log.targetId)}</span></td><td>{log.ipAddressMasked || "-"}<br /><span className="muted">{log.clientLabel || "브라우저 정보 없음"}</span></td><td><pre className="metadata">{JSON.stringify(privacySafeMetadata(log.metadata), null, 2)}</pre></td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/audit-logs" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
