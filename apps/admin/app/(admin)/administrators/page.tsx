import { EmptyState, Feedback, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, shortId } from "../../../components/operations";
import { changeAdministrator, createAdministrator } from "../../../lib/actions";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";
import type { CursorPage, SearchParams, UserSummary } from "../../../lib/admin-types";

export default async function AdministratorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("administrators.manage");
  const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<UserSummary>>(`/v1/admin/administrators${queryString({ cursor, limit: "30" })}`, { token: session.token });
  const returnTo = `/administrators${queryString({ cursor })}`;
  return <>
    <PageHeader eyebrow="SUPER ADMIN ONLY" title="관리자 계정" description="최소 권한 원칙에 따라 운영 계정을 발급합니다. 이 화면과 생성 API는 SUPER_ADMIN 전용입니다." />
    <Feedback searchParams={query} />
    <section className="panel">
      <div className="panel-heading"><div><h2>관리자 생성</h2><p>임시 비밀번호는 안전한 별도 채널로 전달하고 즉시 교체하도록 안내하세요.</p></div></div>
      <form className="stack-form" action={createAdministrator}>
        <ReturnTo value="/administrators" />
        <div className="field-grid">
          <label>이메일<input type="email" name="email" maxLength={254} required /></label><label>닉네임<input name="nickname" minLength={2} maxLength={40} required /></label>
          <label>임시 비밀번호<input type="password" name="password" minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          <label>역할<select name="role"><option>ADMIN</option><option>SUPER_ADMIN</option></select></label>
        </div><ReasonField label="발급 사유" /><div className="form-actions"><button className="primary" type="submit">관리자 발급</button></div>
      </form>
    </section>
    <section className="data-panel">
      {page.items.length === 0 ? <EmptyState title="등록된 관리자 계정이 없습니다." /> : <table className="data-table"><thead><tr><th>관리자</th><th>역할</th><th>상태</th><th>생성일</th><th>권한/상태 변경</th></tr></thead><tbody>{page.items.map((admin) => <tr key={admin.id}>
        <td><strong>{admin.nickname}</strong><br /><span className="muted">{admin.emailMasked} · {shortId(admin.id)}</span></td><td>{admin.role}</td><td><StatusBadge value={admin.status} /></td><td>{formatDate(admin.createdAt)}</td><td>{admin.id === session.actor.userId ? <span className="muted">현재 계정</span> : <details className="inline-details"><summary>변경</summary><form action={changeAdministrator}><input type="hidden" name="userId" value={admin.id} /><ReturnTo value={returnTo} /><label>역할<select name="role" defaultValue={admin.role}><option>ADMIN</option><option>SUPER_ADMIN</option></select></label><label>상태<select name="status" defaultValue={admin.status}>{["ACTIVE", "SUSPENDED", "BANNED"].map((value) => <option key={value}>{value}</option>)}</select></label><ReasonField label="변경 사유" /><div className="form-actions"><button className="danger">변경 적용</button></div></form></details>}</td>
      </tr>)}</tbody></table>}
    </section><NextCursor pathname="/administrators" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
