import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, preview, shortId } from "../../../components/operations";
import { moderatePost } from "../../../lib/actions";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CommunityPost, CursorPage, SearchParams } from "../../../lib/admin-types";

export default async function PostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("moderation.manage");
  const q = first(query.q) || ""; const status = first(query.status) || ""; const kind = first(query.kind) || ""; const authorId = first(query.authorId) || ""; const ipId = first(query.ipId) || ""; const cursor = first(query.cursor) || "";
  const suffix = queryString({ q, status, kind, authorId, ipId, cursor, limit: "30" });
  const page = await adminApi<CursorPage<CommunityPost>>(`/v1/admin/posts${suffix}`, { token: session.token });
  const returnTo = `/posts${queryString({ q, status, kind, authorId, ipId, cursor })}`;
  return <>
    <PageHeader eyebrow="COMMUNITY MODERATION" title="게시물 관리" description="물리 삭제 없이 노출 상태를 전환합니다. 콘텐츠 원문은 제재 판단에 필요한 범위로만 확인하세요." />
    <Feedback searchParams={query} />
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="제목 · 본문" maxLength={120} /></label>
      <label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["ACTIVE", "HIDDEN", "DELETED"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label>유형<select name="kind" defaultValue={kind}><option value="">전체</option>{["DUKROOM", "SNAP", "GENERAL"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label>작성자 ID<input name="authorId" defaultValue={authorId} placeholder="UUID" /></label><label>IP ID<input name="ipId" defaultValue={ipId} maxLength={120} /></label>
    </FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>게시물</th><th>작성자</th><th>상태</th><th>신고/댓글</th><th>작성</th><th>조치</th></tr></thead><tbody>{page.items.map((post) => <tr key={post.id}>
      <td className="wide-cell"><strong>[{post.kind}] {post.title}</strong><br /><span className="muted">{preview(post.content, 150)} · {shortId(post.id)}</span>{post.mediaIds.length ? <><br /><span className="muted">첨부 {post.mediaIds.map((mediaId, index) => <span key={mediaId}>{index ? " · " : ""}<a href={`/api/media/${encodeURIComponent(mediaId)}`} target="_blank" rel="noreferrer noopener">이미지 {index + 1}</a></span>)}</span></> : null}</td>
      <td>{post.authorNickname}<br /><span className="muted">{shortId(post.authorId)}</span></td><td><StatusBadge value={post.status} /></td><td>신고 {post.reportCount} · 댓글 {post.commentCount}</td><td>{formatDate(post.createdAt)}</td>
      <td><details className="inline-details"><summary>상태 변경</summary><form action={moderatePost}><input type="hidden" name="postId" value={post.id} /><ReturnTo value={returnTo} />
        <label>새 상태<select name="status" defaultValue={post.status}>{["ACTIVE", "HIDDEN", "DELETED"].map((v) => <option key={v}>{v}</option>)}</select></label><ReasonField /><div className="form-actions"><button className="danger">변경 적용</button></div>
      </form></details></td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/posts" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
