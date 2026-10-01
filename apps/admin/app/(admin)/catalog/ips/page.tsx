import { IpForm } from "../../../../components/catalog-forms";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, preview, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { CatalogIp, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function IpsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("catalog.manage");
  const q = first(query.q) || ""; const requestName = first(query.requestName) || ""; const cursor = first(query.cursor) || ""; const suffix = queryString({ q, cursor, limit: "30" });
  const page = await adminApi<CursorPage<CatalogIp>>(`/v1/admin/ips${suffix}`, { token: session.token });
  const returnTo = `/catalog/ips${queryString({ q, cursor })}`;
  return <>
    <PageHeader eyebrow="작품" title="작품 관리" description="상품에 연결할 작품 이름과 검색 별칭을 관리하세요." />
    <Feedback searchParams={query} />
    <details className="panel admin-create-details" open={Boolean(requestName)}><summary>＋ 작품 등록</summary><IpForm returnTo="/catalog/ips" initialName={requestName} /></details>
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="이름 · 별칭 · 슬러그" maxLength={120} /></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>IP</th><th>별칭</th><th>상태</th><th>수정</th><th>작업</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td className="wide-cell"><strong>{item.nameKo}</strong><br /><span className="muted">{preview(item.description, 90)}</span></td><td>{preview(item.aliases.join(", "), 100)}</td><td><StatusBadge value={item.isActive} /></td><td>{formatDate(item.updatedAt)}</td>
      <td><details className="inline-details"><summary>수정</summary><IpForm item={item} returnTo={returnTo} /></details></td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/catalog/ips" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
