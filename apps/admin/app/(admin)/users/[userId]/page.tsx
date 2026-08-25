import Link from "next/link";
import { Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate, formatKoreaDateTimeInput, shortId } from "../../../../components/operations";
import { changeUserStatus } from "../../../../lib/actions";
import { adminApi } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { SearchParams, UserDetail } from "../../../../lib/admin-types";

export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<SearchParams> }) {
  const { userId } = await params;
  const query = await searchParams;
  const session = await requireCapability("users.manage");
  const user = await adminApi<UserDetail>(`/v1/admin/users/${encodeURIComponent(userId)}`, { token: session.token });
  const allowedStatuses = session.actor.role === "SUPER_ADMIN" ? ["ACTIVE", "SUSPENDED", "BANNED"] : ["ACTIVE", "SUSPENDED"];
  const isDeleted = user.status === "DELETED";
  const returnTo = `/users/${encodeURIComponent(userId)}`;
  return <>
    <PageHeader eyebrow="USER DETAIL" title={user.nickname} description={`${user.emailMasked} · ${shortId(user.id)}`} actions={<Link className="button-link" href="/users">목록으로</Link>} />
    <Feedback searchParams={query} />
    <dl className="definition-grid">
      <div><dt>상태</dt><dd><StatusBadge value={user.status} /></dd></div><div><dt>역할</dt><dd>{user.role}</dd></div>
      <div><dt>가입일</dt><dd>{formatDate(user.createdAt)}</dd></div><div><dt>정지 종료</dt><dd>{formatDate(user.suspendedUntil)}</dd></div>
      <div><dt>게시물</dt><dd>{user.postCount}</dd></div><div><dt>스냅</dt><dd>{user.snapCount}</dd></div>
      <div><dt>문의</dt><dd>{user.inquiryCount}</dd></div><div><dt>신고 누적</dt><dd>{user.reportCount}</dd></div>
    </dl>
    <section className="panel">
      <div className="panel-heading"><div><h2>관련 운영 내역</h2><p>각 목록의 서버 필터로 이 회원과 연결된 데이터만 조회합니다.</p></div></div>
      <div className="quick-links">
        <Link className="button-link" href={`/posts?authorId=${encodeURIComponent(user.id)}`}>작성 게시물 · Snap</Link>
        <Link className="button-link" href={`/inquiries?userId=${encodeURIComponent(user.id)}`}>문의 내역</Link>
        <Link className="button-link" href={`/reports?subjectUserId=${encodeURIComponent(user.id)}`}>회원·작성물 대상 신고</Link>
        <Link className="button-link" href={`/reports?reporterId=${encodeURIComponent(user.id)}`}>이 회원이 접수한 신고</Link>
      </div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>회원 상태 변경</h2><p>서버가 전이 가능 여부와 권한을 다시 검사합니다.</p></div></div>
      {isDeleted ? <p className="muted">탈퇴 처리된 계정은 일반 상태 변경으로 복구할 수 없습니다. <Link href={`/account-deletions?q=${encodeURIComponent(user.id)}`}>전용 탈퇴 검토 기록</Link>에서 처리 이력을 확인하세요.</p> : <form className="stack-form" action={changeUserStatus}>
        <input type="hidden" name="userId" value={user.id} /><ReturnTo value={returnTo} />
        <div className="field-grid"><label>새 상태<select name="status" defaultValue={allowedStatuses.includes(user.status) ? user.status : "ACTIVE"}>{allowedStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>정지 종료 시각 (한국 시간)<input type="datetime-local" name="suspendedUntil" defaultValue={formatKoreaDateTimeInput(user.suspendedUntil)} /></label></div>
        <ReasonField />
        <div className="form-actions"><button className="danger" type="submit">상태 변경</button></div>
      </form>}
    </section>
  </>;
}
