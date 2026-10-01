import Link from "next/link";
import { statusLabel, EmptyState, FilterBar, NextCursor, PageHeader, StatusBadge, first, formatDate, shortId } from "../../../../components/operations";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { CursorPage, RefundReview, SearchParams } from "../../../../lib/admin-types";

export default async function RefundsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("refunds.manage");
  const q = first(query.q) || ""; const operationStatus = first(query.operationStatus) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<RefundReview>>(`/v1/admin/commerce/refund-reviews${queryString({ q, operationStatus, cursor, limit: "30" })}`, { token: session.token });
  return <>
    <PageHeader eyebrow="SAFE REVIEW QUEUE" title="환불 검토" description="PG 취소 시도와 주문·자산 환불 결과를 대조하고 운영 메모를 남깁니다. 메모 저장만으로는 PG 환불이 실행되지 않습니다." />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="결제·주문·PG ID · 회원" /></label><label>운영 상태<select name="operationStatus" defaultValue={operationStatus}><option value="">전체</option>{["UNTRACKED", "PENDING", "IN_REVIEW", "WAITING_PROVIDER", "ESCALATED", "CLOSED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="환불 검토 항목이 없습니다." /> : <table className="data-table"><thead><tr><th>결제/주문</th><th>회원</th><th>금액</th><th>원장 상태</th><th>PG 취소</th><th>운영 검토</th><th>담당</th><th>갱신</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td><Link href={`/commerce/refunds/${item.id}`}><strong>{shortId(item.id)}</strong></Link><br /><span className="muted">주문 {shortId(item.orderId)}</span></td><td>{item.user.nickname}<br /><span className="muted">{item.user.emailMasked}</span></td><td>{item.amount.toLocaleString("ko-KR")}원</td><td><StatusBadge value={item.status} /><br /><span className="muted">주문 {item.orderStatus}</span></td><td>{item.providerCancellationStatus ? <StatusBadge value={item.providerCancellationStatus} /> : "요청 없음"}</td><td><StatusBadge value={item.review?.status || "UNTRACKED"} /></td><td>{shortId(item.review?.assignedAdminId)}</td><td>{formatDate(item.review?.updatedAt || item.updatedAt)}</td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/commerce/refunds" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
