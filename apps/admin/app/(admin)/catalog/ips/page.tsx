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
    <PageHeader eyebrow="CANONICAL CATALOG" title="IP 관리" description="검색과 별칭에 사용되는 정규 IP 레코드를 관리합니다. 앱은 이 서버 카탈로그를 기준으로 식별합니다." />
    <Feedback searchParams={query} />
    <section className="panel"><div className="panel-heading"><div><h2>IP 등록</h2><p>중복 이름과 기존 별칭을 먼저 검색하세요.</p></div></div><IpForm returnTo="/catalog/ips" initialName={requestName} /></section>
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="이름 · 별칭 · 슬러그" maxLength={120} /></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table"><thead><tr><th>IP</th><th>별칭</th><th>상태</th><th>수정</th><th>작업</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td className="wide-cell"><strong>{item.nameKo} / {item.nameEn}</strong><br /><span className="muted">{item.slug} · {shortId(item.id)} · {preview(item.description, 90)}</span></td><td>{preview(item.aliases.join(", "), 100)}</td><td><StatusBadge value={item.isActive} /></td><td>{formatDate(item.updatedAt)}</td>
      <td><details className="inline-details"><summary>수정</summary><IpForm item={item} returnTo={returnTo} /></details></td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/catalog/ips" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
