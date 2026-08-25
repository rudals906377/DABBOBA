export const USER_ROLES = ["USER", "ADMIN", "SUPER_ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED", "DELETED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PRODUCT_CATEGORIES = ["gacha", "figure", "kuji", "tcg"] as const;
export type ProductCategoryId = (typeof PRODUCT_CATEGORIES)[number];
export type CommerceMode = "draw" | "purchase";

export const CONTENT_STATUSES = ["ACTIVE", "HIDDEN", "DELETED"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const REPORT_STATUSES = ["PENDING", "REVIEWING", "RESOLVED", "REJECTED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const INQUIRY_STATUSES = ["PENDING", "IN_PROGRESS", "ANSWERED", "CLOSED"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "ON_HOLD", "MERGED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const EXCHANGE_LISTING_STATUSES = ["OPEN", "MATCHED", "COMPLETED", "CANCELLED", "HIDDEN"] as const;
export type ExchangeListingStatus = (typeof EXCHANGE_LISTING_STATUSES)[number];

export const EXCHANGE_OFFER_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;
export type ExchangeOfferStatus = (typeof EXCHANGE_OFFER_STATUSES)[number];

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLED",
  "CANCELLED",
  "REFUND_REVIEW",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "REFUND_REVIEW", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type AuthenticatedActor = {
  userId: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export function isAdminRole(role: UserRole): role is Extract<UserRole, "ADMIN" | "SUPER_ADMIN"> {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function isSuperAdminRole(role: UserRole): role is "SUPER_ADMIN" {
  return role === "SUPER_ADMIN";
}

export function commerceModeForCategory(category: ProductCategoryId): CommerceMode {
  return category === "gacha" || category === "kuji" ? "draw" : "purchase";
}

export function canTransitionInquiry(from: InquiryStatus, to: InquiryStatus): boolean {
  if (from === to) return from !== "CLOSED";
  const allowed: Record<InquiryStatus, readonly InquiryStatus[]> = {
    PENDING: ["IN_PROGRESS", "ANSWERED", "CLOSED"],
    IN_PROGRESS: ["ANSWERED", "CLOSED"],
    ANSWERED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };
  return allowed[from].includes(to);
}

export function canTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  if (from === to) return from === "PENDING" || from === "REVIEWING";
  const allowed: Record<ReportStatus, readonly ReportStatus[]> = {
    PENDING: ["REVIEWING", "RESOLVED", "REJECTED"],
    REVIEWING: ["RESOLVED", "REJECTED"],
    RESOLVED: [],
    REJECTED: [],
  };
  return allowed[from].includes(to);
}

export function assertNever(value: never, message = "Unexpected domain value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
