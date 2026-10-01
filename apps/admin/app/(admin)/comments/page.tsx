import { statusLabel, EmptyState, Feedback, FilterBar, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, preview, shortId } from "../../../components/operations";
import { moderateComment } from "../../../lib/actions";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { Comment, CursorPage, SearchParams } from "../../../lib/admin-types";

export default async function CommentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("moderation.manage");
  const q = first(query.q) || ""; const status = first(query.status) || ""; const cursor = first(query.cursor) || "";
  const suffix = queryString({ q, status, cursor, limit: "30" });
  const page = await adminApi<CursorPage<Comment>>(`/v1/admin/comments${suffix}`, { token: session.token });
  const returnTo = `/comments${queryString({ q, status, cursor })}`;
  return <>
    <PageHeader eyebrow="COMMUNITY MODERATION" title="댓글 관리" description="검색과 신고 수를 함께 보고 노출 상태를 조정합니다. 조치 사유는 서버 감사 기록에 남습니다." />
    <Feedback searchParams={query} />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="댓글 내용" maxLength={120} /></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["ACTIVE", "HIDDEN", "DELETED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>댓글</th><th>게시물</th><th>작성자</th><th>상태</th><th>신고</th><th>작성</th><th>조치</th></tr></thead><tbody>{page.items.map((comment) => <tr key={comment.id}>
      <td className="wide-cell">{preview(comment.content, 180)}<br /><span className="muted">{shortId(comment.id)}</span></td><td>{shortId(comment.postId)}</td><td>{comment.authorNickname}<br /><span className="muted">{shortId(comment.authorId)}</span></td><td><StatusBadge value={comment.status} /></td><td>{comment.reportCount}</td><td>{formatDate(comment.createdAt)}</td>
      <td><details className="inline-details"><summary>상태 변경</summary><form action={moderateComment}><input type="hidden" name="commentId" value={comment.id} /><ReturnTo value={returnTo} />
        <label>새 상태<select name="status" defaultValue={comment.status}>{["ACTIVE", "HIDDEN", "DELETED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label><ReasonField /><div className="form-actions"><button className="danger">변경 적용</button></div>
      </form></details></td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/comments" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
