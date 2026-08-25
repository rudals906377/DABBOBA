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
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function StatusBadge({ value }: { value: string | boolean }) {
  const label = typeof value === "boolean" ? (value ? "활성" : "비활성") : value;
  return <span className="status-badge" data-status={String(value).toLowerCase()}>{label}</span>;
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
  return <label className="reason-field"><span>{label}<b>필수</b></span><textarea name="reason" minLength={2} maxLength={1000} required placeholder="감사 로그에 남길 구체적인 사유를 입력하세요." /></label>;
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
