import Link from "next/link";
import { ProductForm, ProductImageForm } from "../../../../components/catalog-forms";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { CatalogProduct, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("catalog.manage");
  const q = first(query.q) || "";
  const requestName = first(query.requestName) || "";
  const category = first(query.category) || "";
  const ipId = first(query.ipId) || "";
  const characterId = first(query.characterId) || "";
  const rawPrizeOnly = first(query.prizeOnly) || "";
  const prizeOnly = rawPrizeOnly === "true" || rawPrizeOnly === "false" ? rawPrizeOnly : "";
  const saleStatus = first(query.saleStatus) || "";
  const afterCreate = first(query.afterCreate) || "";
  const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<CatalogProduct>>(`/v1/admin/products${queryString({
    q, category, ipId, characterId, prizeOnly, saleStatus, cursor, limit: "30",
  })}`, { token: session.token });
  const returnTo = `/catalog/products${queryString({ q, category, ipId, characterId, prizeOnly, saleStatus, cursor })}`;
  const formReturnTo = prizeOnly === "true" && afterCreate
    ? afterCreate
    : `/catalog/products${queryString({ q, category, ipId, characterId, prizeOnly, saleStatus })}`;

  return <>
    <PageHeader eyebrow="SERVER-OWNED COMMERCE" title="상품 관리" description="가격과 가용 수량은 서버 카탈로그가 원본입니다. 변경 사유를 확인한 뒤 적용하세요." />
    <Feedback searchParams={query} />
    <section className="panel">
      <div className="panel-heading"><div><h2>상품 등록</h2><p>판매 상품과 추첨 경품 전용 SKU를 용도에 맞게 등록합니다.</p></div></div>
      <ProductForm
        returnTo={formReturnTo}
        initialName={requestName}
        initialIpId={ipId}
        initialPrizeOnly={prizeOnly === "true"}
      />
    </section>
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="상품명 · SKU · 제조사" maxLength={120} /></label>
      <label>카테고리<select name="category" defaultValue={category}><option value="">전체</option>{["gacha", "figure", "kuji", "tcg"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>상품 용도<select name="prizeOnly" defaultValue={prizeOnly}><option value="">전체</option><option value="false">판매 상품</option><option value="true">경품 전용</option></select></label>
      <label>판매 상태<select name="saleStatus" defaultValue={saleStatus}><option value="">전체</option><option value="DRAFT">작성 중</option><option value="COMING_SOON">오픈 예정</option><option value="ON_SALE">판매 중</option><option value="PAUSED">판매 중지</option></select></label>
      <label>IP ID<input name="ipId" defaultValue={ipId} maxLength={120} /></label>
      <label>캐릭터 ID<input name="characterId" defaultValue={characterId} placeholder="UUID" /></label>
    </FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table">
      <thead><tr><th>상품</th><th>분류/IP</th><th>용도</th><th>가격</th><th>가용 수량</th><th>상태</th><th>수정</th><th>작업</th></tr></thead>
      <tbody>{page.items.map((item) => <tr key={item.id}>
        <td className="wide-cell"><strong>{item.name}</strong><br /><span className="muted">SKU {item.sku} · {shortId(item.id)}</span></td>
        <td>{item.category}<br /><span className="muted">{shortId(item.ipId)}</span></td>
        <td><span className="catalog-kind-badge" data-prize-only={String(item.isPrizeOnly)}>{item.isPrizeOnly ? "경품 전용" : "판매 상품"}</span></td>
        <td>{item.price === null ? "가격 공개 예정" : `${item.price.toLocaleString("ko-KR")}원`}</td>
        <td>{item.availableQuantity.toLocaleString("ko-KR")}</td>
        <td><StatusBadge value={item.isActive} /><br /><span className="muted">{item.saleStatus}</span></td>
        <td>{formatDate(item.updatedAt)}</td>
        <td>
          {!item.isPrizeOnly && (item.category === "gacha" || item.category === "kuji") ? <Link className="button-link" href={`/catalog/products/${encodeURIComponent(item.id)}/draws`}>{item.category === "kuji" ? "쿠지 상 구성" : "확률표"}</Link> : null}
          <details className="inline-details"><summary>수정</summary><ProductForm item={item} returnTo={returnTo} /></details>
          <details className="inline-details"><summary>사진</summary><ProductImageForm item={item} returnTo={returnTo} /></details>
        </td>
      </tr>)}</tbody>
    </table>}</section>
    <NextCursor pathname="/catalog/products" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
