import Link from "next/link";
import { statusLabel, EmptyState, Feedback, FilterBar, NextCursor, PageHeader, ReasonField, ReturnTo, StatusBadge, first, formatDate, preview, safeExternalUrl, shortId } from "../../../../components/operations";
import { decideCatalogRequest } from "../../../../lib/actions";
import { adminApi, queryString } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { CatalogRequest, CursorPage, SearchParams } from "../../../../lib/admin-types";

export default async function CatalogRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams; const session = await requireCapability("catalogRequests.manage");
  const q = first(query.q) || ""; const kind = first(query.kind) || ""; const status = first(query.status) || ""; const cursor = first(query.cursor) || "";
  const page = await adminApi<CursorPage<CatalogRequest>>(`/v1/admin/catalog-requests${queryString({ q, kind, status, cursor, limit: "30" })}`, { token: session.token });
  const returnTo = `/catalog/requests${queryString({ q, kind, status, cursor })}`;
  return <>
    <PageHeader eyebrow="CATALOG INTAKE" title="카탈로그 신청" description="중복 여부를 확인하고 정규 IP 또는 상품 ID에 연결한 뒤 판정합니다." />
    <Feedback searchParams={query} />
    <FilterBar><label>검색<input name="q" defaultValue={q} placeholder="신청명 · 설명" maxLength={120} /></label><label>종류<select name="kind" defaultValue={kind}><option value="">전체</option><option value="PRODUCT">{statusLabel("PRODUCT")}</option><option value="IP">{statusLabel("IP")}</option></select></label><label>상태<select name="status" defaultValue={status}><option value="">전체</option>{["PENDING", "APPROVED", "REJECTED", "ON_HOLD", "MERGED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label></FilterBar>
    <section className="data-panel">{page.items.length === 0 ? <EmptyState title="처리할 카탈로그 신청이 없습니다." /> : <table className="data-table"><thead><tr><th>신청</th><th>설명/참고</th><th>사용자</th><th>상태</th><th>접수</th><th>처리</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}>
      <td><strong>[{item.kind}] {item.name}</strong><br /><span className="muted">{shortId(item.id)}</span></td><td className="wide-cell">{preview(item.description, 120)}{safeExternalUrl(item.referenceUrl) ? <><br /><a href={safeExternalUrl(item.referenceUrl) || undefined} target="_blank" rel="noreferrer noopener">참고 링크</a></> : null}{item.mediaId ? <><br /><a href={`/api/media/${encodeURIComponent(item.mediaId)}`} target="_blank" rel="noreferrer noopener">첨부 이미지 보기</a></> : null}</td><td>{shortId(item.userId)}</td><td><StatusBadge value={item.status} />{item.canonicalTargetId ? <><br /><span className="muted">→ {shortId(item.canonicalTargetId)}</span></> : null}</td><td>{formatDate(item.createdAt)}</td>
      <td>{item.status === "PENDING" || item.status === "ON_HOLD" ? <div className="stack-form"><Link className="button-link" href={`${item.kind === "IP" ? "/catalog/ips" : "/catalog/products"}${queryString({ requestName: item.name })}`}>정규 {item.kind === "IP" ? "IP" : "상품"} 등록</Link><details className="inline-details"><summary>판정</summary><form action={decideCatalogRequest}><input type="hidden" name="requestId" value={item.id} /><ReturnTo value={returnTo} />
        <label>결정<select name="decision"><option value="APPROVED">{statusLabel("APPROVED")}</option><option value="REJECTED">{statusLabel("REJECTED")}</option><option value="ON_HOLD">{statusLabel("ON_HOLD")}</option><option value="MERGED">{statusLabel("MERGED")}</option></select></label><label>활성 정규 대상 ID<input name="canonicalTargetId" maxLength={120} placeholder="승인/병합 시 입력" /></label><ReasonField label="판정 근거" /><div className="form-actions"><button className="primary">결정 적용</button></div>
      </form></details></div> : <span className="muted">{preview(item.decisionReason, 100)}</span>}</td>
    </tr>)}</tbody></table>}</section><NextCursor pathname="/catalog/requests" nextCursor={page.nextCursor} searchParams={query} />
  </>;
}
