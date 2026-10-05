import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DrawVersionForm } from "../../../../../../components/draw-version-form";
import { EmptyState, Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate } from "../../../../../../components/operations";
import { publishDrawVersion } from "../../../../../../lib/actions";
import { adminApi, queryString } from "../../../../../../lib/api";
import { requireCapability } from "../../../../../../lib/auth";
import { can } from "../../../../../../lib/capabilities";
import type { AdminInventory, CatalogProduct, CursorPage, DrawProbabilityVersionList, SearchParams } from "../../../../../../lib/admin-types";

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
  const [candidates, stock] = await Promise.all([
    loadPrizeProducts(session.token, product.ipId),
    // Stock including checkout reservations, when this operator may read it.
    can(session.actor, "inventory.read")
      ? adminApi<AdminInventory>(`/v1/admin/commerce/inventory/${encodeURIComponent(productId)}`, { token: session.token }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const prizeProducts = candidates.filter((candidate) => (
    candidate.id !== product.id
    && candidate.isPrizeOnly
    && candidate.isActive
    && candidate.ipId === product.ipId
  ));
  const returnTo = `/catalog/products/${encodeURIComponent(productId)}/draws`;
  // The API returns versions newest-first. An older draft must not expose a
  // publish action after a newer version has already been activated.
  const latestDraftId = result.items[0]?.status === "DRAFT" ? result.items[0].id : null;

  return <>
    <PageHeader
      eyebrow="IMMUTABLE DRAW CONFIG"
      title={product.category === "kuji" ? "쿠지 상 구성" : "가챠 확률표"}
      description={`${product.name} · ${product.category === "kuji" ? "봉인 덱" : "상세상품 수량 비례 확률"} 구성은 공개 후 변경할 수 없고 새 버전으로만 교체합니다. 판매 가용 수량 ${product.availableQuantity.toLocaleString("ko-KR")}개`}
      actions={<Link className="button-link" href="/catalog/products">상품 목록</Link>}
    />
    <Feedback searchParams={query} />
    <section className="panel">
      <div className="panel-heading"><div><h2>{product.category === "kuji" ? "새 상 구성 초안" : "새 확률표 초안"}</h2><p>{product.category === "kuji"
        ? "동일 IP의 활성 경품 전용 SKU만 선택할 수 있습니다. 전체 장수와 등급별 수량 합계가 정확히 같아야 합니다."
        : "동일 IP의 활성 경품 전용 SKU만 선택할 수 있습니다. 각 상세상품의 남은 개수를 전체 남은 개수로 나눈 값이 현재 확률입니다."}</p></div></div>
      <DrawVersionForm
        product={product}
        prizeProducts={prizeProducts}
        returnTo={returnTo}
        idempotencyKey={randomUUID()}
        stockOnHand={stock?.productId === product.id && Number.isSafeInteger(stock.onHand) ? stock.onHand : null}
      />
    </section>
    {result.items.length === 0 ? <section className="data-panel"><EmptyState title={product.category === "kuji" ? "아직 공개할 상 구성이 없습니다." : "아직 확률표 버전이 없습니다."} description="경품 SKU와 실제 검수 재고를 확인한 뒤 첫 초안을 만드세요." /></section> : null}
    {result.items.map((version) => {
      const gachaRemainingTotal = version.entries.reduce((sum, entry) => sum + (entry.remainingQuantity ?? 0), 0);
      const gachaQuantityRatioReady = version.entries.length > 0 && gachaRemainingTotal > 0
        && version.entries.every((entry) => entry.weight === 1 && entry.remainingQuantity !== null);
      return <section className="panel" key={version.id}>
      <div className="panel-heading"><div><h2>버전 {version.version} <StatusBadge value={version.status} /></h2><p>생성 {formatDate(version.createdAt)}{version.publishedAt ? ` · 공개 ${formatDate(version.publishedAt)}` : ""} · {product.category === "kuji"
        ? `전체 장수 ${(version.totalSlots ?? 0).toLocaleString("ko-KR")}`
        : gachaQuantityRatioReady ? `전체 남은 수량 ${gachaRemainingTotal.toLocaleString("ko-KR")}개` : "기존 확률 설정 확인 필요"}</p></div></div>
      {product.category === "gacha" && !gachaQuantityRatioReady ? <p className="draw-capacity-message" data-kind="error">이 버전은 상세상품 수량 비례 규칙에 맞지 않아 공개·구매에 사용할 수 없습니다. 이미 결제된 뽑기권은 이 버전의 기존 규칙대로 열립니다. 수량을 입력한 새 초안을 만드세요.</p> : null}
      <div className="data-panel"><table className="data-table">
        <thead><tr><th>경품 상품</th><th>{product.category === "kuji" ? "상 이름" : "등급"}</th>{product.category === "kuji" ? <><th>관리 코드</th><th>노출 순서</th></> : null}<th>초기/남은 수량</th><th>{product.category === "kuji" ? "전체 구성 비율" : "현재 확률"}</th></tr></thead>
        <tbody>{[...version.entries].sort((left, right) => product.category === "kuji"
          ? (left.tierRank ?? Number.MAX_SAFE_INTEGER) - (right.tierRank ?? Number.MAX_SAFE_INTEGER)
          : 0).map((entry) => {
          const percentage = gachaQuantityRatioReady ? (entry.remainingQuantity ?? 0) / gachaRemainingTotal * 100 : null;
          return <tr key={entry.id}>
            <td className="wide-cell"><span className="draw-version-prize">
              {entry.prizeImageUrl ? <img src={entry.prizeImageUrl} alt="" /> : <span className="draw-prize-image-placeholder" aria-hidden="true" />}
              <span><strong>{entry.prizeName}</strong><small>SKU {entry.prizeSku} · IP {entry.prizeIpId}</small></span>
            </span></td>
            <td>{entry.rarity}</td>
            {product.category === "kuji" ? <><td>{entry.tierCode ?? "-"}</td><td>{entry.tierRank?.toLocaleString("ko-KR") ?? "-"}</td></> : null}
            <td>{entry.initialQuantity === null ? "무제한" : `${entry.initialQuantity.toLocaleString("ko-KR")} / ${entry.remainingQuantity?.toLocaleString("ko-KR") ?? 0}`}</td>
            <td>{product.category === "kuji"
              ? `${(version.totalSlots ? (entry.initialQuantity ?? 0) / version.totalSlots * 100 : 0).toFixed(2)}%`
              : percentage === null ? "확인 필요" : `${percentage.toFixed(2)}%`}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {version.status === "DRAFT" && version.id === latestDraftId ? <form className="stack-form" action={publishDrawVersion}>
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="versionId" value={version.id} />
        <ReturnTo value={returnTo} />
        <ReasonField label="공개 사유" />
        <div className="form-actions"><button className="danger">이 버전 공개</button></div>
      </form> : version.status === "DRAFT" ? <p className="muted">이전 초안 · 최신 초안만 공개할 수 있습니다.</p> : null}
    </section>;
    })}
  </>;
}
