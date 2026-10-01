import Link from "next/link";
import { statusLabel,
  EmptyState,
  Feedback,
  FilterBar,
  NextCursor,
  PageHeader,
  StatusBadge,
  first,
  formatDate,
  shortId,
} from "../../../components/operations";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type {
  AdminAccountDeletionRequest,
  CursorPage,
  SearchParams,
} from "../../../lib/admin-types";

function blockerCount(item: AdminAccountDeletionRequest) {
  return Object.values(item.blockers).reduce((total, value) => total + value, 0);
}

export default async function AccountDeletionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("accountDeletions.manage");
  const q = first(query.q) || "";
  const status = first(query.status) || "OPEN";
  const cursor = first(query.cursor) || "";
  const suffix = queryString({ q, status, cursor, limit: "30" });
  const page = await adminApi<CursorPage<AdminAccountDeletionRequest>>(
    `/v1/admin/account-deletions${suffix}`,
    { token: session.token },
  );

  return <>
    <PageHeader
      eyebrow="ACCOUNT EXIT REVIEW"
      title="탈퇴 자동 처리 현황"
      description="관리자 승인 없이 진행되는 개인정보 익명화와 연결 로그인 계정 삭제·재시도 상태를 확인합니다."
    />
    <Feedback searchParams={query} />
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="회원 · 이메일 · 요청 ID" maxLength={200} /></label>
      <label>상태<select name="status" defaultValue={status}>
        <option value="OPEN">미처리 전체</option>
        {[
          "PENDING_REVIEW",
          "BLOCKED",
          "PROCESSING",
          "APPROVED",
          "REJECTED",
          "COMPLETED",
          "CANCELLED",
        ].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
      </select></label>
    </FilterBar>
    <section className="data-panel">
      {page.items.length === 0
        ? <EmptyState title="조건에 맞는 탈퇴 요청이 없습니다." />
        : <table className="data-table"><thead><tr>
          <th>요청</th><th>회원</th><th>상태</th><th>차단 합계</th><th>재요청</th><th>최근 요청</th><th>작업</th>
        </tr></thead><tbody>
          {page.items.map((item) => <tr key={item.id}>
            <td><strong>{shortId(item.id)}</strong></td>
            <td>{item.user.nickname}<br /><span className="muted">{item.user.emailMasked} · {shortId(item.user.id)}</span></td>
            <td><StatusBadge value={item.status} /></td>
            <td>{blockerCount(item)}</td>
            <td>{item.requestCount}회</td>
            <td>{formatDate(item.lastRequestedAt)}</td>
            <td><Link className="button-link" href={`/account-deletions/${encodeURIComponent(item.id)}`}>처리 현황</Link></td>
          </tr>)}
        </tbody></table>}
    </section>
    <NextCursor pathname="/account-deletions" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
