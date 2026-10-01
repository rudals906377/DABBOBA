import Link from "next/link";
import { ProductForm } from "../../../../components/catalog-forms";
import { EmptyState, Feedback, FilterBar, NextCursor, PageHeader, StatusBadge, first, safeExternalUrl } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import { catalogIpChoices } from "../../../../lib/catalog-choices";
import type { CatalogProduct, CursorPage, SearchParams } from "../../../../lib/admin-types";

const SALE_STATUS_LABELS: Record<string, string> = { DRAFT: "작성 중", COMING_SOON: "오픈 예정", ON_SALE: "판매 중", PAUSED: "판매 중지" };
const CATEGORY_LABELS: Record<string, string> = { gacha: "가챠", kuji: "쿠지", figure: "피규어", tcg: "카드" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("catalog.manage");
  const q = first(query.q) || "";
  const requestName = first(query.requestName) || "";
  const category = first(query.category) || "";
  const ipId = first(query.ipId) || "";
  const characterId = first(query.characterId) || "";
  const rawPrizeOnly = first(query.prizeOnly) ?? "false";
  const prizeOnly = rawPrizeOnly === "true" || rawPrizeOnly === "false" ? rawPrizeOnly : "";
  const saleStatus = first(query.saleStatus) || "";
  const afterCreate = first(query.afterCreate) || "";
  const cursor = first(query.cursor) || "";
  const [page, ips] = await Promise.all([
    adminApi<CursorPage<CatalogProduct>>(`/v1/admin/products${queryString({ q, category, ipId, characterId, prizeOnly, saleStatus, cursor, limit: "30" })}`, { token: session.token }),
    catalogIpChoices(session.token),
  ]);
  const formReturnTo = prizeOnly === "true" && afterCreate ? afterCreate : `/catalog/products${queryString({ q, category, ipId, characterId, prizeOnly, saleStatus })}`;
  return <>
    <PageHeader eyebrow="상품" title="상품 관리" description="상품을 선택해 정보·사진·구성을 관리하세요." />
    <Feedback searchParams={query} />
    <details className="panel admin-create-details" open={Boolean(requestName || afterCreate)}>
      <summary>＋ 새 상품 등록 <span>기본 정보부터 입력하세요</span></summary>
      <ProductForm returnTo={formReturnTo} ips={ips} initialName={requestName} initialIpId={ipId} initialPrizeOnly={prizeOnly === "true"} />
    </details>
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="상품명 · 제조사" maxLength={120} /></label>
      <label>상품 종류<select name="category" defaultValue={category}><option value="">전체</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>상품 용도<select name="prizeOnly" defaultValue={prizeOnly || "all"}><option value="false">판매 상품</option><option value="true">구성 상품</option><option value="all">전체</option></select></label>
      <label>판매 상태<select name="saleStatus" defaultValue={saleStatus}><option value="">전체</option>{Object.entries(SALE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <details className="filter-bar__advanced" open={Boolean(ipId || characterId)}><summary>작품으로 찾기</summary><div>
        <label>작품<select name="ipId" defaultValue={ipId}><option value="">전체 작품</option>{ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}</option>)}</select></label>
        {characterId ? <input type="hidden" name="characterId" value={characterId} /> : null}
      </div></details>
    </FilterBar>
    {page.items.length === 0 ? <section className="panel"><EmptyState /></section> : <div className="catalog-product-list">{page.items.map((item) => {
      const image = safeExternalUrl(item.storefrontImageUrl || item.imageUrl);
      const path = `/catalog/products/${encodeURIComponent(item.id)}`;
      return <article key={item.id} className="catalog-product-card">
        <Link className="catalog-product-card__identity" href={path}>
          {image ? <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="catalog-product-card__placeholder">사진 없음</span>}
          <span><small>{ips.find((ip) => ip.id === item.ipId)?.nameKo ?? "작품"} · {CATEGORY_LABELS[item.category]}</small><strong>{item.name}</strong></span>
        </Link>
        <div className="catalog-product-card__summary"><strong>{item.price === null ? "가격 미정" : `${item.price.toLocaleString("ko-KR")}원`}</strong><span>재고 {item.availableQuantity.toLocaleString("ko-KR")}개</span><StatusBadge value={item.isPrizeOnly ? "구성 상품" : SALE_STATUS_LABELS[item.saleStatus]} />{!item.isActive ? <StatusBadge value={false} /> : null}</div>
        <div className="quick-links"><Link className="button-link" href={path}>상품 수정</Link><Link className="button-link" href={`${path}#photos`}>사진 관리</Link>{!item.isPrizeOnly && (item.category === "gacha" || item.category === "kuji") ? <Link className="button-link" href={`${path}/draws`}>{item.category === "kuji" ? "쿠지 상 구성" : "가챠 구성"}</Link> : null}</div>
      </article>;
    })}</div>}
    <NextCursor pathname="/catalog/products" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
