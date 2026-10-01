import Link from "next/link";
import { statusLabel, EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../components/operations";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CursorPage, Inquiry, SearchParams } from "../../../lib/admin-types";

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("inquiries.manage");
  const q = first(query.q) || ""; const status = first(query.status) || ""; const userId = first(query.userId) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<Inquiry>>(`/v1/admin/inquiries${queryString({ q, status, userId, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="CUSTOMER SUPPORT" title="문의 관리" description="문의 내용과 대화에 필요한 최소 식별자만 표시하며, 답변과 상태 변경을 함께 기록합니다." />
    <Feedback searchParams={query} />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="제목 · 분류 · 문의 ID" maxLength={120} /></label><label>사용자 ID<input name="userId" defaultValue={userId} placeholder="UUID" /></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PENDING", "IN_PROGRESS", "ANSWERED", "CLOSED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="조건에 맞는 문의가 없습니다." /> : <table className="data-table"><thead><tr><th>문의</th><th>분류</th><th>상태</th><th>접수</th><th>담당</th><th>작업</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td className="wide-cell"><strong>{item.title}</strong><br /><span className="muted">사용자 {shortId(item.userId)} · 문의 {shortId(item.id)}</span></td><td>{item.category}</td><td><StatusBadge value={item.status} /></td><td>{formatDate(item.createdAt)}</td><td>{shortId(item.assignedAdminId)}</td><td><Link className="button-link" href={`/inquiries/${encodeURIComponent(item.id)}`}>대화 보기</Link></td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/inquiries" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
