import Link from "next/link";
import { PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate, shortId } from "../../../../../../components/operations";
import { createDrawVersion, publishDrawVersion } from "../../../../../../lib/actions";
import { adminApi } from "../../../../../../lib/api";
import { requireCapability } from "../../../../../../lib/auth";
import type { DrawProbabilityVersionList, SearchParams } from "../../../../../../lib/admin-types";

const EXAMPLE_ENTRIES = JSON.stringify([
  { prizeProductId: "prize-product-a", rarity: "A", weight: 10, quantity: 5 },
  { prizeProductId: "prize-product-b", rarity: "B", weight: 30, quantity: 20 },
], null, 2);

export default async function DrawVersionsPage({ params }: { params: Promise<{ productId: string }>; searchParams: Promise<SearchParams> }) {
  const { productId } = await params;
  const session = await requireCapability("catalog.manage");
  const result = await adminApi<DrawProbabilityVersionList>(`/v1/admin/products/${encodeURIComponent(productId)}/draw-versions`, { token: session.token });
  const returnTo = `/catalog/products/${encodeURIComponent(productId)}/draws`;
  return <>
    <PageHeader eyebrow="IMMUTABLE DRAW CONFIG" title="가챠·쿠지 확률표" description={`상품 ${shortId(productId)} · 공개 후 구성은 변경할 수 없고 새 버전으로만 교체합니다.`} actions={<Link className="button-link" href="/catalog/products">상품 목록</Link>} />
    <section className="panel"><div className="panel-heading"><div><h2>새 초안</h2><p>weight와 현재 남은 수량을 곱한 값이 실제 추첨 가중치입니다. 무제한 경품은 quantity를 null로 입력하세요.</p></div></div>
      <form className="stack-form" action={createDrawVersion}><input type="hidden" name="productId" value={productId} /><ReturnTo value={returnTo} />
        <label>경품 구성 JSON<textarea name="entries" defaultValue={EXAMPLE_ENTRIES} maxLength={100000} required /></label><ReasonField label="초안 생성 사유" /><div className="form-actions"><button className="primary">확률표 초안 생성</button></div>
      </form>
    </section>
    {result.items.map((version) => <section className="panel" key={version.id}><div className="panel-heading"><div><h2>버전 {version.version} <StatusBadge value={version.status} /></h2><p>생성 {formatDate(version.createdAt)}{version.publishedAt ? ` · 공개 ${formatDate(version.publishedAt)}` : ""} · 유효 가중치 {version.totalEffectiveWeight.toLocaleString("ko-KR")}</p></div></div>
      <div className="data-panel"><table className="data-table"><thead><tr><th>경품 상품</th><th>등급</th><th>기본 가중치</th><th>초기/남은 수량</th><th>현재 비율</th></tr></thead><tbody>{version.entries.map((entry) => { const effective = entry.weight * (entry.remainingQuantity ?? 1); const percentage = version.totalEffectiveWeight ? effective / version.totalEffectiveWeight * 100 : 0; return <tr key={entry.id}><td>{entry.prizeProductId}<br /><span className="muted">{shortId(entry.id)}</span></td><td>{entry.rarity}</td><td>{entry.weight.toLocaleString("ko-KR")}</td><td>{entry.initialQuantity === null ? "무제한" : `${entry.initialQuantity} / ${entry.remainingQuantity}`}</td><td>{percentage.toFixed(4)}%</td></tr>; })}</tbody></table></div>
      {version.status === "DRAFT" ? <form className="stack-form" action={publishDrawVersion}><input type="hidden" name="productId" value={productId} /><input type="hidden" name="versionId" value={version.id} /><ReturnTo value={returnTo} /><ReasonField label="공개 사유" /><div className="form-actions"><button className="danger">이 버전 공개</button></div></form> : null}
    </section>)}
  </>;
}
