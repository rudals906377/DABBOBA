import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import {
  beginIdempotency,
  completeIdempotency,
  idempotencyKey,
  requestHash,
} from "../lib/idempotency.js";
import {
  enumInput,
  integerInput,
  nullableStringInput,
  objectInput,
  slugIdInput,
  stringInput,
  uuidInput,
} from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import {
  loadRequiredPolicyDocuments,
  recordRequiredPolicyAcceptanceEvents,
} from "../lib/legal-policy.js";
import { CUSTOMER_SUBJECT_LOOKUP_PROVIDERS } from "../lib/supabase-auth.js";
import { requiredPolicyAcceptance } from "./customer-auth.js";
import type { ApiContext } from "../types.js";
import { rebaseLegacyCatalogMediaUrl } from "./catalog-media-url.js";

type ProfileRow = {
  id: string;
  nickname: string;
  bio: string | null;
  favorite_ip_id: string | null;
  favorite_ip_name_ko: string | null;
  favorite_ip_image_url: string | null;
  version: number;
  updated_at: Date;
};

type AccountBasicInfoRow = {
  id: string;
  nickname: string;
  email: string | null;
  phone_e164: string | null;
  birth_date: string | Date | null;
  version: number;
  updated_at: Date;
};

type AddressRow = {
  id: string;
  user_id: string;
  recipient: string;
  phone: string;
  postal_code: string;
  address_line1: string;
  address_line2: string | null;
  delivery_note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type WishlistRow = {
  id: string;
  product_id: string;
  product_name: string;
  ip_id: string;
  ip_name_ko: string;
  category: "gacha" | "figure" | "kuji" | "tcg";
  price: number | string;
  image_url: string | null;
  is_active: boolean;
  created_at: Date;
};

type AccountInventorySourceType = "GACHA" | "KUJI";

type AccountShippingPolicyItem = {
  sourceType: AccountInventorySourceType;
  price: number | string;
};

type AccountShippingInventoryRow = {
  id: string;
  source_type: AccountInventorySourceType;
  price: number | string;
};

type ShippingQuoteRow = {
  id: string;
  user_id: string;
  address_id: string;
  address_version: number;
  inventory_unit_ids: string[];
  item_count: number;
  reference_subtotal: number | string;
  contains_kuji: boolean;
  free_shipping_threshold: number | string;
  shipping_fee: number | string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  shipping_request_id: string | null;
  expired?: boolean;
};

type AccountInventoryRow = {
  id: string;
  owner_id: string;
  product_id: string;
  source_type: AccountInventorySourceType;
  inventory_status: "OWNED" | "EXCHANGE_LISTED" | "EXCHANGE_OFFERED" | "SHIPPING" | "EXPIRED_HOLD";
  acquired_at: Date;
  storage_expires_at?: Date;
  point_return_eligible: boolean;
  point_return_reference_amount: number | string | null;
  sku: string;
  ip_id: string;
  character_ids: string[];
  category: "gacha" | "figure" | "kuji" | "tcg";
  product_name: string;
  manufacturer: string | null;
  release_date: string | null;
  price: number | string;
  available_quantity: number | string;
  metadata: Record<string, unknown>;
  image_url: string | null;
  storefront_image_url: string | null;
  product_active: boolean;
  is_prize_only: boolean;
  product_version: number;
  product_created_at: Date;
  product_updated_at: Date;
  created_at: Date;
};

type OrderRow = {
  id: string;
  order_kind: "PRODUCT" | "SHIPPING_FEE";
  shipping_request_id: string | null;
  status: "PENDING_PAYMENT" | "PAID" | "FULFILLED" | "CANCELLED" | "REFUND_REVIEW" | "REFUNDED";
  currency: "KRW";
  subtotal: number | string;
  discount_total: number | string;
  point_total: number | string;
  total: number | string;
  created_at: Date;
  updated_at: Date;
};

type OrderLineRow = {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  category_snapshot: "gacha" | "figure" | "kuji" | "tcg";
  unit_price: number | string;
  quantity: number | string;
  line_total: number | string;
};

const DRAW_ENTITLEMENT_STATUSES = ["AVAILABLE", "CONSUMED", "CANCELLED"] as const;

type DrawEntitlementStatus = (typeof DRAW_ENTITLEMENT_STATUSES)[number];

type AccountDrawEntitlementRow = {
  id: string;
  order_id: string;
  order_line_id: string;
  product_id: string;
  product_name: string;
  product_category: "gacha" | "figure" | "kuji" | "tcg";
  product_image_url: string | null;
  probability_version: number;
  status: DrawEntitlementStatus;
  created_at: Date;
  consumed_at: Date | null;
};

type PointLedgerRow = {
  id: string;
  entry_type: "EARN" | "SPEND" | "REFUND" | "EXPIRE" | "ADJUSTMENT";
  amount: number | string;
  reference_type: string;
  reference_id: string;
  reason: string;
  created_at: Date;
};

type PointReturnInventoryStatus =
  | "OWNED"
  | "EXCHANGE_LISTED"
  | "EXCHANGE_OFFERED"
  | "SHIPPING"
  | "DELIVERED"
  | "TRANSFERRED"
  | "REFUNDED"
  | "POINT_RETURNED"
  | "EXPIRED_HOLD";

type PointReturnInventorySourceType = "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";

type PointReturnInventoryRow = {
  id: string;
  owner_id: string;
  product_id: string;
  source_type: PointReturnInventorySourceType;
  source_id: string | null;
  status: PointReturnInventoryStatus;
  reference_amount: number | string | null;
  purchase_order_status: string | null;
  purchase_order_user_id: string | null;
  purchase_category: string | null;
  purchase_product_id: string | null;
  original_entitlement_user_id: string | null;
  original_entitlement_product_id: string | null;
  draw_user_id: string | null;
  draw_entitlement_id: string | null;
  draw_prize_product_id: string | null;
  never_exchanged: boolean;
};

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

type PushDeviceTokenRow = {
  installation_id: string;
  platform: "IOS" | "ANDROID";
  app_version: string | null;
  last_registered_at: Date;
};

export type AccountNotificationDestination = {
  route: "home" | "gacha" | "kuji" | "storage" | "profile";
  detail: {
    kind: "product" | "order" | "shipping" | "inquiry" | "exchange" | "request";
    id: string;
  } | null;
};

const SHIPPING_REQUEST_STATUSES = ["PAYMENT_PENDING", "REQUESTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

type ShippingRequestStatus = (typeof SHIPPING_REQUEST_STATUSES)[number];

type ShippingRequestRow = {
  id: string;
  status: ShippingRequestStatus;
  version: number;
  inventory_unit_ids: string[];
  address_snapshot: unknown;
  requested_at: Date;
  updated_at: Date;
  shipped_at: Date | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  created_at: Date;
};

type ShippingRequestItemRow = {
  inventory_unit_id: string;
  product_id: string;
  product_name: string;
  ip_id: string;
  ip_name_ko: string;
  category: "gacha" | "figure" | "kuji" | "tcg";
  image_url: string | null;
  product_version: number;
};

type AccountDeletionStatus = "PENDING_REVIEW" | "BLOCKED" | "PROCESSING" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";

type AccountDeletionBlockerRow = {
  point_balance: number | string;
  active_order_count: number | string;
  active_payment_count: number | string;
  available_draw_entitlement_count: number | string;
  active_inventory_count: number | string;
  active_shipping_request_count: number | string;
  active_exchange_listing_count: number | string;
  active_exchange_offer_count: number | string;
};

type AccountDeletionRequestRow = {
  id: string;
  status: AccountDeletionStatus;
  blocker_snapshot: AccountDeletionBlockers;
  request_count: number;
  requested_at: Date;
  last_requested_at: Date;
  completed_at: Date | null;
  auth_deletion_status: "NOT_REQUIRED" | "PENDING" | "COMPLETED";
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

type IdempotentWork<T> = {
  statusCode: number;
  body: T;
  resourceType: string;
  resourceId: string;
};

type IdempotentResult<T> = {
  replay: boolean;
  statusCode: number;
  body: T;
};

async function idempotentMutation<T>(
  context: ApiContext,
  input: {
    actorId: string;
    scope: string;
    key: string;
    payload: unknown;
    work: (client: DatabaseClient) => Promise<IdempotentWork<T>>;
  },
): Promise<IdempotentResult<T>> {
  return withTransaction(context.pool, async (client) => {
    const started = await beginIdempotency(client, {
      actorId: input.actorId,
      scope: input.scope,
      key: input.key,
      hash: requestHash(input.payload),
    });
    if (!started.fresh) {
      return { replay: true, statusCode: started.statusCode, body: started.body as T };
    }
    const result = await input.work(client);
    await completeIdempotency(client, started.id, result);
    return { replay: false, statusCode: result.statusCode, body: result.body };
  });
}

function sendMutation<T>(reply: FastifyReply, result: IdempotentResult<T>) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(result.statusCode).send(result.body);
}

function queryOf(request: FastifyRequest): Record<string, unknown> {
  return (request.query || {}) as Record<string, unknown>;
}

function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw badRequest(`지원하지 않는 입력 항목입니다: ${unknown}`);
}

export function accountDeletionStatus(blockers: AccountDeletionBlockers): "PROCESSING" | "BLOCKED" {
  return Object.values(blockers).some((value) => value > 0) ? "BLOCKED" : "PROCESSING";
}

function mapDeletionBlockers(row: AccountDeletionBlockerRow): AccountDeletionBlockers {
  return {
    pointBalance: numberValue(row.point_balance),
    activeOrderCount: numberValue(row.active_order_count),
    activePaymentCount: numberValue(row.active_payment_count),
    availableDrawEntitlementCount: numberValue(row.available_draw_entitlement_count),
    activeInventoryCount: numberValue(row.active_inventory_count),
    activeShippingRequestCount: numberValue(row.active_shipping_request_count),
    activeExchangeListingCount: numberValue(row.active_exchange_listing_count),
    activeExchangeOfferCount: numberValue(row.active_exchange_offer_count),
  };
}

function mapDeletionRequest(row: AccountDeletionRequestRow) {
  return {
    id: row.id,
    status: row.status,
    blockers: row.blocker_snapshot,
    requestCount: row.request_count,
    hardDeletePerformed: false,
    policy: "AUTOMATED_SERVER_DELETION" as const,
    authDeletionStatus: row.auth_deletion_status,
    requestedAt: iso(row.requested_at),
    lastRequestedAt: iso(row.last_requested_at),
    completedAt: nullableIso(row.completed_at),
  };
}

function deletionStatusTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function deletionStatusToken(headers: FastifyRequest["headers"]): string | null {
  const raw = headers["x-deletion-status-token"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function supabaseAuthUserIdForDeletion(
  providerSubjects: readonly string[],
  supabaseUrl: string | null | undefined,
): string | null {
  if (!supabaseUrl || providerSubjects.length === 0) return null;
  const prefix = `${supabaseUrl.replace(/\/$/, "")}/auth/v1#`;
  const ids = [...new Set(providerSubjects
    .filter((subject) => subject.startsWith(prefix))
    .map((subject) => subject.slice(prefix.length)))];
  if (ids.length === 0) return null;
  if (ids.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ids[0]!)) {
    throw conflict("로그인 연결 정보를 안전하게 삭제할 수 없습니다.");
  }
  return ids[0]!;
}

export async function loadDeletionBlockers(queryable: Queryable, userId: string): Promise<AccountDeletionBlockers> {
  const result = await queryable.query<AccountDeletionBlockerRow>(
    `SELECT
       COALESCE((SELECT balance FROM point_accounts WHERE user_id=$1),0) AS point_balance,
       (SELECT count(*) FROM orders
         WHERE user_id=$1 AND status IN ('PENDING_PAYMENT','PAID','REFUND_REVIEW')) AS active_order_count,
       (SELECT count(*) FROM payments p JOIN orders o ON o.id=p.order_id
         WHERE o.user_id=$1 AND p.status IN ('PENDING','AUTHORIZED','PAID','REFUND_REVIEW')) AS active_payment_count,
       (SELECT count(*) FROM draw_entitlements
         WHERE user_id=$1 AND status='AVAILABLE') AS available_draw_entitlement_count,
       (SELECT count(*) FROM inventory_units
         WHERE owner_id=$1 AND status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','EXPIRED_HOLD')) AS active_inventory_count,
       (SELECT count(*) FROM shipping_requests
        WHERE user_id=$1 AND status IN ('PAYMENT_PENDING','REQUESTED','PROCESSING','SHIPPED')) AS active_shipping_request_count,
       (SELECT count(*) FROM exchange_listings
         WHERE author_id=$1 AND status IN ('OPEN','MATCHED')) AS active_exchange_listing_count,
       (SELECT count(*) FROM exchange_offers
         WHERE proposer_id=$1 AND status IN ('PENDING','ACCEPTED')) AS active_exchange_offer_count`,
    [userId],
  );
  return mapDeletionBlockers(result.rows[0]!);
}

async function loadProfile(queryable: Queryable, userId: string): Promise<ProfileRow> {
  const result = await queryable.query<ProfileRow>(
    `SELECT u.id,u.nickname,p.bio,p.favorite_ip_id,i.name_ko AS favorite_ip_name_ko,
       i.image_url AS favorite_ip_image_url,p.version,p.updated_at
     FROM users u JOIN user_profiles p ON p.user_id=u.id
     LEFT JOIN catalog_ips i ON i.id=p.favorite_ip_id
     WHERE u.id=$1`,
    [userId],
  );
  if (!result.rowCount) throw notFound("프로필을 찾을 수 없습니다.");
  return result.rows[0]!;
}

async function loadAccountBasicInfo(queryable: Queryable, userId: string): Promise<AccountBasicInfoRow> {
  const result = await queryable.query<AccountBasicInfoRow>(
    `SELECT u.id,u.nickname,u.email::text,u.phone_e164,p.birth_date,p.version,p.updated_at
     FROM users u JOIN user_profiles p ON p.user_id=u.id
     WHERE u.id=$1`,
    [userId],
  );
  if (!result.rowCount) throw notFound("계정 기본정보를 찾을 수 없습니다.");
  return result.rows[0]!;
}

const mapProfile = (row: ProfileRow) => ({
  id: row.id,
  nickname: row.nickname,
  bio: row.bio,
  favoriteIp: row.favorite_ip_id
    ? {
        id: row.favorite_ip_id,
        nameKo: row.favorite_ip_name_ko || row.favorite_ip_id,
        imageUrl: row.favorite_ip_image_url,
      }
    : null,
  version: row.version,
  updatedAt: iso(row.updated_at),
});

export function maskAccountPhone(providerSubject: string): string {
  const digits = providerSubject.replace(/\D/g, "");
  if (/^010\d{8}$/.test(digits)) return `010-****-${digits.slice(-4)}`;
  if (/^8210\d{8}$/.test(digits)) return `+82-10-****-${digits.slice(-4)}`;
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

const mapAccountBasicInfo = (row: AccountBasicInfoRow) => ({
  id: row.id,
  nickname: row.nickname,
  email: row.email,
  phoneMasked: row.phone_e164 ? maskAccountPhone(row.phone_e164) : null,
  birthDate: dateOnly(row.birth_date),
  version: row.version,
  updatedAt: iso(row.updated_at),
});

const mapAddress = (row: AddressRow) => ({
  id: row.id,
  recipient: row.recipient,
  phone: row.phone,
  postalCode: row.postal_code,
  addressLine1: row.address_line1,
  addressLine2: row.address_line2,
  deliveryNote: row.delivery_note,
  version: row.version,
  updatedAt: iso(row.updated_at),
});

const mapWishlistItem = (row: WishlistRow) => ({
  id: row.id,
  product: {
    id: row.product_id,
    name: row.product_name,
    ipId: row.ip_id,
    ipNameKo: row.ip_name_ko,
    category: row.category,
    price: numberValue(row.price),
    imageUrl: row.image_url,
    isActive: row.is_active,
  },
  wishedAt: iso(row.created_at),
});

const mapAccountInventory = (row: AccountInventoryRow) => ({
  id: row.id,
  ownerId: row.owner_id,
  productId: row.product_id,
  product: {
    id: row.product_id,
    sku: row.sku,
    ipId: row.ip_id,
    characterIds: row.character_ids,
    category: row.category,
    name: row.product_name,
    manufacturer: row.manufacturer,
    releaseDate: row.release_date,
    price: numberValue(row.price),
    availableQuantity: numberValue(row.available_quantity),
    totalQuantity: null,
    metadata: row.metadata,
    imageUrl: row.image_url,
    storefrontImageUrl: row.storefront_image_url,
    isActive: row.product_active,
    isPrizeOnly: row.is_prize_only,
    version: row.product_version,
    createdAt: iso(row.product_created_at),
    updatedAt: iso(row.product_updated_at),
  },
  sourceType: row.source_type,
  status: row.inventory_status,
  acquiredAt: iso(row.acquired_at),
  pointReturnEligible: row.point_return_eligible,
  ...(row.point_return_eligible && row.point_return_reference_amount !== null
    ? { pointReturnAmount: pointReturnAmount(numberValue(row.point_return_reference_amount)) }
    : {}),
  ...(row.storage_expires_at ? { storageExpiresAt: iso(row.storage_expires_at) } : {}),
});

const mapPointEntry = (row: PointLedgerRow) => ({
  id: row.id,
  entryType: row.entry_type,
  amount: numberValue(row.amount),
  referenceType: row.reference_type,
  referenceId: row.reference_id,
  reason: row.reason,
  createdAt: iso(row.created_at),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[^\]\s]{8,240}\]$/;

export function isExpoPushToken(value: string): boolean {
  return value.length <= 256 && EXPO_PUSH_TOKEN_PATTERN.test(value);
}

function notificationDataIdentifier(
  data: Record<string, unknown>,
  keys: readonly string[],
  pattern: RegExp,
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && pattern.test(value)) return value;
  }
  return null;
}

/**
 * Produces the only navigation contract exposed to customer clients. Stored
 * notification data is intentionally never interpreted as a URL or route.
 */
export function accountNotificationDestination(
  kind: string,
  data: Record<string, unknown>,
): AccountNotificationDestination {
  if (kind.startsWith("ORDER_") || kind.startsWith("PAYMENT_")) {
    const id = notificationDataIdentifier(data, ["orderId"], UUID_PATTERN);
    return { route: "profile", detail: id ? { kind: "order", id } : null };
  }
  if (kind.startsWith("SHIPPING_")) {
    const id = notificationDataIdentifier(data, ["shippingRequestId", "requestId"], UUID_PATTERN);
    return { route: "profile", detail: id ? { kind: "shipping", id } : null };
  }
  if (kind.startsWith("INQUIRY_")) {
    const id = notificationDataIdentifier(data, ["inquiryId"], UUID_PATTERN);
    return { route: "profile", detail: id ? { kind: "inquiry", id } : null };
  }
  if (kind.startsWith("EXCHANGE_")) {
    const id = notificationDataIdentifier(data, ["listingId", "exchangeListingId"], UUID_PATTERN);
    return { route: "storage", detail: id ? { kind: "exchange", id } : null };
  }
  if (kind.startsWith("STORAGE_")) return { route: "storage", detail: null };
  if (kind.startsWith("CATALOG_REQUEST_") || kind.startsWith("WANTED_REQUEST_")) {
    const id = notificationDataIdentifier(data, ["requestId", "wantedRequestId", "aggregateId"], UUID_PATTERN);
    return { route: "profile", detail: id ? { kind: "request", id } : null };
  }
  if (kind.startsWith("RESTOCK_")) {
    const id = notificationDataIdentifier(data, ["productId"], SLUG_PATTERN);
    const route = typeof data.category === "string" && data.category.toUpperCase() === "KUJI"
      ? "kuji" as const
      : "gacha" as const;
    return { route, detail: id ? { kind: "product", id } : null };
  }
  if (kind.startsWith("KUJI_")) return { route: "kuji", detail: null };
  if (kind === "DRAW_RESULT" || kind.startsWith("GACHA_")) {
    return { route: "storage", detail: null };
  }
  if (kind === "USER_WARNING") return { route: "profile", detail: null };
  return { route: "home", detail: null };
}

/**
 * Stored notification data is written by many server modules and may carry
 * internal fields (actor ids, amounts, reasons, provider state). Customer
 * clients only need the identifiers already covered by the destination
 * contract, so every other key is withheld and each value is re-validated.
 */
const PUBLIC_NOTIFICATION_DATA_FIELDS: Readonly<Record<string, RegExp>> = {
  orderId: UUID_PATTERN,
  shippingRequestId: UUID_PATTERN,
  inquiryId: UUID_PATTERN,
  listingId: UUID_PATTERN,
  exchangeListingId: UUID_PATTERN,
  requestId: UUID_PATTERN,
  wantedRequestId: UUID_PATTERN,
  aggregateId: UUID_PATTERN,
  productId: SLUG_PATTERN,
  category: /^[A-Za-z]{1,20}$/,
};

export function publicNotificationData(data: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, pattern] of Object.entries(PUBLIC_NOTIFICATION_DATA_FIELDS)) {
    const value = data[key];
    if (typeof value === "string" && pattern.test(value)) result[key] = value;
  }
  return result;
}

const mapNotification = (row: NotificationRow) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  data: publicNotificationData(row.data),
  destination: accountNotificationDestination(row.kind, row.data),
  readAt: nullableIso(row.read_at),
  createdAt: iso(row.created_at),
});

const mapPushDeviceRegistration = (row: PushDeviceTokenRow) => ({
  installationId: row.installation_id,
  platform: row.platform,
  appVersion: row.app_version,
  registeredAt: iso(row.last_registered_at),
});

const mapDrawEntitlement = (row: AccountDrawEntitlementRow) => ({
  id: row.id,
  orderId: row.order_id,
  orderLineId: row.order_line_id,
  product: {
    id: row.product_id,
    name: row.product_name,
    category: row.product_category,
    imageUrl: row.product_image_url,
  },
  probabilityVersion: row.probability_version,
  status: row.status,
  createdAt: iso(row.created_at),
  consumedAt: nullableIso(row.consumed_at),
});

function shippingDestination(value: unknown) {
  const snapshot = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const field = (key: string) => typeof snapshot[key] === "string" ? snapshot[key] as string : "";
  return {
    recipientMasked: maskShippingRecipient(field("recipient")),
    phoneMasked: maskShippingPhone(field("phone")),
    postalCode: field("postalCode"),
    addressLine1: field("addressLine1"),
    addressLine2: field("addressLine2") || null,
  };
}

const mapShippingRequest = (row: ShippingRequestRow) => ({
  id: row.id,
  status: row.status,
  version: row.version,
  inventoryUnitIds: row.inventory_unit_ids,
  destination: shippingDestination(row.address_snapshot),
  requestedAt: iso(row.requested_at),
  updatedAt: iso(row.updated_at),
  shippedAt: nullableIso(row.shipped_at),
  trackingCarrier: row.tracking_carrier,
  trackingNumber: row.tracking_number,
});

const mapShippingRequestItem = (row: ShippingRequestItemRow, catalogMediaBaseUrl?: string | null) => ({
  inventoryUnitId: row.inventory_unit_id,
  productId: row.product_id,
  productName: row.product_name,
  ipId: row.ip_id,
  ipNameKo: row.ip_name_ko,
  category: row.category,
  // Request-time snapshots stay immutable; only the legacy media host is translated on read.
  imageUrl: rebaseLegacyCatalogMediaUrl(catalogMediaBaseUrl, row.image_url),
  productVersion: row.product_version,
});

function profilePatch(body: unknown) {
  const input = objectInput(body);
  assertOnlyKeys(input, ["nickname", "bio", "favoriteIpId", "expectedVersion"]);
  const nickname = input.nickname === undefined ? undefined : stringInput(input, "nickname", { max: 40 });
  const bio = nullableStringInput(input, "bio", { max: 500 });
  let favoriteIpId: string | null | undefined;
  if (Object.hasOwn(input, "favoriteIpId")) {
    favoriteIpId = input.favoriteIpId === null
      ? null
      : slugIdInput(input.favoriteIpId, "favoriteIpId");
  }
  const expectedVersion = integerInput(input, "expectedVersion", { min: 1 })!;
  if (nickname === undefined && bio === undefined && favoriteIpId === undefined) {
    throw badRequest("수정할 프로필 값을 입력해 주세요.");
  }
  return { nickname, bio, favoriteIpId, expectedVersion };
}

export function normalizeBirthDate(value: unknown, today = new Date()): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest("birthDate는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw badRequest("birthDate에 올바른 날짜를 입력해 주세요.");
  }
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const minimum = Date.UTC(1900, 0, 1);
  if (parsed.getTime() < minimum || parsed.getTime() > todayUtc.getTime()) {
    throw badRequest("birthDate 범위를 확인해 주세요.");
  }
  return value;
}

function accountBasicInfoPatch(body: unknown) {
  const input = objectInput(body);
  assertOnlyKeys(input, ["nickname", "birthDate", "expectedVersion"]);
  const nickname = input.nickname === undefined ? undefined : stringInput(input, "nickname", { max: 40 });
  let birthDate: string | null | undefined;
  if (Object.hasOwn(input, "birthDate")) {
    birthDate = input.birthDate === null ? null : normalizeBirthDate(input.birthDate);
  }
  const expectedVersion = integerInput(input, "expectedVersion", { min: 1 })!;
  if (nickname === undefined && birthDate === undefined) {
    throw badRequest("수정할 계정 기본정보를 입력해 주세요.");
  }
  return { nickname, birthDate, expectedVersion };
}

export function normalizeShippingPhone(value: string): string {
  const normalized = value.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(normalized)) throw badRequest("phone 형식을 확인해 주세요.");
  return normalized;
}

function addressInput(body: unknown) {
  const input = objectInput(body);
  assertOnlyKeys(input, ["recipient", "phone", "postalCode", "addressLine1", "addressLine2", "deliveryNote", "expectedVersion"]);
  const postalCode = stringInput(input, "postalCode", { max: 12 })!;
  if (!/^[A-Za-z0-9 -]{3,12}$/.test(postalCode)) throw badRequest("postalCode 형식을 확인해 주세요.");
  return {
    recipient: stringInput(input, "recipient", { max: 80 })!,
    phone: normalizeShippingPhone(stringInput(input, "phone", { max: 32 })!),
    postalCode,
    addressLine1: stringInput(input, "addressLine1", { max: 200 })!,
    addressLine2: nullableStringInput(input, "addressLine2", { max: 200 }) ?? null,
    deliveryNote: nullableStringInput(input, "deliveryNote", { max: 200 }) ?? null,
    expectedVersion: integerInput(input, "expectedVersion", { min: 1, optional: true }),
  };
}

function canonicalInventoryUnitIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw badRequest("inventoryUnitIds는 1~20개여야 합니다.");
  }
  const ids = value.map((item) => uuidInput(item, "inventoryUnitId").toLowerCase());
  if (new Set(ids).size !== ids.length) throw badRequest("같은 보관 상품을 중복 선택할 수 없습니다.");
  return ids.sort((left, right) => left.localeCompare(right, "en-US"));
}

export function canonicalShippingInventoryIds(value: unknown): string[] {
  return canonicalInventoryUnitIds(value);
}

export function canonicalPointReturnInventoryIds(value: unknown): string[] {
  return canonicalInventoryUnitIds(value);
}

function shippingQuoteInput(body: unknown) {
  const input = objectInput(body);
  assertOnlyKeys(input, ["inventoryUnitIds"]);
  return { inventoryUnitIds: canonicalShippingInventoryIds(input.inventoryUnitIds) };
}

function shippingRequestInput(body: unknown) {
  const input = objectInput(body);
  assertOnlyKeys(input, ["quoteId", "addressVersion"]);
  return {
    quoteId: uuidInput(input.quoteId, "quoteId"),
    addressVersion: integerInput(input, "addressVersion", { min: 1 })!,
  };
}

export const GACHA_ONLY_FREE_SHIPPING_THRESHOLD = 24_900;
export const KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD = 54_900;
export const STANDARD_SHIPPING_FEE = 3_000;

export function calculateAccountShippingPolicy(items: readonly AccountShippingPolicyItem[]) {
  const hasSelection = items.length > 0;
  const containsKuji = items.some((item) => item.sourceType === "KUJI");
  const referenceSubtotal = items.reduce((sum, item) => {
    const price = numberValue(item.price);
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(sum + price)) {
      throw conflict("배송 상품 금액을 계산할 수 없습니다.");
    }
    return sum + price;
  }, 0);
  const freeShippingThreshold = containsKuji
    ? KUJI_INCLUDED_FREE_SHIPPING_THRESHOLD
    : GACHA_ONLY_FREE_SHIPPING_THRESHOLD;
  const qualifiesForFreeShipping = hasSelection && referenceSubtotal >= freeShippingThreshold;

  return {
    hasSelection,
    containsKuji,
    referenceSubtotal,
    threshold: freeShippingThreshold,
    freeShippingThreshold,
    qualifiesForFreeShipping,
    shippingFee: hasSelection && !qualifiesForFreeShipping ? STANDARD_SHIPPING_FEE : 0,
  };
}

function shippingQuoteMatchesCurrentPolicy(
  quote: ShippingQuoteRow,
  inventoryUnitIds: readonly string[],
  policy: ReturnType<typeof calculateAccountShippingPolicy>,
): boolean {
  return quote.item_count === inventoryUnitIds.length
    && quote.inventory_unit_ids.length === inventoryUnitIds.length
    && quote.inventory_unit_ids.every((id, index) => id === inventoryUnitIds[index])
    && numberValue(quote.reference_subtotal) === policy.referenceSubtotal
    && quote.contains_kuji === policy.containsKuji
    && numberValue(quote.free_shipping_threshold) === policy.freeShippingThreshold
    && numberValue(quote.shipping_fee) === policy.shippingFee;
}

export function pointReturnAmount(referenceAmount: number): number {
  if (!Number.isSafeInteger(referenceAmount) || referenceAmount < 0) {
    throw new Error("Point return reference amount must be a non-negative safe integer.");
  }
  return Math.floor(referenceAmount / 2);
}

export const MAX_POINT_BALANCE = 2_147_483_647;

export function pointReturnTotalAmount(pointAmounts: number[]): number {
  const total = pointAmounts.reduce((sum, pointAmount) => sum + pointAmount, 0);
  if (!Number.isSafeInteger(total) || total > MAX_POINT_BALANCE) {
    throw conflict("한 번에 환급할 수 있는 포인트 한도를 초과했습니다.");
  }
  return total;
}

export function isPointReturnEligibleInventory(
  status: PointReturnInventoryStatus,
  sourceType: PointReturnInventorySourceType,
  hasDirectDrawProvenance: boolean,
): boolean {
  return status === "OWNED"
    && sourceType === "GACHA"
    && hasDirectDrawProvenance;
}

export function maskShippingRecipient(value: string): string {
  const characters = [...value];
  if (characters.length <= 1) return "*";
  if (characters.length === 2) return `${characters[0]}*`;
  return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
}

export function maskShippingPhone(value: string): string {
  const visible = value.slice(-4);
  return `${"*".repeat(Math.max(4, value.length - visible.length))}${visible}`;
}

const wishlistSelect = `SELECT w.id,w.product_id,p.name AS product_name,p.ip_id,i.name_ko AS ip_name_ko,
  p.category,p.price,p.image_url,p.is_active,w.created_at
  FROM wishlist_items w JOIN catalog_products p ON p.id=w.product_id JOIN catalog_ips i ON i.id=p.ip_id`;

const accountInventorySelect = `SELECT
  iu.id,iu.owner_id,iu.product_id,iu.source_type,iu.status AS inventory_status,iu.acquired_at,iu.storage_expires_at,
  (iu.source_type='GACHA' AND iu.status='OWNED'
    AND point_purchase.reference_amount >= 2
    AND NOT EXISTS (
      SELECT 1 FROM inventory_ownership_transfers point_return_transfer
      WHERE point_return_transfer.inventory_unit_id=iu.id
    )) AS point_return_eligible,
  point_purchase.reference_amount AS point_return_reference_amount,
  p.sku,p.ip_id,
  COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id)
    FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids,
  p.category,p.name AS product_name,p.manufacturer,p.release_date,p.price,
  COALESCE(s.on_hand-s.reserved,0) AS available_quantity,p.metadata,p.image_url,p.storefront_image_url,
  p.is_active AS product_active,p.is_prize_only,p.version AS product_version,
  p.created_at AS product_created_at,p.updated_at AS product_updated_at,
  iu.acquired_at AS created_at
  FROM inventory_units iu
  JOIN catalog_products p ON p.id=iu.product_id
  LEFT JOIN product_stock s ON s.product_id=p.id
  LEFT JOIN LATERAL (
    SELECT purchase_line.unit_price AS reference_amount
    FROM draw_results point_draw
    JOIN draw_entitlements point_entitlement ON point_entitlement.id=point_draw.entitlement_id
    JOIN order_lines purchase_line ON purchase_line.id=point_entitlement.order_line_id
    JOIN orders purchase_order ON purchase_order.id=purchase_line.order_id
    WHERE point_draw.prize_inventory_unit_id=iu.id
      AND point_draw.user_id=iu.owner_id
      AND point_draw.entitlement_id=iu.source_id
      AND point_draw.prize_product_id=iu.product_id
      AND point_entitlement.user_id=iu.owner_id
      AND point_entitlement.product_id=purchase_line.product_id
      AND point_draw.product_id=point_entitlement.product_id
      AND purchase_line.category_snapshot='gacha'
      AND purchase_order.user_id=iu.owner_id
      AND purchase_order.status IN ('PAID','FULFILLED')
    LIMIT 1
  ) point_purchase ON true`;

const shippingRequestSelect = `SELECT s.id,s.status,s.version,s.address_snapshot,s.requested_at,s.updated_at,
  s.shipped_at,s.tracking_carrier,s.tracking_number,s.requested_at AS created_at,
  ARRAY(SELECT i.inventory_unit_id FROM shipping_request_items i
    WHERE i.shipping_request_id=s.id ORDER BY i.inventory_unit_id) AS inventory_unit_ids
  FROM shipping_requests s`;

async function loadShippingRequestItems(
  queryable: Queryable,
  shippingRequestId: string,
  catalogMediaBaseUrl?: string | null,
) {
  const result = await queryable.query<ShippingRequestItemRow>(
    `SELECT item.inventory_unit_id,
      item.product_snapshot->>'productId' AS product_id,
      item.product_snapshot->>'productName' AS product_name,
      item.product_snapshot->>'ipId' AS ip_id,
      item.product_snapshot->>'ipNameKo' AS ip_name_ko,
      item.product_snapshot->>'category' AS category,
      item.product_snapshot->>'imageUrl' AS image_url,
      (item.product_snapshot->>'productVersion')::integer AS product_version
     FROM shipping_request_items item
     WHERE item.shipping_request_id=$1
     ORDER BY item.inventory_unit_id`,
    [shippingRequestId],
  );
  return result.rows.map((row) => mapShippingRequestItem(row, catalogMediaBaseUrl));
}

export async function registerAccountRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/account/profile", { preHandler: context.auth.requireUser }, async (request) => {
    return mapProfile(await loadProfile(context.pool, request.actor!.userId));
  });

  app.get("/v1/account/owned-products/:productId", { preHandler: context.auth.requireUser }, async (request) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const result = await context.pool.query<AccountInventoryRow>(
      `${accountInventorySelect}
       WHERE iu.owner_id=$1 AND iu.product_id=$2 AND iu.source_type IN ('GACHA','KUJI')
         AND EXISTS (
           SELECT 1 FROM draw_results draw_result
           WHERE draw_result.prize_inventory_unit_id=iu.id
             AND draw_result.user_id=iu.owner_id
             AND draw_result.entitlement_id=iu.source_id
             AND draw_result.prize_product_id=iu.product_id
         )
       ORDER BY iu.acquired_at DESC,iu.id DESC LIMIT 1`,
      [request.actor!.userId, productId],
    );
    if (!result.rowCount) throw notFound("보유 상품을 찾을 수 없습니다.");
    return mapAccountInventory(result.rows[0]!).product;
  });

  app.patch("/v1/account/profile", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const input = profilePatch(request.body);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_PROFILE_UPDATE",
      key: idempotencyKey(request.headers),
      payload: input,
      work: async (client) => {
        const before = await client.query<ProfileRow>(
          `SELECT u.id,u.nickname,p.bio,p.favorite_ip_id,i.name_ko AS favorite_ip_name_ko,
             i.image_url AS favorite_ip_image_url,p.version,p.updated_at
           FROM users u JOIN user_profiles p ON p.user_id=u.id
           LEFT JOIN catalog_ips i ON i.id=p.favorite_ip_id
           WHERE u.id=$1 FOR UPDATE OF u,p`,
          [actorId],
        );
        if (!before.rowCount) throw notFound("프로필을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.version !== input.expectedVersion) throw conflict("프로필이 다른 기기에서 먼저 수정되었습니다.");
        if (input.favoriteIpId) {
          const ip = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1 AND is_active=true", [input.favoriteIpId]);
          if (!ip.rowCount) throw badRequest("선호 IP를 찾을 수 없습니다.");
        }
        await client.query("UPDATE users SET nickname=$2 WHERE id=$1", [actorId, input.nickname ?? current.nickname]);
        const updated = await client.query(
          `UPDATE user_profiles SET bio=$2,favorite_ip_id=$3,version=version+1
           WHERE user_id=$1 AND version=$4 RETURNING user_id`,
          [
            actorId,
            input.bio === undefined ? current.bio : input.bio,
            input.favoriteIpId === undefined ? current.favorite_ip_id : input.favoriteIpId,
            input.expectedVersion,
          ],
        );
        if (!updated.rowCount) throw conflict("프로필이 다른 기기에서 먼저 수정되었습니다.");
        const body = mapProfile(await loadProfile(client, actorId));
        return { statusCode: 200, body, resourceType: "USER_PROFILE", resourceId: actorId };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/basic-info", { preHandler: context.auth.requireUser }, async (request) => {
    return mapAccountBasicInfo(await loadAccountBasicInfo(context.pool, request.actor!.userId));
  });

  app.patch("/v1/account/basic-info", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const input = accountBasicInfoPatch(request.body);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_BASIC_INFO_UPDATE",
      key: idempotencyKey(request.headers),
      payload: input,
      work: async (client) => {
        const before = await client.query<AccountBasicInfoRow>(
          `SELECT u.id,u.nickname,u.email::text,u.phone_e164,p.birth_date,p.version,p.updated_at
           FROM users u JOIN user_profiles p ON p.user_id=u.id
           WHERE u.id=$1 FOR UPDATE OF u,p`,
          [actorId],
        );
        if (!before.rowCount) throw notFound("계정 기본정보를 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.version !== input.expectedVersion) {
          throw conflict("계정 기본정보가 다른 기기에서 먼저 수정되었습니다.");
        }
        if (input.nickname !== undefined) {
          await client.query("UPDATE users SET nickname=$2 WHERE id=$1", [actorId, input.nickname]);
        }
        const updated = await client.query(
          `UPDATE user_profiles SET birth_date=$2,version=version+1
           WHERE user_id=$1 AND version=$3 RETURNING user_id`,
          [
            actorId,
            input.birthDate === undefined ? dateOnly(current.birth_date) : input.birthDate,
            input.expectedVersion,
          ],
        );
        if (!updated.rowCount) throw conflict("계정 기본정보가 다른 기기에서 먼저 수정되었습니다.");
        const body = mapAccountBasicInfo(await loadAccountBasicInfo(client, actorId));
        return { statusCode: 200, body, resourceType: "USER_PROFILE", resourceId: actorId };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/default-address", { preHandler: context.auth.requireUser }, async (request) => {
    const result = await context.pool.query<AddressRow>(
      "SELECT * FROM default_shipping_addresses WHERE user_id=$1",
      [request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("기본 배송지가 없습니다.");
    return mapAddress(result.rows[0]!);
  });

  app.put("/v1/account/default-address", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const input = addressInput(request.body);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_DEFAULT_ADDRESS_UPSERT",
      key: idempotencyKey(request.headers),
      payload: input,
      work: async (client) => {
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actorId]);
        const before = await client.query<AddressRow>(
          "SELECT * FROM default_shipping_addresses WHERE user_id=$1 FOR UPDATE",
          [actorId],
        );
        let address: AddressRow;
        if (before.rowCount) {
          if (input.expectedVersion === undefined || before.rows[0]!.version !== input.expectedVersion) {
            throw conflict("배송지가 다른 기기에서 먼저 수정되었습니다.");
          }
          const updated = await client.query<AddressRow>(
            `UPDATE default_shipping_addresses SET recipient=$2,phone=$3,postal_code=$4,address_line1=$5,
               address_line2=$6,delivery_note=$7,version=version+1
             WHERE user_id=$1 AND version=$8 RETURNING *`,
            [actorId,input.recipient,input.phone,input.postalCode,input.addressLine1,input.addressLine2,input.deliveryNote,input.expectedVersion],
          );
          if (!updated.rowCount) throw conflict("배송지가 다른 기기에서 먼저 수정되었습니다.");
          address = updated.rows[0]!;
        } else {
          if (input.expectedVersion !== undefined) throw conflict("새 배송지에는 expectedVersion을 보내지 마세요.");
          const created = await client.query<AddressRow>(
            `INSERT INTO default_shipping_addresses
               (user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note)
             VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [actorId,input.recipient,input.phone,input.postalCode,input.addressLine1,input.addressLine2,input.deliveryNote],
          );
          address = created.rows[0]!;
        }
        const body = mapAddress(address);
        return { statusCode: before.rowCount ? 200 : 201, body, resourceType: "SHIPPING_ADDRESS", resourceId: address.id };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/wishlist", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request), "uuid");
    const values: unknown[] = [request.actor!.userId, limit + 1];
    const filters = ["w.user_id=$1", "p.is_prize_only=false"];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(w.created_at,w.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<WishlistRow>(
      `${wishlistSelect} WHERE ${filters.join(" AND ")} ORDER BY w.created_at DESC,w.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapWishlistItem);
  });

  app.post("/v1/account/wishlist/:productId", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_WISHLIST_ADD",
      key: idempotencyKey(request.headers),
      payload: { productId },
      work: async (client) => {
        const product = await client.query(
          "SELECT 1 FROM catalog_products WHERE id=$1 AND is_active=true AND is_prize_only=false",
          [productId],
        );
        if (!product.rowCount) throw notFound("상품을 찾을 수 없습니다.");
        await client.query(
          "INSERT INTO wishlist_items(user_id,product_id) VALUES($1,$2) ON CONFLICT (user_id,product_id) DO NOTHING",
          [actorId, productId],
        );
        const item = await client.query<WishlistRow>(
          `${wishlistSelect} WHERE w.user_id=$1 AND w.product_id=$2`,
          [actorId, productId],
        );
        const body = mapWishlistItem(item.rows[0]!);
        return { statusCode: 200, body, resourceType: "WISHLIST_ITEM", resourceId: item.rows[0]!.id };
      },
    });
    return sendMutation(reply, result);
  });

  app.delete("/v1/account/wishlist/:productId", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_WISHLIST_REMOVE",
      key: idempotencyKey(request.headers),
      payload: { productId },
      work: async (client) => {
        const removed = await client.query<{ id: string }>(
          "DELETE FROM wishlist_items WHERE user_id=$1 AND product_id=$2 RETURNING id",
          [actorId, productId],
        );
        const body = { productId, removed: Boolean(removed.rowCount) };
        return { statusCode: 200, body, resourceType: "WISHLIST_ITEM", resourceId: removed.rows[0]?.id || productId };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/inventory", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request), "uuid");
    const values: unknown[] = [request.actor!.userId, limit + 1];
    const filters = [
      "iu.owner_id=$1",
      "iu.status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','EXPIRED_HOLD')",
      "(iu.status IN ('SHIPPING','EXPIRED_HOLD') OR iu.storage_expires_at>now())",
      "iu.source_type IN ('GACHA','KUJI')",
      `(EXISTS (
         SELECT 1 FROM draw_results draw_result
         WHERE draw_result.prize_inventory_unit_id=iu.id
           AND draw_result.user_id=iu.owner_id
           AND draw_result.entitlement_id=iu.source_id
           AND draw_result.prize_product_id=iu.product_id
       ) OR EXISTS (
         SELECT 1
           FROM inventory_ownership_transfers transfer
           JOIN exchange_listings completed_exchange
             ON completed_exchange.id=transfer.exchange_listing_id
            AND completed_exchange.status='COMPLETED'
          WHERE transfer.inventory_unit_id=iu.id
            AND transfer.to_owner_id=iu.owner_id
       ))`,
    ];
    if (cursor) {
      values.push(cursor.createdAt, uuidInput(cursor.id, "cursor.id"));
      filters.push(`(iu.acquired_at,iu.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<AccountInventoryRow>(
      `${accountInventorySelect}
       WHERE ${filters.join(" AND ")}
       ORDER BY iu.acquired_at DESC,iu.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapAccountInventory);
  });

  app.get("/v1/account/orders", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request), "uuid");
    return withTransaction(context.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const values: unknown[] = [request.actor!.userId, limit + 1];
      const filters = ["user_id=$1"];
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        filters.push(`(created_at,id)<($${values.length - 1},$${values.length})`);
      }
      const orders = await client.query<OrderRow>(
        `SELECT id,order_kind,shipping_request_id,status,currency,subtotal,discount_total,point_total,total,created_at,updated_at
         FROM orders WHERE ${filters.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $2`,
        values,
      );
      const orderIds = orders.rows.slice(0, limit).map((order) => order.id);
      const lines = orderIds.length
        ? await client.query<OrderLineRow>(
            `SELECT id,order_id,product_id,product_name_snapshot,category_snapshot,unit_price,quantity,line_total
             FROM order_lines WHERE order_id=ANY($1::uuid[]) ORDER BY created_at,id`,
            [orderIds],
          )
        : { rows: [] as OrderLineRow[] };
      const linesByOrder = new Map<string, OrderLineRow[]>();
      for (const line of lines.rows) {
        const group = linesByOrder.get(line.order_id) || [];
        group.push(line);
        linesByOrder.set(line.order_id, group);
      }
      return cursorPage(orders.rows, limit, (order) => ({
        id: order.id,
        orderKind: order.order_kind,
        shippingRequestId: order.shipping_request_id,
        status: order.status,
        currency: order.currency,
        subtotal: numberValue(order.subtotal),
        discountTotal: numberValue(order.discount_total),
        pointTotal: numberValue(order.point_total),
        total: numberValue(order.total),
        lines: (linesByOrder.get(order.id) || []).map((line) => ({
          productId: line.product_id,
          productName: line.product_name_snapshot,
          category: line.category_snapshot,
          unitPrice: numberValue(line.unit_price),
          quantity: numberValue(line.quantity),
          lineTotal: numberValue(line.line_total),
        })),
        createdAt: iso(order.created_at),
        updatedAt: iso(order.updated_at),
      }));
    });
  });

  app.get("/v1/account/draw-entitlements", { preHandler: context.auth.requireUser }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const status = query.status === undefined
      ? "AVAILABLE"
      : enumInput(query, "status", DRAW_ENTITLEMENT_STATUSES)!;
    const values: unknown[] = [request.actor!.userId, limit + 1, status];
    const filters = ["e.user_id=$1", "o.user_id=$1", "e.status=$3"];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(e.created_at,e.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<AccountDrawEntitlementRow>(
      `SELECT e.id,l.order_id,e.order_line_id,e.product_id,
         p.name AS product_name,p.category AS product_category,p.image_url AS product_image_url,
         v.version AS probability_version,e.status,e.created_at,e.consumed_at
       FROM draw_entitlements e
       JOIN order_lines l ON l.id=e.order_line_id
       JOIN orders o ON o.id=l.order_id
       JOIN catalog_products p ON p.id=e.product_id
       JOIN draw_probability_versions v ON v.id=e.probability_version_id
       WHERE ${filters.join(" AND ")}
       ORDER BY e.created_at DESC,e.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapDrawEntitlement);
  });

  app.get("/v1/account/points", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request), "uuid");
    const actorId = request.actor!.userId;
    const values: unknown[] = [actorId, limit + 1];
    const filters = ["user_id=$1"];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(created_at,id)<($${values.length - 1},$${values.length})`);
    }
    return withTransaction(context.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const account = await client.query<{ balance: number | string; version: number }>(
        "SELECT balance,version FROM point_accounts WHERE user_id=$1",
        [actorId],
      );
      const ledger = await client.query<PointLedgerRow>(
        `SELECT id,entry_type,amount,reference_type,reference_id,reason,created_at
         FROM point_ledger_entries WHERE ${filters.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $2`,
        values,
      );
      const page = cursorPage(ledger.rows, limit, mapPointEntry);
      return {
        balance: numberValue(account.rows[0]?.balance),
        version: account.rows[0]?.version || 0,
        ...page,
      };
    });
  });

  app.post("/v1/account/point-returns", { preHandler: [requireLiveCommerce(context), context.auth.requireUser] }, async (request, reply) => {
    const body = objectInput(request.body);
    assertOnlyKeys(body, ["inventoryUnitIds"]);
    const inventoryUnitIds = canonicalPointReturnInventoryIds(body.inventoryUnitIds);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_POINT_RETURN_CREATE",
      key: idempotencyKey(request.headers),
      payload: { inventoryUnitIds },
      work: async (client) => {
        const lockedInventory = await client.query<PointReturnInventoryRow>(
          `SELECT iu.id,iu.owner_id,iu.product_id,iu.source_type,iu.source_id,iu.status,
             draw_result.user_id AS draw_user_id,
             draw_result.entitlement_id AS draw_entitlement_id,
             draw_result.prize_product_id AS draw_prize_product_id,
             purchase_line.unit_price AS reference_amount,
             purchase_line.category_snapshot AS purchase_category,
             purchase_line.product_id AS purchase_product_id,
             purchase_order.status AS purchase_order_status,
             purchase_order.user_id AS purchase_order_user_id,
             original_entitlement.user_id AS original_entitlement_user_id,
             original_entitlement.product_id AS original_entitlement_product_id,
             NOT EXISTS (
               SELECT 1 FROM inventory_ownership_transfers transfer_history
               WHERE transfer_history.inventory_unit_id=iu.id
             ) AS never_exchanged
           FROM inventory_units iu
           JOIN catalog_products p ON p.id=iu.product_id
           LEFT JOIN draw_results draw_result ON draw_result.prize_inventory_unit_id=iu.id
           LEFT JOIN draw_entitlements original_entitlement ON original_entitlement.id=draw_result.entitlement_id
           LEFT JOIN order_lines purchase_line ON purchase_line.id=original_entitlement.order_line_id
           LEFT JOIN orders purchase_order ON purchase_order.id=purchase_line.order_id
           WHERE iu.id=ANY($1::uuid[])
             AND iu.source_type='GACHA'
             AND iu.storage_expires_at>now()
           ORDER BY iu.id FOR UPDATE OF iu,p`,
          [inventoryUnitIds],
        );
        if (lockedInventory.rowCount !== inventoryUnitIds.length) {
          throw conflict("선택한 상품 중 포인트 환급을 신청할 수 없는 항목이 있습니다.");
        }

        const items = lockedInventory.rows.map((inventory) => {
          const originalDrawLinkMatches = inventory.draw_user_id === actorId
            && inventory.source_id === inventory.draw_entitlement_id
            && inventory.product_id === inventory.draw_prize_product_id
            && inventory.purchase_category === "gacha"
            && inventory.original_entitlement_user_id === actorId
            && inventory.purchase_order_user_id === actorId
            && inventory.original_entitlement_product_id === inventory.purchase_product_id
            && ["PAID", "FULFILLED"].includes(inventory.purchase_order_status ?? "");
          if (
            inventory.owner_id !== actorId
            || !isPointReturnEligibleInventory(
              inventory.status,
              inventory.source_type,
              originalDrawLinkMatches && inventory.never_exchanged,
            )
          ) {
            throw conflict("본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 포인트 환급을 신청할 수 있습니다.");
          }
          const referenceAmount = numberValue(inventory.reference_amount);
          const pointAmount = pointReturnAmount(referenceAmount);
          if (pointAmount <= 0) {
            throw conflict("환급 포인트가 0P인 상품은 포인트 환급을 신청할 수 없습니다.");
          }
          return {
            inventoryUnitId: inventory.id,
            productId: inventory.product_id,
            referenceAmount,
            pointAmount,
          };
        });
        const totalPointAmount = pointReturnTotalAmount(items.map((item) => item.pointAmount));

        const created = await client.query<{ id: string; returned_at: Date }>(
          `INSERT INTO inventory_point_returns(user_id,total_point_amount)
           VALUES($1,$2) RETURNING id,returned_at`,
          [actorId, totalPointAmount],
        );
        const pointReturnId = created.rows[0]!.id;
        const insertedItems = await client.query(
          `INSERT INTO inventory_point_return_items(
             point_return_id,inventory_unit_id,product_id,reference_amount,point_amount
           )
           SELECT $1,item.inventory_unit_id,item.product_id,item.reference_amount,item.point_amount
           FROM unnest($2::uuid[],$3::text[],$4::integer[],$5::integer[])
             AS item(inventory_unit_id,product_id,reference_amount,point_amount)`,
          [
            pointReturnId,
            items.map((item) => item.inventoryUnitId),
            items.map((item) => item.productId),
            items.map((item) => item.referenceAmount),
            items.map((item) => item.pointAmount),
          ],
        );
        if (insertedItems.rowCount !== items.length) {
          throw conflict("포인트 환급 상품 기록을 저장하지 못했습니다.");
        }
        const transitioned = await client.query<{ id: string }>(
          `UPDATE inventory_units SET status='POINT_RETURNED'
           WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED'
             AND storage_expires_at>now()
           RETURNING id`,
          [inventoryUnitIds, actorId],
        );
        if (transitioned.rowCount !== inventoryUnitIds.length) {
          throw conflict("선택한 상품의 보관 상태가 변경되었습니다.");
        }

        await client.query(
          "INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING",
          [actorId],
        );
        await client.query(
          `INSERT INTO point_ledger_entries(
             user_id,entry_type,amount,reference_type,reference_id,reason
           ) VALUES($1,'EARN',$2,'INVENTORY_POINT_RETURN',$3,'보관 상품 포인트 환급')`,
          [actorId, totalPointAmount, pointReturnId],
        );
        const pointAccount = await client.query<{ balance: number | string; version: number }>(
          `UPDATE point_accounts SET balance=balance+$2::integer,version=version+1
           WHERE user_id=$1 AND balance<=$3::integer-$2::integer RETURNING balance,version`,
          [actorId, totalPointAmount, MAX_POINT_BALANCE],
        );
        if (!pointAccount.rowCount) throw conflict("포인트 보유 한도를 초과했습니다.");

        await writeOutbox(client, request.id, {
          aggregateType: "INVENTORY_POINT_RETURN",
          aggregateId: pointReturnId,
          eventType: "inventory.point_returned",
          payload: { pointReturnId, userId: actorId, inventoryUnitIds, totalPointAmount },
        });
        const responseBody = {
          id: pointReturnId,
          inventoryUnitIds,
          totalPointAmount,
          balance: numberValue(pointAccount.rows[0]!.balance),
          returnedAt: iso(created.rows[0]!.returned_at),
        };
        return {
          statusCode: 201,
          body: responseBody,
          resourceType: "INVENTORY_POINT_RETURN",
          resourceId: pointReturnId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/notifications", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request), "uuid");
    const values: unknown[] = [request.actor!.userId, limit + 1];
    const filters = ["user_id=$1"];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(created_at,id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<NotificationRow>(
      `SELECT id,kind,title,body,data,read_at,created_at FROM notifications
       WHERE ${filters.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapNotification);
  });

  app.get("/v1/account/notifications/unread-summary", { preHandler: context.auth.requireUser }, async (request) => {
    const summary = await context.pool.query<{
      unread_count: number | string;
      newest_unread_created_at: Date | null;
    }>(
      `SELECT count(*)::integer AS unread_count,max(created_at) AS newest_unread_created_at
       FROM notifications WHERE user_id=$1 AND read_at IS NULL`,
      [request.actor!.userId],
    );
    const row = summary.rows[0];
    return {
      unreadCount: row ? numberValue(row.unread_count) : 0,
      newestUnreadCreatedAt: row ? nullableIso(row.newest_unread_created_at) : null,
    };
  });

  app.get("/v1/account/notifications/:notificationId", { preHandler: context.auth.requireUser }, async (request) => {
    const notificationId = uuidInput((request.params as Record<string, unknown>).notificationId, "notificationId");
    const result = await context.pool.query<NotificationRow>(
      `SELECT id,kind,title,body,data,read_at,created_at FROM notifications
       WHERE id=$1 AND user_id=$2`,
      [notificationId, request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("알림을 찾을 수 없습니다.");
    return mapNotification(result.rows[0]!);
  });

  app.post("/v1/account/notifications/:notificationId/read", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const notificationId = uuidInput((request.params as Record<string, unknown>).notificationId, "notificationId");
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_NOTIFICATION_READ",
      key: idempotencyKey(request.headers),
      payload: { notificationId },
      work: async (client) => {
        const updated = await client.query<NotificationRow>(
          `UPDATE notifications SET read_at=COALESCE(read_at,now())
           WHERE id=$1 AND user_id=$2 RETURNING id,kind,title,body,data,read_at,created_at`,
          [notificationId, actorId],
        );
        if (!updated.rowCount) throw notFound("알림을 찾을 수 없습니다.");
        const body = mapNotification(updated.rows[0]!);
        return { statusCode: 200, body, resourceType: "NOTIFICATION", resourceId: notificationId };
      },
    });
    return sendMutation(reply, result);
  });

  app.post("/v1/account/push-devices", { preHandler: context.auth.requireUser }, async (request) => {
    const input = objectInput(request.body);
    assertOnlyKeys(input, ["installationId", "expoPushToken", "platform", "appVersion"]);
    const installationId = uuidInput(input.installationId, "installationId");
    const expoPushToken = stringInput(input, "expoPushToken", { min: 24, max: 256, trim: false })!;
    const platform = enumInput(input, "platform", ["IOS", "ANDROID"] as const)!;
    const appVersion = nullableStringInput(input, "appVersion", { max: 40 });
    if (!isExpoPushToken(expoPushToken)) throw badRequest("Expo 푸시 토큰 형식을 확인해 주세요.");
    const actor = request.actor!;

    const registered = await withTransaction(context.pool, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(lock_key,0))
           FROM unnest($1::text[]) AS lock_keys(lock_key)
          ORDER BY lock_key`,
        [[`push-installation:${installationId}`, `push-token:${expoPushToken}`].sort()],
      );
      await client.query(
        `UPDATE push_device_tokens
            SET disabled_at=now(),disabled_reason='OWNERSHIP_ROTATED'
          WHERE disabled_at IS NULL
            AND (installation_id=$1 OR expo_push_token=$2)
            AND NOT (user_id=$3 AND installation_id=$1)`,
        [installationId, expoPushToken, actor.userId],
      );
      const result = await client.query<PushDeviceTokenRow>(
        `INSERT INTO push_device_tokens(
           user_id,session_id,installation_id,expo_push_token,platform,app_version
         ) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id,installation_id) DO UPDATE SET
           session_id=EXCLUDED.session_id,
           expo_push_token=EXCLUDED.expo_push_token,
           platform=EXCLUDED.platform,
           app_version=EXCLUDED.app_version,
           disabled_at=NULL,
           disabled_reason=NULL,
           last_registered_at=now()
         RETURNING installation_id,platform,app_version,last_registered_at`,
        [actor.userId, actor.sessionId, installationId, expoPushToken, platform, appVersion],
      );
      return result.rows[0]!;
    });
    return mapPushDeviceRegistration(registered);
  });

  app.delete("/v1/account/push-devices/:installationId", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const installationId = uuidInput(
      (request.params as Record<string, unknown>).installationId,
      "installationId",
    );
    await context.pool.query(
      `UPDATE push_device_tokens
          SET disabled_at=COALESCE(disabled_at,now()),
              disabled_reason=COALESCE(disabled_reason,'USER_DISABLED')
        WHERE user_id=$1 AND installation_id=$2`,
      [request.actor!.userId, installationId],
    );
    return reply.code(204).send();
  });

  app.get("/v1/account/shipping-requests", { preHandler: context.auth.requireUser }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query, "uuid");
    const status = query.status === undefined
      ? undefined
      : enumInput(query, "status", SHIPPING_REQUEST_STATUSES);
    const values: unknown[] = [request.actor!.userId, limit + 1];
    const filters = ["s.user_id=$1"];
    if (status) {
      values.push(status);
      filters.push(`s.status=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(s.requested_at,s.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<ShippingRequestRow>(
      `${shippingRequestSelect} WHERE ${filters.join(" AND ")}
       ORDER BY s.requested_at DESC,s.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapShippingRequest);
  });

  app.get("/v1/account/shipping-requests/:shippingRequestId", { preHandler: context.auth.requireUser }, async (request) => {
    const shippingRequestId = uuidInput(
      (request.params as Record<string, unknown>).shippingRequestId,
      "shippingRequestId",
    );
    const result = await context.pool.query<ShippingRequestRow>(
      `${shippingRequestSelect} WHERE s.id=$1 AND s.user_id=$2`,
      [shippingRequestId, request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("배송 신청을 찾을 수 없습니다.");
    const items = await loadShippingRequestItems(
      context.pool,
      shippingRequestId,
      context.config.catalogMediaBaseUrl,
    );
    return { ...mapShippingRequest(result.rows[0]!), items };
  });

  app.post("/v1/account/shipping-quotes", { preHandler: [requireLiveCommerce(context), context.auth.requireUser] }, async (request) => {
    const { inventoryUnitIds } = shippingQuoteInput(request.body);
    const actorId = request.actor!.userId;
    return withTransaction(context.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const address = await client.query<AddressRow>(
        "SELECT * FROM default_shipping_addresses WHERE user_id=$1 FOR SHARE",
        [actorId],
      );
      if (!address.rowCount) throw conflict("배송 견적을 만들기 전에 기본 배송지를 등록해 주세요.");
      const inventory = await client.query<AccountShippingInventoryRow>(
        `SELECT iu.id,iu.source_type,p.price
         FROM inventory_units iu
         JOIN catalog_products p ON p.id=iu.product_id
         WHERE iu.id=ANY($1::uuid[])
           AND iu.owner_id=$2
           AND iu.status='OWNED'
           AND iu.source_type IN ('GACHA','KUJI')
           AND iu.storage_expires_at>now()
         ORDER BY iu.id FOR SHARE OF iu,p`,
        [inventoryUnitIds, actorId],
      );
      if (inventory.rowCount !== inventoryUnitIds.length) {
        throw conflict("선택한 상품 중 배송 견적을 만들 수 없는 항목이 있습니다.");
      }
      const policy = calculateAccountShippingPolicy(inventory.rows.map((item) => ({
        sourceType: item.source_type,
        price: item.price,
      })));
      const addressRow = address.rows[0]!;
      const created = await client.query<ShippingQuoteRow>(
        `INSERT INTO shipping_quotes(
           user_id,address_id,address_version,inventory_unit_ids,item_count,
           reference_subtotal,contains_kuji,free_shipping_threshold,shipping_fee
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          actorId,
          addressRow.id,
          addressRow.version,
          inventoryUnitIds,
          inventoryUnitIds.length,
          policy.referenceSubtotal,
          policy.containsKuji,
          policy.freeShippingThreshold,
          policy.shippingFee,
        ],
      );
      const quote = created.rows[0]!;
      return {
        id: quote.id,
        inventoryUnitIds: quote.inventory_unit_ids,
        addressId: quote.address_id,
        addressVersion: quote.address_version,
        destination: {
          recipientMasked: maskShippingRecipient(addressRow.recipient),
          phoneMasked: maskShippingPhone(addressRow.phone),
          postalCode: addressRow.postal_code,
          addressLine1: addressRow.address_line1,
          addressLine2: addressRow.address_line2,
        },
        itemCount: quote.item_count,
        referenceSubtotal: numberValue(quote.reference_subtotal),
        containsKuji: quote.contains_kuji,
        freeShippingThreshold: numberValue(quote.free_shipping_threshold),
        qualifiesForFreeShipping: numberValue(quote.shipping_fee) === 0,
        shippingFee: numberValue(quote.shipping_fee),
        createdAt: iso(quote.created_at),
        expiresAt: iso(quote.expires_at),
      };
    });
  });

  app.post("/v1/account/shipping-requests", { preHandler: [requireLiveCommerce(context), context.auth.requireUser] }, async (request, reply) => {
    const input = shippingRequestInput(request.body);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_SHIPPING_REQUEST_CREATE",
      key: idempotencyKey(request.headers),
      payload: input,
      work: async (client) => {
        const quoteResult = await client.query<ShippingQuoteRow>(
          `SELECT quote.*,quote.expires_at<=now() AS expired
           FROM shipping_quotes quote
           WHERE quote.id=$1 AND quote.user_id=$2
           FOR UPDATE`,
          [input.quoteId, actorId],
        );
        if (!quoteResult.rowCount) throw notFound("배송 견적을 찾을 수 없습니다.");
        const quote = quoteResult.rows[0]!;
        if (quote.consumed_at || quote.shipping_request_id) {
          throw new AppError(409, "SHIPPING_QUOTE_CONSUMED", "이미 사용한 배송 견적입니다.");
        }
        if (quote.expired) {
          throw new AppError(409, "SHIPPING_QUOTE_EXPIRED", "배송 견적이 만료되었습니다. 다시 확인해 주세요.");
        }
        if (input.addressVersion !== quote.address_version) {
          throw new AppError(409, "SHIPPING_ADDRESS_CHANGED", "배송지가 변경되었습니다. 새 견적을 확인해 주세요.");
        }
        const address = await client.query<AddressRow>(
          "SELECT * FROM default_shipping_addresses WHERE id=$1 AND user_id=$2 FOR SHARE",
          [quote.address_id, actorId],
        );
        if (!address.rowCount || address.rows[0]!.version !== quote.address_version) {
          throw new AppError(409, "SHIPPING_ADDRESS_CHANGED", "배송지가 변경되었습니다. 새 견적을 확인해 주세요.");
        }
        const inventoryUnitIds = quote.inventory_unit_ids;
        const lockedInventory = await client.query<AccountShippingInventoryRow>(
          `SELECT iu.id,iu.source_type,p.price
           FROM inventory_units iu
           JOIN catalog_products p ON p.id=iu.product_id
           WHERE iu.id=ANY($1::uuid[])
             AND iu.owner_id=$2
             AND iu.status='OWNED'
             AND iu.source_type IN ('GACHA','KUJI')
             AND iu.storage_expires_at>now()
           ORDER BY iu.id FOR UPDATE OF iu,p`,
          [inventoryUnitIds, actorId],
        );
        if (lockedInventory.rowCount !== inventoryUnitIds.length) {
          throw new AppError(409, "SHIPPING_INVENTORY_CHANGED", "선택한 상품 상태가 변경되었습니다. 새 견적을 확인해 주세요.");
        }
        const shippingPolicy = calculateAccountShippingPolicy(lockedInventory.rows.map((inventory) => ({
          sourceType: inventory.source_type,
          price: inventory.price,
        })));
        if (!shippingQuoteMatchesCurrentPolicy(quote, inventoryUnitIds, shippingPolicy)) {
          throw new AppError(409, "SHIPPING_QUOTE_CHANGED", "배송 금액이 변경되었습니다. 새 견적을 확인해 주세요.");
        }
        if (
          shippingPolicy.shippingFee > 0
          && (context.config.paymentProvider === "UNCONFIGURED" || context.config.paymentProvider === "INTERNAL_ZERO")
        ) {
          throw new AppError(503, "PAYMENT_NOT_CONFIGURED", "배송비 결제 채널이 아직 구성되지 않았습니다.");
        }
        const addressRow = address.rows[0]!;
        const addressSnapshot = {
          addressId: addressRow.id,
          addressVersion: addressRow.version,
          recipient: addressRow.recipient,
          phone: addressRow.phone,
          postalCode: addressRow.postal_code,
          addressLine1: addressRow.address_line1,
          addressLine2: addressRow.address_line2,
          deliveryNote: addressRow.delivery_note,
        };
        const created = await client.query<{ id: string; requested_at: Date }>(
          `INSERT INTO shipping_requests(
             user_id,status,address_snapshot,reference_subtotal,free_shipping_threshold,
             qualifies_for_free_shipping,contains_kuji,shipping_fee
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,requested_at`,
          [
            actorId,
            shippingPolicy.qualifiesForFreeShipping ? "REQUESTED" : "PAYMENT_PENDING",
            JSON.stringify(addressSnapshot),
            shippingPolicy.referenceSubtotal,
            shippingPolicy.freeShippingThreshold,
            shippingPolicy.qualifiesForFreeShipping,
            shippingPolicy.containsKuji,
            shippingPolicy.shippingFee,
          ],
        );
        const shippingRequestId = created.rows[0]!.id;
        const insertedItems = await client.query(
          `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id,product_snapshot)
           SELECT $1,inventory.id,jsonb_build_object(
             'productId',product.id,
             'productName',product.name,
             'ipId',product.ip_id,
             'ipNameKo',ip.name_ko,
             'category',product.category,
             'imageUrl',product.image_url,
             'productVersion',product.version
           )
           FROM unnest($2::uuid[]) AS selected(item_id)
           JOIN inventory_units inventory ON inventory.id=selected.item_id
           JOIN catalog_products product ON product.id=inventory.product_id
           JOIN catalog_ips ip ON ip.id=product.ip_id`,
          [shippingRequestId, inventoryUnitIds],
        );
        if (insertedItems.rowCount !== inventoryUnitIds.length) {
          throw conflict("상품 정보를 배송 신청에 저장하지 못했습니다.");
        }
        const transitioned = await client.query<{ id: string }>(
          `UPDATE inventory_units SET status='SHIPPING'
           WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED'
             AND storage_expires_at>now()
           RETURNING id`,
          [inventoryUnitIds, actorId],
        );
        if (transitioned.rowCount !== inventoryUnitIds.length) {
          throw conflict("배송 상태를 변경하지 못했습니다.");
        }
        let paymentOrderId: string | null = null;
        let paymentId: string | null = null;
        if (shippingPolicy.shippingFee > 0) {
          const paymentOrder = await client.query<{ id: string }>(
            `INSERT INTO orders(
               user_id,subtotal,discount_total,point_total,total,order_kind,shipping_request_id
             ) VALUES($1,$2,0,0,$2,'SHIPPING_FEE',$3)
             RETURNING id`,
            [actorId, shippingPolicy.shippingFee, shippingRequestId],
          );
          paymentOrderId = paymentOrder.rows[0]!.id;
          const payment = await client.query<{ id: string }>(
            "INSERT INTO payments(order_id,provider,amount) VALUES($1,$2,$3) RETURNING id",
            [paymentOrderId, context.config.paymentProvider, shippingPolicy.shippingFee],
          );
          paymentId = payment.rows[0]!.id;
        }
        const consumed = await client.query(
          `UPDATE shipping_quotes
              SET consumed_at=now(),shipping_request_id=$3
            WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now()`,
          [quote.id, actorId, shippingRequestId],
        );
        if (consumed.rowCount !== 1) {
          throw new AppError(409, "SHIPPING_QUOTE_EXPIRED", "배송 견적을 사용할 수 없습니다. 다시 확인해 주세요.");
        }
        await writeOutbox(client, request.id, {
          aggregateType: "SHIPPING_REQUEST",
          aggregateId: shippingRequestId,
          eventType: shippingPolicy.qualifiesForFreeShipping
            ? "shipping.requested"
            : "shipping.payment_requested",
          payload: {
            shippingRequestId,
            shippingQuoteId: quote.id,
            userId: actorId,
            inventoryUnitIds,
            referenceSubtotal: shippingPolicy.referenceSubtotal,
            freeShippingThreshold: shippingPolicy.freeShippingThreshold,
            qualifiesForFreeShipping: shippingPolicy.qualifiesForFreeShipping,
            containsKuji: shippingPolicy.containsKuji,
            shippingFee: shippingPolicy.shippingFee,
            paymentOrderId,
            paymentId,
          },
        });
        const responseBody = {
          id: shippingRequestId,
          quoteId: quote.id,
          status: shippingPolicy.qualifiesForFreeShipping ? "REQUESTED" as const : "PAYMENT_PENDING" as const,
          inventoryUnitIds,
          destination: {
            recipientMasked: maskShippingRecipient(addressRow.recipient),
            phoneMasked: maskShippingPhone(addressRow.phone),
            postalCode: addressRow.postal_code,
            addressLine1: addressRow.address_line1,
            addressLine2: addressRow.address_line2,
          },
          requestedAt: iso(created.rows[0]!.requested_at),
          shippingFee: shippingPolicy.shippingFee,
          paymentOrderId,
          paymentId,
        };
        return {
          statusCode: 201,
          body: responseBody,
          resourceType: "SHIPPING_REQUEST",
          resourceId: shippingRequestId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/account/deletion-preview", {
    preHandler: context.auth.requireUserWithoutPolicy,
    config: { allowAccountDeletionScope: true },
  }, async (request, reply) => {
    const blockers = await loadDeletionBlockers(context.pool, request.actor!.userId);
    return reply.header("cache-control", "no-store").send({
      canDeleteNow: !Object.values(blockers).some((value) => value > 0),
      blockers,
    });
  });

  app.get("/v1/account/policy-acceptances", { preHandler: context.auth.requireUserWithoutPolicy }, async (request, reply) => {
    const result = await context.pool.query<{
      policy_key: "TERMS" | "PRIVACY";
      policy_version: string;
      content_sha256: string;
      public_url: string;
      accepted_at: Date | null;
    }>(
      `SELECT document.policy_key,document.policy_version,document.content_sha256,
              document.public_url,acceptance.accepted_at
         FROM legal_document_versions document
         LEFT JOIN LATERAL (
           SELECT event.accepted_at
             FROM user_policy_acceptance_events event
            WHERE event.user_id=$1
              AND event.policy_key=document.policy_key
              AND event.policy_version=document.policy_version
              AND event.content_sha256=document.content_sha256
            ORDER BY event.accepted_at DESC,event.id DESC
            LIMIT 1
         ) acceptance ON true
        WHERE document.policy_key=ANY($2::text[])
          AND document.superseded_at IS NULL
          AND document.effective_at<=now()
        ORDER BY document.policy_key`,
      [request.actor!.userId, ["TERMS", "PRIVACY"]],
    );
    return reply.header("cache-control", "no-store").send({
      documents: result.rows.map((row) => ({
        key: row.policy_key,
        version: row.policy_version,
        contentSha256: row.content_sha256,
        publicUrl: row.public_url,
        acceptedAt: nullableIso(row.accepted_at),
        accepted: row.accepted_at !== null,
      })),
    });
  });

  app.post("/v1/account/policy-acceptances", { preHandler: context.auth.requireUserWithoutPolicy }, async (request, reply) => {
    const input = objectInput(request.body);
    if (Object.keys(input).some((key) => key !== "acceptedPolicies")) {
      throw badRequest("지원하지 않는 약관 동의 값이 포함되어 있습니다.");
    }
    const policy = await loadRequiredPolicyDocuments(context.pool);
    requiredPolicyAcceptance(input, policy.versions);
    const rawUserAgent = request.headers["user-agent"];
    const requestUserAgent = (Array.isArray(rawUserAgent) ? rawUserAgent.join(" ") : rawUserAgent)
      ?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 500) || undefined;
    await withTransaction(context.pool, (client) => recordRequiredPolicyAcceptanceEvents(client, {
      userId: request.actor!.userId,
      documents: policy.documents,
      correlationId: request.id,
      source: "MOBILE_RECONSENT",
      ipAddress: request.ip,
      ...(requestUserAgent ? { userAgent: requestUserAgent } : {}),
    }));
    return reply.header("cache-control", "no-store").code(204).send();
  });

  app.get("/v1/account/deletion-request", {
    preHandler: context.auth.requireUserWithoutPolicy,
    config: { allowAccountDeletionScope: true },
  }, async (request, reply) => {
    const result = await context.pool.query<AccountDeletionRequestRow>(
      `SELECT id,status,blocker_snapshot,request_count,requested_at,last_requested_at,
              completed_at,auth_deletion_status
       FROM account_deletion_requests
       WHERE user_id=$1
       ORDER BY requested_at DESC,id DESC
       LIMIT 1`,
      [request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
    return reply.header("cache-control", "no-store").send(mapDeletionRequest(result.rows[0]!));
  });

  app.get(
    "/v1/account/deletion-requests/:requestId/status",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" }, allowAccountDeletionScope: true },
    },
    async (request, reply) => {
      const requestId = uuidInput((request.params as Record<string, unknown>).requestId, "requestId");
      const token = deletionStatusToken(request.headers);
      if (!token) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
      const result = await context.pool.query<AccountDeletionRequestRow>(
        `SELECT id,status,blocker_snapshot,request_count,requested_at,last_requested_at,
                completed_at,auth_deletion_status
           FROM account_deletion_requests
          WHERE id=$1 AND status_token_digest=$2
          LIMIT 1`,
        [requestId, deletionStatusTokenDigest(token)],
      );
      if (!result.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
      return reply.header("cache-control", "no-store").send(mapDeletionRequest(result.rows[0]!));
    },
  );

  app.post("/v1/account/deletion-request", {
    preHandler: context.auth.requireUserWithoutPolicy,
    config: { allowAccountDeletionScope: true },
  }, async (request, reply) => {
    const input = objectInput(request.body);
    assertOnlyKeys(input, []);
    const actorId = request.actor!.userId;
    const key = idempotencyKey(request.headers);
    const result = await withTransaction(context.pool, async (client) => {
      const started = await beginIdempotency(client, {
        actorId,
        scope: "ACCOUNT_DELETION_REQUEST",
        key,
        hash: requestHash({ operation: "REQUEST_ACCOUNT_DELETION" }),
      });

      if (!started.fresh) return { replay: true, statusCode: started.statusCode, body: started.body };

      const user = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='USER' FOR UPDATE",
        [actorId],
      );
      if (!user.rowCount) throw notFound("사용자 계정을 찾을 수 없습니다.");

      const blockers = await loadDeletionBlockers(client, actorId);
      const assessedStatus: AccountDeletionStatus = accountDeletionStatus(blockers);
      const receiptToken = randomBytes(32).toString("base64url");
      const receiptDigest = deletionStatusTokenDigest(receiptToken);
      const existing = await client.query<AccountDeletionRequestRow>(
        `SELECT id,status,blocker_snapshot,request_count,requested_at,last_requested_at,
                completed_at,auth_deletion_status
         FROM account_deletion_requests
         WHERE user_id=$1 AND status IN ('PENDING_REVIEW','BLOCKED','PROCESSING','APPROVED')
         ORDER BY requested_at DESC,id DESC
         LIMIT 1
         FOR UPDATE`,
        [actorId],
      );

      let deletionRequest: AccountDeletionRequestRow;
      let eventType: "CREATED" | "REASSESSED";
      if (existing.rowCount) {
        const current = existing.rows[0]!;
        if (current.status === "PROCESSING") {
          throw conflict("이미 탈퇴 처리가 진행 중입니다.", { requestId: current.id });
        }
        if (current.status === "APPROVED") {
          throw conflict("이미 접수된 탈퇴 요청이 처리 중입니다.", { requestId: current.id });
        }
        const updated = await client.query<AccountDeletionRequestRow>(
          `UPDATE account_deletion_requests
           SET status=$2,blocker_snapshot=$3,request_count=request_count+1,last_requested_at=now(),
               status_token_digest=$4,processing_started_at=CASE WHEN $2='PROCESSING' THEN now() ELSE NULL END,
               auth_deletion_status='NOT_REQUIRED'
           WHERE id=$1
           RETURNING id,status,blocker_snapshot,request_count,requested_at,last_requested_at,
                     completed_at,auth_deletion_status`,
          [current.id, assessedStatus, JSON.stringify(blockers), receiptDigest],
        );
        deletionRequest = updated.rows[0]!;
        eventType = "REASSESSED";
      } else {
        const created = await client.query<AccountDeletionRequestRow>(
          `INSERT INTO account_deletion_requests(
             user_id,status,blocker_snapshot,status_token_digest,processing_started_at
           ) VALUES($1,$2,$3,$4,CASE WHEN $2='PROCESSING' THEN now() ELSE NULL END)
           RETURNING id,status,blocker_snapshot,request_count,requested_at,last_requested_at,
                     completed_at,auth_deletion_status`,
          [actorId, assessedStatus, JSON.stringify(blockers), receiptDigest],
        );
        deletionRequest = created.rows[0]!;
        eventType = "CREATED";
      }

      let revokedSessionCount = 0;
      let supabaseAuthUserId: string | null = null;
      if (assessedStatus === "PROCESSING") {
        const brokerIdentities = await client.query<{ provider_subject: string }>(
          `SELECT DISTINCT provider_subject
             FROM auth_identities
            WHERE user_id=$1
              AND provider=ANY($2::text[])`,
          [actorId, [...CUSTOMER_SUBJECT_LOOKUP_PROVIDERS]],
        );
        supabaseAuthUserId = supabaseAuthUserIdForDeletion(
          brokerIdentities.rows.map((row) => row.provider_subject),
          context.config.supabaseUrl,
        );
        const revoked = await client.query(
          `UPDATE sessions SET revoked_at=now(),revoke_reason='ACCOUNT_DELETION_REQUESTED'
           WHERE user_id=$1 AND revoked_at IS NULL`,
          [actorId],
        );
        revokedSessionCount = revoked.rowCount || 0;
        await client.query(
          `UPDATE account_deletion_requests
              SET auth_deletion_status=$2
            WHERE id=$1`,
          [deletionRequest.id, supabaseAuthUserId ? "PENDING" : "NOT_REQUIRED"],
        );
        deletionRequest.auth_deletion_status = supabaseAuthUserId ? "PENDING" : "NOT_REQUIRED";
        await client.query(
          `INSERT INTO account_auth_deletion_jobs
            (deletion_request_id,user_id,supabase_user_id)
           VALUES($1,$2,$3)
           ON CONFLICT (deletion_request_id) DO NOTHING`,
          [deletionRequest.id, actorId, supabaseAuthUserId],
        );
      }
      await client.query(
        `INSERT INTO account_deletion_request_events
          (deletion_request_id,user_id,event_type,status,blocker_snapshot,revoked_session_count,
           correlation_id,idempotency_key,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          deletionRequest.id,
          actorId,
          eventType,
          deletionRequest.status,
          JSON.stringify(deletionRequest.blocker_snapshot),
          revokedSessionCount,
          request.id,
          key,
          JSON.stringify({
            hardDeletePerformed: false,
            policy: "AUTOMATED_SERVER_DELETION",
            processingQueued: assessedStatus === "PROCESSING",
          }),
        ],
      );

      const responseBody = { ...mapDeletionRequest(deletionRequest), statusToken: receiptToken };
      await completeIdempotency(client, started.id, {
        statusCode: 202,
        body: responseBody,
        resourceType: "ACCOUNT_DELETION_REQUEST",
        resourceId: deletionRequest.id,
      });
      return { replay: false, statusCode: 202, body: responseBody };
    });

    reply.header("cache-control", "no-store");
    return sendMutation(reply, result);
  });
}
