import { statusLabel,
  EmptyState,
  Feedback,
  FilterBar,
  NextCursor,
  PageHeader,
  ReasonField,
  ReturnTo,
  StatusBadge,
  first,
  formatDate,
  preview,
  shortId,
} from "../../../components/operations";
import { resolveExchange } from "../../../lib/actions";
import type { CursorPage, ExchangeListing, SearchParams } from "../../../lib/admin-types";
import { adminApi, queryString } from "../../../lib/api";
import { requireCapability } from "../../../lib/auth";

const LISTING_STATUSES = ["OPEN", "MATCHED", "COMPLETED", "CANCELLED", "HIDDEN"] as const;

function Confirmation({ label, value }: { label: string; value: string | null }) {
  return value
    ? <span><strong>{label} 확인</strong><br /><span className="muted">{formatDate(value)}</span></span>
    : <span className="muted">{label} 미확인</span>;
}

function ResolutionForms({ listing, returnTo }: { listing: ExchangeListing; returnTo: string }) {
  if (listing.status !== "MATCHED") return <span className="muted">MATCHED 상태에서만 운영 처리 가능</span>;
  return <details className="inline-details">
    <summary>운영 처리</summary>
    <form action={resolveExchange}>
      <input type="hidden" name="listingId" value={listing.id} />
      <input type="hidden" name="action" value="COMPLETE" />
      <ReturnTo value={returnTo} />
      <p className="muted">양측 상품 소유권을 즉시 교환합니다. 배송·수령 근거를 확인한 뒤 실행하세요.</p>
      <ReasonField label="강제 완료 근거" />
      <div className="form-actions"><button className="primary">교환 완료 확정</button></div>
    </form>
    <form action={resolveExchange}>
      <input type="hidden" name="listingId" value={listing.id} />
      <input type="hidden" name="action" value="CANCEL" />
      <ReturnTo value={returnTo} />
      <p className="muted">예약된 양측 상품을 원래 소유자의 보유 상태로 되돌립니다.</p>
      <ReasonField label="운영 취소 근거" />
      <div className="form-actions"><button className="danger">교환 취소 확정</button></div>
    </form>
  </details>;
}

export default async function ExchangesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("exchange.manage");
  const q = first(query.q) || "";
  const status = first(query.status) || "";
  const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<ExchangeListing>>(
    `/v1/admin/exchange/listings${queryString({ q, status, cursor, limit: "30" })}`,
    { token: session.token },
  );
  const returnTo = `/exchanges${queryString({ q, status, cursor })}`;

  return <>
    <PageHeader
      eyebrow="EXCHANGE OPERATIONS"
      title="교환 관리"
      description="교환 진행 상태와 양측 완료 확인을 조회하고, 분쟁 증빙이 확보된 MATCHED 건만 운영자 권한으로 완료 또는 취소합니다."
    />
    <Feedback searchParams={query} />
    <FilterBar>
      <label>검색<input name="q" defaultValue={q} placeholder="글 · 상품 · 작성자 · SKU · 교환 ID" maxLength={120} /></label>
      <label>상태<select name="status" defaultValue={status}><option value="">전체</option>{LISTING_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
    </FilterBar>
    <section className="data-panel">
      {page.items.length === 0
        ? <EmptyState title="조건에 맞는 교환이 없습니다." />
        : <table className="data-table">
          <thead><tr><th>교환 글</th><th>등록 상품</th><th>매칭·확인</th><th>상태</th><th>일시</th><th>운영 처리</th></tr></thead>
          <tbody>{page.items.map((listing) => <tr key={listing.id}>
            <td className="wide-cell">
              <strong>{listing.title}</strong><br />
              <span>{preview(listing.details, 170)}</span><br />
              <span className="muted">{listing.authorNickname} · 작성자 {shortId(listing.authorId)} · 교환 {shortId(listing.id)}</span>
            </td>
            <td>
              <strong>{listing.offeredInventory.product.name}</strong><br />
              <span className="muted">{listing.offeredInventory.product.sku} · 보유품 {shortId(listing.offeredInventory.id)}</span><br />
              <StatusBadge value={listing.offeredInventory.status} />
            </td>
            <td>
              <span>제안 {listing.offerCount}건</span><br />
              <span className="muted">수락 제안 {shortId(listing.acceptedOfferId)}</span><br />
              <Confirmation label="작성자" value={listing.authorConfirmedAt} /><br />
              <Confirmation label="제안자" value={listing.proposerConfirmedAt} />
            </td>
            <td>
              <StatusBadge value={listing.status} />
              {listing.completionMode ? <><br /><span className="muted">{listing.completionMode}</span></> : null}
              {listing.cancelReason ? <><br /><span className="muted">취소: {preview(listing.cancelReason, 80)}</span></> : null}
              {listing.resolvedByAdminId ? <><br /><span className="muted">운영자 {shortId(listing.resolvedByAdminId)}</span></> : null}
            </td>
            <td>
              등록 {formatDate(listing.createdAt)}<br />
              <span className="muted">매칭 {formatDate(listing.matchedAt)}<br />완료 {formatDate(listing.completedAt)}<br />취소 {formatDate(listing.cancelledAt)}</span>
            </td>
            <td><ResolutionForms listing={listing} returnTo={returnTo} /></td>
          </tr>)}</tbody>
        </table>}
    </section>
    <NextCursor pathname="/exchanges" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
