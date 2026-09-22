import { CharacterForm } from "../../../../components/catalog-forms";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, preview, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { Character, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function CharactersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("catalog.manage");
  const q = first(query.q) || ""; const ipId = first(query.ipId) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<Character>>(`/v1/admin/characters${queryString({ q, ipId, cursor, limit: "30" })}`, { token: session.token });
  const returnTo = `/catalog/characters${queryString({ q, ipId, cursor })}`;
  return <>
    <PageHeader eyebrow="CANONICAL CATALOG" title="캐릭터 관리" description="캐릭터를 정규 IP에 연결하고 검색 별칭과 활성 상태를 관리합니다." />
    <Feedback searchParams={query} />
    <section className="panel"><div className="panel-heading"><div><h2>캐릭터 등록</h2><p>IP ID는 서버 카탈로그의 정규 식별자를 사용하세요.</p></div></div><CharacterForm returnTo="/catalog/characters" /></section>
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="이름 · 별칭" maxLength={120} /></label><label>IP ID<input name="ipId" defaultValue={ipId} maxLength={120} /></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>캐릭터</th><th>IP</th><th>별칭</th><th>상태</th><th>수정</th><th>작업</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td><strong>{item.name}</strong><br /><span className="muted">{shortId(item.id)}</span></td><td>{shortId(item.ipId)}</td><td className="wide-cell">{preview(item.aliases.join(", "), 120)}</td><td><StatusBadge value={item.isActive} /></td><td>{formatDate(item.updatedAt)}</td>
      <td><details className="inline-details"><summary>수정</summary><CharacterForm item={item} returnTo={returnTo} /></details></td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/catalog/characters" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
