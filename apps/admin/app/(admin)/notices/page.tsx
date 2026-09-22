import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, preview, shortId } from "../../../components/operations";
import { changeNoticeVisibility, createNotice, deleteNotice, restoreNotice, updateNotice } from "../../../lib/actions";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CursorPage, Notice, SearchParams } from "../../../lib/admin-types";

function NoticeFields({ notice }: { notice?: Notice }) {
  return <div className="field-grid">
    <label className="span-2">제목<input name="title" defaultValue={notice?.title} maxLength={160} required /></label>
    <label className="span-2">내용<textarea name="content" defaultValue={notice?.content} maxLength={30000} required /></label>
    <label className="check-field"><input type="checkbox" name="isPinned" defaultChecked={notice?.isPinned} /> 상단 고정</label>
    <label className="check-field"><input type="checkbox" name="isPublished" defaultChecked={notice?.isPublished} disabled={notice?.status === "HIDDEN"} /> 즉시 게시{notice?.status === "HIDDEN" ? " (숨김 해제 후 가능)" : ""}</label>
  </div>;
}

export default async function NoticesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("notices.manage");
  const q = first(query.q) || ""; const cursor = first(query.cursor) || "";
  const suffix = queryString({ q, cursor, limit: "30" });
  const page = await adminApi<CursorPage<Notice>>(`/v1/admin/notices${suffix}`, { token: session.token });
  const returnTo = `/notices${suffix.replace(/([?&])limit=30(&|$)/, "$1").replace(/[?&]$/, "")}`;
  return <>
    <PageHeader eyebrow="SERVICE COMMUNICATION" title="공지사항" description="초안과 게시 상태를 함께 관리합니다. 삭제는 복구 가능한 숨김 처리로 API에 요청합니다." />
    <Feedback searchParams={query} />
    <section className="panel"><div className="panel-heading"><div><h2>공지 작성</h2><p>게시 전 제목, 본문과 노출 상태를 확인하세요.</p></div></div>
      <form className="stack-form" action={createNotice}><ReturnTo value="/notices" /><NoticeFields /><ReasonField label="작성 사유" /><div className="form-actions"><button className="primary">공지 생성</button></div></form>
    </section>
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="제목 · 본문" maxLength={120} /></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>공지</th><th>노출</th><th>상태</th><th>수정</th><th>작업</th></tr></thead><tbody>{page.items.map((notice) => <tr key={notice.id}>
      <td className="wide-cell"><strong>{notice.isPinned ? "[고정] " : ""}{notice.title}</strong><br /><span className="muted">{preview(notice.content, 130)} · {shortId(notice.id)}</span></td>
      <td><StatusBadge value={notice.isPublished} /></td><td><StatusBadge value={notice.status} /></td><td>{formatDate(notice.updatedAt)}</td>
      <td><details className="inline-details"><summary>{notice.status === "DELETED" ? "복구" : "수정 / 상태"}</summary>
        {notice.status === "DELETED" ? <form action={restoreNotice}><input type="hidden" name="noticeId" value={notice.id} /><input type="hidden" name="expectedVersion" value={notice.version} /><ReturnTo value={returnTo} /><ReasonField label="복구 사유" /><div className="form-actions"><button className="primary">미게시 상태로 복구</button></div></form> : <><form action={updateNotice}><input type="hidden" name="noticeId" value={notice.id} /><input type="hidden" name="expectedVersion" value={notice.version} /><ReturnTo value={returnTo} /><NoticeFields notice={notice} /><ReasonField label="수정 사유" /><div className="form-actions"><button className="primary">수정 저장</button></div></form>
        <form action={changeNoticeVisibility}><input type="hidden" name="noticeId" value={notice.id} /><input type="hidden" name="expectedVersion" value={notice.version} /><input type="hidden" name="status" value={notice.status === "HIDDEN" ? "ACTIVE" : "HIDDEN"} /><ReturnTo value={returnTo} /><ReasonField label={notice.status === "HIDDEN" ? "숨김 해제 사유" : "숨김 사유"} /><div className="form-actions"><button>{notice.status === "HIDDEN" ? "숨김 해제" : "공지 숨김"}</button></div></form>
        <form action={deleteNotice}><input type="hidden" name="noticeId" value={notice.id} /><input type="hidden" name="expectedVersion" value={notice.version} /><ReturnTo value={returnTo} /><ReasonField label="삭제 사유" /><div className="form-actions"><button className="danger">공지 삭제</button></div></form></>}
      </details></td>
    </tr>)}</tbody></table>}</section>
    <NextCursor pathname="/notices" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
