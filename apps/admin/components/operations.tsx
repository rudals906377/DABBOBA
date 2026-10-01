import Link from "next/link";
import type { SearchParams } from "../lib/admin-types";

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>{/[가-힣]/.test(eyebrow) ? <span>{eyebrow}</span> : null}<h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function StatusBadge({ value }: { value: string | boolean }) {
  const label = typeof value === "boolean" ? (value ? "활성" : "비활성") : statusLabel(value);
  return <span className="status-badge" data-status={String(value).toLowerCase()}>{label}</span>;
}

export function statusLabel(value: string) {
  const labels: Record<string, string> = {
    ACTIVE: "정상", SUSPENDED: "이용 정지", BANNED: "이용 제한", DELETED: "삭제됨", HIDDEN: "숨김", PUBLISHED: "공개", DRAFT: "작성 중",
    PENDING: "대기", IN_PROGRESS: "처리 중", ANSWERED: "답변 완료", CLOSED: "처리 종료", REVIEWING: "검토 중", RESOLVED: "처리 완료", REJECTED: "반려", APPROVED: "승인", ON_HOLD: "보류", MERGED: "기존 항목에 연결",
    PENDING_PAYMENT: "결제 대기", PAYMENT_PENDING: "결제 대기", AUTHORIZED: "결제 승인", PAID: "결제 완료", FAILED: "실패", FULFILLED: "주문 완료", CANCELLED: "취소", REFUND_REVIEW: "환불 검토", REFUNDED: "환불 완료",
    REQUESTED: "신청됨", PROCESSING: "처리 중", SHIPPED: "배송 중", DELIVERED: "배송 완료", IN_REVIEW: "검토 중", WAITING_PROVIDER: "결제사 확인 중", ESCALATED: "추가 확인", UNTRACKED: "검토 미접수",
    ADMIN: "관리자", SUPER_ADMIN: "최고 관리자", USER: "회원", PRODUCT: "상품", IP: "작품", POST: "게시물", COMMENT: "댓글", SNAP: "스냅", EXCHANGE_LISTING: "교환글", WANTED_REQUEST: "상품 요청",
    DUKROOM: "덕질방", GENERAL: "일반", NO_ACTION: "조치 없음", HIDE_POST: "게시물 숨김", HIDE_COMMENT: "댓글 숨김", HIDE_EXCHANGE_LISTING: "교환글 숨김", HIDE_WANTED_REQUEST: "상품 요청 숨김", WARN_USER: "회원 경고", SUSPEND_USER: "회원 이용 정지",
    OPEN: "진행 중", MATCHED: "매칭됨", COMPLETED: "완료", REVOKING_TOKENS: "로그인 연결 해제 중", DELETING: "삭제 중", RETRY_PENDING: "재시도 대기", RETENTION_HOLD: "보존 검토", WAITING: "대기",
    gacha: "가챠", kuji: "쿠지", figure: "피규어", tcg: "카드", COMING_SOON: "오픈 예정", ON_SALE: "판매 중", PAUSED: "판매 중지",
  };
  return labels[value] ?? value;
}

export function EmptyState({ title = "표시할 항목이 없습니다.", description = "검색어나 필터를 바꿔 다시 확인해 주세요." }) {
  return <div className="empty-state"><strong>{title}</strong><p>{description}</p></div>;
}

export function Feedback({ searchParams }: { searchParams: SearchParams }) {
  const success = first(searchParams.success);
  const error = first(searchParams.error);
  if (!success && !error) return null;
  return <p className="feedback" data-kind={error ? "error" : "success"} role="status">{error || success}</p>;
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <form className="filter-bar" method="get">{children}<button type="submit">조회</button></form>;
}

export function NextCursor({ pathname, nextCursor, searchParams }: {
  pathname: string;
  nextCursor: string | null;
  searchParams: SearchParams;
}) {
  if (!nextCursor) return <p className="pagination-end">마지막 페이지입니다.</p>;
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(searchParams)) {
    if (key === "cursor") continue;
    const value = first(raw);
    if (value) params.set(key, value);
  }
  params.set("cursor", nextCursor);
  return <div className="pagination"><Link href={`${pathname}?${params.toString()}`}>다음 페이지</Link></div>;
}

export function ReasonField({ label = "처리 사유" }: { label?: string }) {
  return <label className="reason-field"><span>{label}<b>필수</b></span><textarea name="reason" minLength={2} maxLength={1000} required placeholder="왜 변경하는지 간단히 적어주세요." /></label>;
}

export function ReturnTo({ value }: { value: string }) {
  return <>
    <input type="hidden" name="returnTo" value={value} />
    <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
  </>;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatKoreaDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function preview(value: string | null | undefined, length = 100) {
  if (!value) return "-";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized;
}

export function privacySafeMetadata(value: Record<string, unknown>) {
  const sensitive = /(email|phone|mobile|address|token|password|secret|credential|authorization|cookie)/i;
  const visit = (input: unknown, depth: number): unknown => {
    if (depth > 4) return "[TRUNCATED]";
    if (Array.isArray(input)) return input.slice(0, 20).map((item) => visit(item, depth + 1));
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).slice(0, 50).map(([key, item]) => [key, sensitive.test(key) ? "[REDACTED]" : visit(item, depth + 1)]));
    }
    if (typeof input === "string" && input.length > 500) return `${input.slice(0, 500)}…`;
    return input;
  };
  return visit(value, 0);
}

export function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
