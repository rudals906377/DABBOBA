import type { components } from "@dabboba/contracts";

export type Actor = components["schemas"]["Actor"];
export type AdminDashboard = components["schemas"]["AdminDashboard"];
export type AdminAuditLog = components["schemas"]["AdminAuditLog"];
export type CatalogIp = components["schemas"]["CatalogIp"];
export type CatalogProduct = components["schemas"]["CatalogProduct"];
export type CatalogRequest = components["schemas"]["CatalogRequest"];
export type Character = components["schemas"]["Character"];
export type Comment = components["schemas"]["Comment"];
export type CommunityPost = components["schemas"]["CommunityPost"];
export type ContentStatus = components["schemas"]["ContentStatus"];
export type Inquiry = components["schemas"]["Inquiry"];
export type InquiryDetail = components["schemas"]["InquiryDetail"];
export type InquiryMessage = components["schemas"]["InquiryMessage"];
export type InquiryStatus = components["schemas"]["InquiryStatus"];
export type Notice = components["schemas"]["Notice"];
export type ProductCategory = components["schemas"]["ProductCategory"];
export type Report = components["schemas"]["Report"];
export type ReportStatus = components["schemas"]["ReportStatus"];
export type RequestStatus = components["schemas"]["RequestStatus"];
export type UserDetail = components["schemas"]["UserDetail"];
export type UserRole = components["schemas"]["UserRole"];
export type UserStatus = components["schemas"]["UserStatus"];
export type UserSummary = components["schemas"]["UserSummary"];
export type SessionCreated = components["schemas"]["SessionCreated"];
export type DrawProbabilityVersion = components["schemas"]["DrawProbabilityVersion"];
export type DrawProbabilityVersionList = components["schemas"]["DrawProbabilityVersionList"];
export type ExchangeListing = components["schemas"]["ExchangeListing"] & {
  acceptedOfferId: string | null;
  matchedAt: string | null;
  authorConfirmedAt: string | null;
  proposerConfirmedAt: string | null;
  completedAt: string | null;
  completionMode: "MUTUAL_CONFIRMATION" | "ADMIN_OVERRIDE" | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  resolvedByAdminId: string | null;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

// Keep this handwritten until the generated contracts package has been rebuilt in
// every admin environment. The API intentionally exposes a nullable layout kind
// only for legacy rows; create and update inputs require a concrete value.
export type AdminHomeSection = {
  id: string;
  title: string;
  subtitle: string | null;
  ipId: string | null;
  layoutKind: "gacha" | "kuji" | null;
  sourceKind: "MANUAL" | "IP" | "NEW" | "POPULAR";
  visibleLimit: number;
  manualProductIds: string[];
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminHomeSectionList = {
  configured: boolean;
  items: AdminHomeSection[];
};

export type StorefrontCategorySetting = components["schemas"]["StorefrontCategorySetting"];
export type StorefrontCategorySettingList = components["schemas"]["StorefrontCategorySettingList"];

export type CommerceUser = { id: string; emailMasked: string; nickname: string };

export type AdminOrder = {
  id: string;
  user: CommerceUser;
  status: string;
  currency: "KRW";
  subtotal: number;
  discountTotal: number;
  pointTotal: number;
  total: number;
  version: number;
  payment: { id: string; status: string; provider: string };
  lineCount: number;
  unitCount: number;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderDetail = AdminOrder & {
  lines: Array<{
    id: string; productId: string; productName: string; category: string; unitPrice: number;
    quantity: number; lineTotal: number; probabilityVersionId: string | null; createdAt: string;
  }>;
  reservations: Array<{
    id: string; orderLineId: string; productId: string; quantity: number; status: string;
    expiresAt: string; resolvedAt: string | null; createdAt: string;
  }>;
};

export type AdminPayment = {
  id: string;
  orderId: string;
  orderStatus: string;
  user: CommerceUser;
  provider: string;
  providerPaymentId: string | null;
  status: string;
  amount: number;
  currency: "KRW";
  failureCode: string | null;
  version: number;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminPaymentDetail = AdminPayment & {
  ledger: Array<{
    id: string; entryType: string; amount: number; currency: string; referenceId: string;
    reason: string | null; createdAt: string;
  }>;
  providerEvents: Array<{
    id: string; providerEventId: string; eventType: string; occurredAt: string;
    processedAt: string | null; processingError: string | null; createdAt: string;
  }>;
};

export type RefundReview = AdminPayment & {
  review: null | {
    id: string; status: string; assignedAdminId: string | null; version: number;
    updatedAt: string | null; closedAt: string | null;
  };
};

export type RefundReviewDetail = RefundReview & {
  assetSafety: {
    expectedPurchaseUnits: number; actualPurchaseUnits: number; unsafePurchaseUnits: number;
    expectedDrawUnits: number; actualDrawEntitlements: number; consumedDrawEntitlements: number;
  };
  notes: Array<{
    id: string; adminId: string; adminNickname: string; status: string; note: string; createdAt: string;
  }>;
  providerActionAvailable: false;
};

export type AdminInventory = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  ipId: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  drawCapacity: null | {
    probabilityVersionId: string; unlimited: boolean; remainingPrizeUnits: number | null;
    outstandingEntitlements: number; sellableUnits: number | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type AdminInventoryDetail = AdminInventory & {
  adjustments: Array<{
    id: string; adminId: string; adminNickname: string; deltaOnHand: number;
    beforeOnHand: number; afterOnHand: number; beforeReserved: number; afterReserved: number;
    reason: string; requestId: string; createdAt: string;
  }>;
  reservations: Array<{
    id: string; orderId: string; quantity: number; status: string;
    expiresAt: string; resolvedAt: string | null; createdAt: string;
  }>;
};

export type ShippingDestination = {
  recipient: string; phone: string; postalCode: string; addressLine1: string; addressLine2: string; deliveryNote: string;
};

export type AdminShippingRequest = {
  id: string;
  user: CommerceUser;
  status: string;
  itemCount: number;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  version: number;
  requestedAt: string;
  shippedAt: string | null;
  updatedAt: string;
};

export type AdminShippingRequestDetail = AdminShippingRequest & {
  destination: ShippingDestination;
  items: Array<{
    inventoryUnitId: string; productId: string; productName: string; sku: string; inventoryStatus: string;
  }>;
  events: Array<{
    id: string; adminId: string; adminNickname: string; fromStatus: string; toStatus: string;
    trackingCarrier: string | null; trackingNumber: string | null; reason: string; requestId: string; createdAt: string;
  }>;
};

export type AccountDeletionBlockers = {
  pointBalance: number;
  activeOrderCount: number;
  activePaymentCount: number;
  availableDrawEntitlementCount: number;
  activeInventoryCount: number;
  activeShippingRequestCount: number;
  activeExchangeListingCount: number;
  activeExchangeOfferCount: number;
};

export type AdminAccountDeletionRequest = {
  id: string;
  user: CommerceUser;
  status: "PENDING_REVIEW" | "BLOCKED" | "PROCESSING" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";
  blockers: AccountDeletionBlockers;
  requestCount: number;
  version: number;
  requestedAt: string;
  lastRequestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  decidedBy: { id: string; nickname: string } | null;
  createdAt: string;
  updatedAt: string;
  hardDeletePerformed: boolean;
  completionAvailable: boolean;
  completionPolicy: "ADMIN_REVIEW_FALLBACK" | "AUTOMATED_WORKER" | "COMPLETED_ANONYMIZATION";
  authDeletionStatus: "NOT_REQUIRED" | "PENDING" | "COMPLETED";
  authDeletedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  deletionJob: {
    status: "PENDING" | "PROCESSING";
    attempts: number;
    availableAt: string | null;
    leaseExpiresAt: string | null;
    lastError: string | null;
    externalDeletedAt: string | null;
  } | null;
};

export type AdminAccountDeletionDetail = AdminAccountDeletionRequest & {
  currentBlockers: AccountDeletionBlockers;
  approvalEligible: boolean;
  rejectionAvailable: boolean;
  events: Array<{
    id: string;
    eventType: "CREATED" | "REASSESSED" | "STATUS_CHANGED";
    status: AdminAccountDeletionRequest["status"];
    blockers: AccountDeletionBlockers;
    revokedSessionCount: number;
    correlationId: string;
    metadata: Record<string, unknown>;
    admin: { id: string; nickname: string } | null;
    reason: string | null;
    createdAt: string;
  }>;
};
