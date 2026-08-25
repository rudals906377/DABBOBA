import Link from "next/link";
import { updateShippingStatus } from "../../../../../lib/actions";
import { Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate, shortId } from "../../../../../components/operations";
import { adminApi } from "../../../../../lib/api";
import { requireCapability } from "../../../../../lib/auth";
import type { AdminShippingRequestDetail, SearchParams } from "../../../../../lib/admin-types";

function ShippingAction({ request, status, label, danger = false, tracking = false }: {
  request: AdminShippingRequestDetail; status: "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED"; label: string; danger?: boolean; tracking?: boolean;
}) {
  const returnTo = `/commerce/shipping/${encodeURIComponent(request.id)}`;
  return <form className="stack-form" action={updateShippingStatus}>
    <input type="hidden" name="shippingRequestId" value={request.id} /><input type="hidden" name="status" value={status} /><input type="hidden" name="expectedVersion" value={request.version} /><ReturnTo value={returnTo} />
    {tracking ? <><label>택배사<input name="trackingCarrier" maxLength={100} required placeholder="예: CJ대한통운" /></label><label>운송장 번호<input name="trackingNumber" maxLength={200} required /></label></> : null}
    <ReasonField label={`${label} 근거`} /><div className="form-actions"><button className={danger ? "danger" : "primary"}>{label}</button></div>
  </form>;
}

export default async function ShippingDetailPage({ params, searchParams }: { params: Promise<{ shippingRequestId: string }>; searchParams: Promise<SearchParams> }) {
  const { shippingRequestId } = await params; const query = await searchParams; const session = await requireCapability("shipping.manage");
  await requireCapability("shipping.destination.read");
  const request = await adminApi<AdminShippingRequestDetail>(`/v1/admin/commerce/shipping/${encodeURIComponent(shippingRequestId)}`, { token: session.token });
  return <>
    <PageHeader eyebrow="SHIPPING DETAIL" title="배송 상세" description="배송지 정보는 물류 처리에만 사용하고, 상태는 REQUESTED → PROCESSING → SHIPPED → DELIVERED 순서로 진행합니다." actions={<Link className="button-link" href="/commerce/shipping">목록</Link>} />
    <Feedback searchParams={query} />
    <dl className="definition-grid"><div><dt>배송 ID</dt><dd>{request.id}</dd></div><div><dt>상태</dt><dd><StatusBadge value={request.status} /></dd></div><div><dt>회원</dt><dd>{request.user.nickname}<br />{request.user.emailMasked}</dd></div><div><dt>상품 수</dt><dd>{request.itemCount}</dd></div><div><dt>수령인</dt><dd>{request.destination.recipient}</dd></div><div><dt>연락처</dt><dd>{request.destination.phone}</dd></div><div><dt>우편번호</dt><dd>{request.destination.postalCode}</dd></div><div><dt>신청</dt><dd>{formatDate(request.requestedAt)}</dd></div></dl>
    <section className="panel"><div className="panel-heading"><div><h2>배송지</h2><p>운영 권한이 있는 물류 담당자에게만 노출되는 배송 스냅샷입니다.</p></div></div><p>{request.destination.addressLine1} {request.destination.addressLine2}</p><p className="muted">배송 메모: {request.destination.deliveryNote || "없음"}</p></section>
    <section className="panel"><div className="panel-heading"><div><h2>상태 처리</h2><p>단계를 건너뛰거나 출고 후 취소할 수 없습니다.</p></div></div><div className="field-grid">
      {request.status === "REQUESTED" ? <><ShippingAction request={request} status="PROCESSING" label="포장 처리 시작" /><ShippingAction request={request} status="CANCELLED" label="배송 신청 취소" danger /></> : null}
      {request.status === "PROCESSING" ? <><ShippingAction request={request} status="SHIPPED" label="출고 확정" tracking /><ShippingAction request={request} status="CANCELLED" label="포장 취소" danger /></> : null}
      {request.status === "SHIPPED" ? <ShippingAction request={request} status="DELIVERED" label="배송 완료 확인" /> : null}
      {request.status === "DELIVERED" || request.status === "CANCELLED" ? <p className="muted">종료 상태이므로 추가 상태 변경을 할 수 없습니다.</p> : null}
    </div></section>
    <section className="panel"><div className="panel-heading"><div><h2>배송 상품</h2><p>배송 신청에 잠긴 보관 상품입니다.</p></div></div><div className="data-panel"><table className="data-table"><thead><tr><th>재고 단위</th><th>상품</th><th>SKU</th><th>상태</th></tr></thead><tbody>{request.items.map((item) => <tr key={item.inventoryUnitId}><td>{shortId(item.inventoryUnitId)}</td><td>{item.productName}<br /><span className="muted">{item.productId}</span></td><td>{item.sku}</td><td><StatusBadge value={item.inventoryStatus} /></td></tr>)}</tbody></table></div></section>
    <section className="panel"><div className="panel-heading"><div><h2>불변 배송 이력</h2><p>상태·택배사·운송장·처리 사유가 수정 불가능한 이벤트로 남습니다.</p></div></div>{request.events.length === 0 ? <p className="muted">아직 운영 처리 이력이 없습니다.</p> : <div className="data-panel"><table className="data-table"><thead><tr><th>상태</th><th>택배</th><th>운영자</th><th>사유</th><th>기록</th></tr></thead><tbody>{request.events.map((event) => <tr key={event.id}><td>{event.fromStatus} → <strong>{event.toStatus}</strong></td><td>{event.trackingCarrier || "-"}<br /><span className="muted">{event.trackingNumber || "-"}</span></td><td>{event.adminNickname}</td><td>{event.reason}</td><td>{formatDate(event.createdAt)}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
