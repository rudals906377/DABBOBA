import Link from "next/link";
import { ProductForm, ProductImageForm } from "../../../../../components/catalog-forms";
import { Feedback, PageHeader } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import { catalogIpChoices } from "../../../../../lib/catalog-choices";
import type { CatalogProduct, SearchParams } from "../../../../../lib/admin-types";

export default async function ProductEditor({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireCapability("catalog.manage");
  const { productId } = await params;
  const path = `/catalog/products/${encodeURIComponent(productId)}`;
  const [item, ips, query] = await Promise.all([
    adminApi<CatalogProduct>(`/v1/admin/products/${encodeURIComponent(productId)}`, { token: session.token }), catalogIpChoices(session.token), searchParams,
  ]);
  return <>
    <PageHeader eyebrow="상품" title={item.name} description="기본 정보와 사진을 이곳에서 관리하세요." actions={<Link className="button-link" href={`/catalog/products?prizeOnly=${item.isPrizeOnly ? "true" : "false"}`}>상품 목록</Link>} />
    <Feedback searchParams={query} />
    <section className="panel"><div className="panel-heading"><h2>기본 정보</h2></div><ProductForm item={item} ips={ips} returnTo={path} /></section>
    <section className="panel" id="photos"><div className="panel-heading"><div><h2>사진 관리</h2><p>사진을 선택하고 필요하면 잘라서 저장하세요.</p></div></div><ProductImageForm item={item} returnTo={`${path}#photos`} /></section>
    {!item.isPrizeOnly && (item.category === "gacha" || item.category === "kuji") ? <section className="panel"><div className="panel-heading"><h2>상품 구성</h2></div><Link className="button-link" href={`${path}/draws`}>{item.category === "kuji" ? "쿠지 상 구성" : "가챠 구성 관리"}</Link></section> : null}
  </>;
}
