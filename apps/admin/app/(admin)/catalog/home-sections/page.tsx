import Link from "next/link";
import { HomeSectionForm } from "../../../../components/home-section-form";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import { catalogIpChoices, catalogProductChoices } from "../../../../lib/catalog-choices";
import type { AdminHomeSectionList, CatalogIp, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function HomeSectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("catalog.manage");
  const q = first(query.q) || "";
  const cursor = first(query.cursor) || "";
  const ipSuffix = queryString({ q, cursor, limit: "30" });
  const [sections, ips, products] = await Promise.all([
    adminApi<AdminHomeSectionList>("/v1/admin/home-sections", { token: session.token }),
    catalogIpChoices(session.token), catalogProductChoices(session.token),
  ]);
  const productChoices = products.map(({ id, name }) => ({ id, name }));
  const returnTo = `/catalog/home-sections${queryString({ q, cursor })}`;
  return <>
    <PageHeader eyebrow="MOBILE HOME" title="홈 구성" description="관리자 섹션은 제한 없이 추가할 수 있습니다. 수동·IP·신상품·인기 기준과 가챠·쿠지 카드 레이아웃을 각각 지정할 수 있습니다." />
    <Feedback searchParams={query} />
    <details className="panel admin-create-details"><summary>＋ 홈 영역 추가 <span>처음에는 비노출로 저장됩니다</span></summary><HomeSectionForm ips={ips} products={productChoices} returnTo={returnTo} configured={sections.configured} /></details>
    <p className="muted">작품이 없으면 <Link href="/catalog/ips">작품 등록</Link>을 먼저 해주세요.</p>
    <section className="data-panel">{sections.items.length === 0 ? <EmptyState title="등록된 홈 섹션이 없습니다." description="홈 상품 레일을 표시하려면 첫 관리자 섹션을 생성하세요." /> : <table className="data-table"><thead><tr><th>순서 / 제목</th><th>구성 / 카드</th><th>연결 IP</th><th>노출</th><th>수정일</th><th>작업</th></tr></thead><tbody>{sections.items.map((item) => {
      const ip = ips.find((candidate) => candidate.id === item.ipId);
      const layoutLabel = item.layoutKind === "gacha" ? "가챠" : item.layoutKind === "kuji" ? "쿠지" : null;
      const sourceLabel = item.sourceKind === "MANUAL" ? "수동 선택" : item.sourceKind === "IP" ? "IP 최신순" : item.sourceKind === "NEW" ? "최근 신상품" : "최근 인기순";
      return <tr key={item.id}><td><strong>{item.sortOrder}. {item.title}</strong>{item.subtitle ? <><br /><span className="muted">{item.subtitle}</span></> : null}</td><td><strong>{sourceLabel}</strong><br /><span className="muted">{layoutLabel ?? "상품 유형 선택 필요"} · 최대 {item.visibleLimit}개{item.sourceKind === "MANUAL" ? ` · 선택 ${item.manualProductIds.length}개` : ""}</span></td><td>{ip ? ip.nameKo : item.ipId ? "현재 연결된 작품" : "전체 작품"}</td><td><StatusBadge value={item.isActive} />{item.isActive ? <><br /><span className="muted">공개 상품이 있을 때 표시</span></> : null}</td><td>{formatDate(item.updatedAt)}</td><td><details className="inline-details"><summary>수정</summary><HomeSectionForm item={item} ips={ips} products={productChoices} returnTo={returnTo} configured={sections.configured} /></details></td></tr>;
    })}</tbody></table>}</section>
  </>;
}
