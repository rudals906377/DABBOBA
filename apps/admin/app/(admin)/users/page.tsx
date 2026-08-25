import Link from "next/link";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../components/operations";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CursorPage, SearchParams, UserSummary } from "../../../lib/admin-types";

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("users.manage");
  const q = first(query.q) || "";
  const status = first(query.status) || "";
  const cursor = first(query.cursor) || "";
  const suffix = queryString({ q, status, cursor, limit: "30" });
  const page = await adminApi<CursorPage<UserSummary>>(`/v1/admin/users${suffix}`, { token: session.token });

  return <>
    <PageHeader eyebrow="IDENTITY & SAFETY" title="회원 관리" description="마스킹된 식별 정보와 활동 집계만 표시합니다. 원본 개인정보는 운영 화면에 노출하지 않습니다." />
    <Feedback searchParams={query} />
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="닉네임 · 마스킹 이메일 · ID" maxLength={120} /></label>
      <label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["ACTIVE", "SUSPENDED", "BANNED", "DELETED"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </FilterBar>
    <section className="data-panel">
      {page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>회원</th><th>역할</th><th>상태</th><th>활동</th><th>가입</th><th>작업</th></tr></thead><tbody>
        {page.items.map((user) => <tr key={user.id}>
          <td><strong>{user.nickname}</strong><br /><span className="muted">{user.emailMasked} · {shortId(user.id)}</span></td>
          <td>{user.role}</td><td><StatusBadge value={user.status} />{user.suspendedUntil ? <><br /><span className="muted">~ {formatDate(user.suspendedUntil)}</span></> : null}</td>
          <td>게시물 {user.postCount} · 신고 {user.reportCount}</td><td>{formatDate(user.createdAt)}</td>
          <td><Link className="button-link" href={`/users/${encodeURIComponent(user.id)}`}>상세 · 상태 변경</Link></td>
        </tr>)}
      </tbody></table>}
    </section>
    <NextCursor pathname="/users" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
