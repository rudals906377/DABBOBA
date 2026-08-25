import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DrawVersionForm } from "../../../../../../components/draw-version-form";
import { EmptyState, Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate } from "../../../../../../components/operations";
import { publishDrawVersion } from "../../../../../../lib/actions";
import { adminApi, queryString } from "../../../../../../lib/api";
import { requireCapability } from "../../../../../../lib/auth";
import type { CatalogProduct, CursorPage, DrawProbabilityVersionList, SearchParams } from "../../../../../../lib/admin-types";

async function loadPrizeProducts(token: string, ipId: string) {
  const items: CatalogProduct[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const candidatePage: CursorPage<CatalogProduct> = await adminApi<CursorPage<CatalogProduct>>(`/v1/admin/products${queryString({
      ipId,
      prizeOnly: "true",
      limit: "100",
      cursor,
    })}`, { token });
    items.push(...candidatePage.items);
    cursor = candidatePage.nextCursor;
    if (cursor && seenCursors.has(cursor)) throw new Error("경품 SKU 목록 페이지가 반복되었습니다. 잠시 후 다시 시도하세요.");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return items;
}

export default async function DrawVersionsPage({ params, searchParams }: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const session = await requireCapability("catalog.manage");
  const [product, result] = await Promise.all([
    adminApi<CatalogProduct>(`/v1/admin/products/${encodeURIComponent(productId)}`, { token: session.token }),
    adminApi<DrawProbabilityVersionList>(`/v1/admin/products/${encodeURIComponent(productId)}/draw-versions`, { token: session.token }),
  ]);
  const candidates = await loadPrizeProducts(session.token, product.ipId);
  const prizeProducts = candidates.filter((candidate) => (
    candidate.id !== product.id
    && candidate.isPrizeOnly
    && candidate.isActive
    && candidate.ipId === product.ipId
  ));
  const returnTo = `/catalog/products/${encodeURIComponent(productId)}/draws`;

  return <>
    <PageHeader
      eyebrow="IMMUTABLE DRAW CONFIG"
      title="가챠·쿠지 확률표"
      description={`${product.name} · 공개 후 구성은 변경할 수 없고 새 버전으로만 교체합니다. 판매 가용 수량 ${product.availableQuantity.toLocaleString("ko-KR")}개`}
      actions={<Link className="button-link" href="/catalog/products">상품 목록</Link>}
    />
    <Feedback searchParams={query} />
    <section className="panel">
      <div className="panel-heading"><div><h2>새 초안</h2><p>동일 IP의 활성 경품 전용 SKU만 선택할 수 있습니다. 기본 가중치 × 남은 수량이 현재 유효 가중치입니다.</p></div></div>
      <DrawVersionForm
        product={product}
        prizeProducts={prizeProducts}
        returnTo={returnTo}
        idempotencyKey={randomUUID()}
      />
    </section>
    {result.items.length === 0 ? <section className="data-panel"><EmptyState title="아직 확률표 버전이 없습니다." description="경품 SKU와 실제 검수 재고를 확인한 뒤 첫 초안을 만드세요." /></section> : null}
    {result.items.map((version) => <section className="panel" key={version.id}>
      <div className="panel-heading"><div><h2>버전 {version.version} <StatusBadge value={version.status} /></h2><p>생성 {formatDate(version.createdAt)}{version.publishedAt ? ` · 공개 ${formatDate(version.publishedAt)}` : ""} · 유효 가중치 {version.totalEffectiveWeight.toLocaleString("ko-KR")}</p></div></div>
      <div className="data-panel"><table className="data-table">
        <thead><tr><th>경품 상품</th><th>등급</th><th>기본 가중치</th><th>초기/남은 수량</th><th>현재 비율</th></tr></thead>
        <tbody>{version.entries.map((entry) => {
          const effective = entry.weight * (entry.remainingQuantity ?? 1);
          const percentage = version.totalEffectiveWeight ? effective / version.totalEffectiveWeight * 100 : 0;
          return <tr key={entry.id}>
            <td className="wide-cell"><span className="draw-version-prize">
              {entry.prizeImageUrl ? <img src={entry.prizeImageUrl} alt="" /> : <span className="draw-prize-image-placeholder" aria-hidden="true" />}
              <span><strong>{entry.prizeName}</strong><small>SKU {entry.prizeSku} · IP {entry.prizeIpId}</small></span>
            </span></td>
            <td>{entry.rarity}</td>
            <td>{entry.weight.toLocaleString("ko-KR")}</td>
            <td>{entry.initialQuantity === null ? "무제한" : `${entry.initialQuantity.toLocaleString("ko-KR")} / ${entry.remainingQuantity?.toLocaleString("ko-KR") ?? 0}`}</td>
            <td>{percentage.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}%</td>
          </tr>;
        })}</tbody>
      </table></div>
      {version.status === "DRAFT" ? <form className="stack-form" action={publishDrawVersion}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="versionId" value={version.id} />
        <ReturnTo value={returnTo} />
        <ReasonField label="공개 사유" />
        <div className="form-actions"><button className="danger">이 버전 공개</button></div>
      </form> : null}
    </section>)}
  </>;
}
