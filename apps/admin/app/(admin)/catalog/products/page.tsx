import Link from "next/link";
import { ProductForm, ProductImageForm } from "../../../../components/catalog-forms";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { CatalogProduct, CursorPage, SearchParams } from "../../../../lib/admin-types";

const SALE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "작성 중",
  COMING_SOON: "오픈 예정",
  ON_SALE: "판매 중",
  PAUSED: "판매 중지",
};

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
    <PageHeader eyebrow="상품" title="상품 관리" description="상품을 찾거나 새로 등록할 수 있어요. 판매 상태를 바꾸기 전에는 사진·가격·재고를 확인해 주세요." />
    <Feedback searchParams={query} />
    <details className="panel admin-create-details" open={Boolean(requestName || afterCreate)}>
      <summary>＋ 새 상품 등록 <span>처음에는 작성 중으로 저장됩니다</span></summary>
      <p className="muted">① 기본 정보를 입력하고 저장하세요. ② 등록된 상품에서 사진과 가챠·쿠지 구성을 추가하세요. ③ 모두 준비되면 판매 상태를 바꾸세요.</p>
      <ProductForm
        returnTo={formReturnTo}
        initialName={requestName}
        initialIpId={ipId}
        initialPrizeOnly={prizeOnly === "true"}
      />
    </details>
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="상품명 · SKU · 제조사" maxLength={120} /></label>
      <label>카테고리<select name="category" defaultValue={category}><option value="">전체</option>{["gacha", "figure", "kuji", "tcg"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>상품 용도<select name="prizeOnly" defaultValue={prizeOnly}><option value="">전체</option><option value="false">판매 상품</option><option value="true">경품 전용</option></select></label>
      <label>판매 상태<select name="saleStatus" defaultValue={saleStatus}><option value="">전체</option><option value="DRAFT">작성 중</option><option value="COMING_SOON">오픈 예정</option><option value="ON_SALE">판매 중</option><option value="PAUSED">판매 중지</option></select></label>
      <details className="filter-bar__advanced"><summary>자세히 찾기</summary><div>
        <label>IP ID<input name="ipId" defaultValue={ipId} maxLength={120} /></label>
        <label>캐릭터 ID<input name="characterId" defaultValue={characterId} placeholder="UUID" /></label>
      </div></details>
    </FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState /> : <table className="data-table">
      <thead><tr><th>상품</th><th>종류</th><th>가격·재고</th><th>상태</th><th>관리</th></tr></thead>
      <tbody>{page.items.map((item) => <tr key={item.id}>
        <td className="wide-cell"><strong>{item.name}</strong><br /><span className="muted">SKU {item.sku} · {shortId(item.id)}</span></td>
        <td>{item.category === "gacha" ? "가챠" : item.category === "kuji" ? "쿠지" : item.category}<br /><span className="catalog-kind-badge" data-prize-only={String(item.isPrizeOnly)}>{item.isPrizeOnly ? "경품 전용" : "판매 상품"}</span></td>
        <td><strong>{item.price === null ? "가격 공개 예정" : `${item.price.toLocaleString("ko-KR")}원`}</strong><br /><span className="muted">재고 {item.availableQuantity.toLocaleString("ko-KR")}개</span></td>
        <td><StatusBadge value={item.isActive} /><br /><span className="muted">{SALE_STATUS_LABELS[item.saleStatus] ?? item.saleStatus}</span></td>
        <td>
          {!item.isPrizeOnly && (item.category === "gacha" || item.category === "kuji") ? <Link className="button-link" href={`/catalog/products/${encodeURIComponent(item.id)}/draws`}>{item.category === "kuji" ? "쿠지 상 구성" : "확률표"}</Link> : null}
          <details className="inline-details"><summary>수정</summary><ProductForm item={item} returnTo={returnTo} /></details>
          <details className="inline-details"><summary>사진 자르기·업로드</summary><ProductImageForm item={item} returnTo={returnTo} /></details>
        </td>
      </tr>)}</tbody>
    </table>}</section>
    <NextCursor pathname="/catalog/products" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
