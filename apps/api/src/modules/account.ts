import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
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
import type { ApiContext } from "../types.js";

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

type OrderRow = {
  id: string;
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

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

const SHIPPING_REQUEST_STATUSES = ["REQUESTED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

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

type AccountDeletionStatus = "PENDING_REVIEW" | "BLOCKED" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";

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

export function accountDeletionStatus(blockers: AccountDeletionBlockers): "PENDING_REVIEW" | "BLOCKED" {
  return Object.values(blockers).some((value) => value > 0) ? "BLOCKED" : "PENDING_REVIEW";
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
    policy: "MANUAL_REVIEW_REQUIRED" as const,
    requestedAt: iso(row.requested_at),
    lastRequestedAt: iso(row.last_requested_at),
  };
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
         WHERE owner_id=$1 AND status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING')) AS active_inventory_count,
       (SELECT count(*) FROM shipping_requests
         WHERE user_id=$1 AND status IN ('REQUESTED','PROCESSING','SHIPPED')) AS active_shipping_request_count,
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

const mapPointEntry = (row: PointLedgerRow) => ({
  id: row.id,
  entryType: row.entry_type,
  amount: numberValue(row.amount),
  referenceType: row.reference_type,
  referenceId: row.reference_id,
  reason: row.reason,
  createdAt: iso(row.created_at),
});

const mapNotification = (row: NotificationRow) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  data: row.data,
  readAt: nullableIso(row.read_at),
  createdAt: iso(row.created_at),
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

export function canonicalShippingInventoryIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw badRequest("inventoryUnitIds는 1~20개여야 합니다.");
  }
  const ids = value.map((item) => uuidInput(item, "inventoryUnitId").toLowerCase());
  if (new Set(ids).size !== ids.length) throw badRequest("같은 보관 상품을 중복 선택할 수 없습니다.");
  return ids.sort((left, right) => left.localeCompare(right, "en-US"));
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

const shippingRequestSelect = `SELECT s.id,s.status,s.version,s.address_snapshot,s.requested_at,s.updated_at,
  s.shipped_at,s.tracking_carrier,s.tracking_number,s.requested_at AS created_at,
  ARRAY(SELECT i.inventory_unit_id FROM shipping_request_items i
    WHERE i.shipping_request_id=s.id ORDER BY i.inventory_unit_id) AS inventory_unit_ids
  FROM shipping_requests s`;

export async function registerAccountRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/account/profile", { preHandler: context.auth.requireUser }, async (request) => {
    return mapProfile(await loadProfile(context.pool, request.actor!.userId));
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
    const { limit, cursor } = pagination(queryOf(request));
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

  app.get("/v1/account/orders", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request));
    return withTransaction(context.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const values: unknown[] = [request.actor!.userId, limit + 1];
      const filters = ["user_id=$1"];
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        filters.push(`(created_at,id)<($${values.length - 1},$${values.length})`);
      }
      const orders = await client.query<OrderRow>(
        `SELECT id,status,currency,subtotal,discount_total,point_total,total,created_at,updated_at
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
    const { limit, cursor } = pagination(query);
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
    const { limit, cursor } = pagination(queryOf(request));
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

  app.get("/v1/account/notifications", { preHandler: context.auth.requireUser }, async (request) => {
    const { limit, cursor } = pagination(queryOf(request));
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

  app.get("/v1/account/shipping-requests", { preHandler: context.auth.requireUser }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query);
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
    return mapShippingRequest(result.rows[0]!);
  });

  app.post("/v1/account/shipping-requests", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const body = objectInput(request.body);
    assertOnlyKeys(body, ["inventoryUnitIds"]);
    const inventoryUnitIds = canonicalShippingInventoryIds(body.inventoryUnitIds);
    const actorId = request.actor!.userId;
    const result = await idempotentMutation(context, {
      actorId,
      scope: "ACCOUNT_SHIPPING_REQUEST_CREATE",
      key: idempotencyKey(request.headers),
      payload: { inventoryUnitIds },
      work: async (client) => {
        const address = await client.query<AddressRow>(
          "SELECT * FROM default_shipping_addresses WHERE user_id=$1 FOR SHARE",
          [actorId],
        );
        if (!address.rowCount) throw conflict("배송 신청 전에 기본 배송지를 등록해 주세요.");
        const lockedInventory = await client.query<{ id: string }>(
          `SELECT id FROM inventory_units
           WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED'
           ORDER BY id FOR UPDATE`,
          [inventoryUnitIds, actorId],
        );
        if (lockedInventory.rowCount !== inventoryUnitIds.length) {
          throw conflict("선택한 상품 중 배송 신청할 수 없는 항목이 있습니다.");
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
          `INSERT INTO shipping_requests(user_id,address_snapshot)
           VALUES($1,$2) RETURNING id,requested_at`,
          [actorId, JSON.stringify(addressSnapshot)],
        );
        const shippingRequestId = created.rows[0]!.id;
        await client.query(
          `INSERT INTO shipping_request_items(shipping_request_id,inventory_unit_id)
           SELECT $1,item_id FROM unnest($2::uuid[]) AS item_id`,
          [shippingRequestId, inventoryUnitIds],
        );
        const transitioned = await client.query<{ id: string }>(
          `UPDATE inventory_units SET status='SHIPPING'
           WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED' RETURNING id`,
          [inventoryUnitIds, actorId],
        );
        if (transitioned.rowCount !== inventoryUnitIds.length) {
          throw conflict("배송 상태를 변경하지 못했습니다.");
        }
        await writeOutbox(client, request.id, {
          aggregateType: "SHIPPING_REQUEST",
          aggregateId: shippingRequestId,
          eventType: "shipping.requested",
          payload: { shippingRequestId, userId: actorId, inventoryUnitIds },
        });
        const responseBody = {
          id: shippingRequestId,
          status: "REQUESTED" as const,
          inventoryUnitIds,
          destination: {
            recipientMasked: maskShippingRecipient(addressRow.recipient),
            phoneMasked: maskShippingPhone(addressRow.phone),
            postalCode: addressRow.postal_code,
            addressLine1: addressRow.address_line1,
            addressLine2: addressRow.address_line2,
          },
          requestedAt: iso(created.rows[0]!.requested_at),
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

  app.get("/v1/account/deletion-request", { preHandler: context.auth.requireUser }, async (request) => {
    const result = await context.pool.query<AccountDeletionRequestRow>(
      `SELECT id,status,blocker_snapshot,request_count,requested_at,last_requested_at
       FROM account_deletion_requests
       WHERE user_id=$1
       ORDER BY requested_at DESC,id DESC
       LIMIT 1`,
      [request.actor!.userId],
    );
    if (!result.rowCount) throw notFound("탈퇴 요청을 찾을 수 없습니다.");
    return mapDeletionRequest(result.rows[0]!);
  });

  app.post("/v1/account/deletion-request", { preHandler: context.auth.requireUser }, async (request, reply) => {
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

      if (!started.fresh) {
        await client.query(
          `UPDATE sessions SET revoked_at=now(),revoke_reason='ACCOUNT_DELETION_REQUESTED'
           WHERE user_id=$1 AND revoked_at IS NULL`,
          [actorId],
        );
        return { replay: true, statusCode: started.statusCode, body: started.body };
      }

      const user = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='USER' FOR UPDATE",
        [actorId],
      );
      if (!user.rowCount) throw notFound("사용자 계정을 찾을 수 없습니다.");

      const blockers = await loadDeletionBlockers(client, actorId);
      const assessedStatus = accountDeletionStatus(blockers);
      const existing = await client.query<AccountDeletionRequestRow>(
        `SELECT id,status,blocker_snapshot,request_count,requested_at,last_requested_at
         FROM account_deletion_requests
         WHERE user_id=$1 AND status IN ('PENDING_REVIEW','BLOCKED','APPROVED')
         ORDER BY requested_at DESC,id DESC
         LIMIT 1
         FOR UPDATE`,
        [actorId],
      );

      let deletionRequest: AccountDeletionRequestRow;
      let eventType: "CREATED" | "REASSESSED";
      if (existing.rowCount) {
        const current = existing.rows[0]!;
        if (current.status === "APPROVED") {
          throw conflict("이미 승인된 탈퇴 요청은 운영 정책에 따른 수동 완료를 기다리고 있습니다.");
        }
        const updated = await client.query<AccountDeletionRequestRow>(
          `UPDATE account_deletion_requests
           SET status=$2,blocker_snapshot=$3,request_count=request_count+1,last_requested_at=now()
           WHERE id=$1
           RETURNING id,status,blocker_snapshot,request_count,requested_at,last_requested_at`,
          [current.id, assessedStatus, JSON.stringify(blockers)],
        );
        deletionRequest = updated.rows[0]!;
        eventType = "REASSESSED";
      } else {
        const created = await client.query<AccountDeletionRequestRow>(
          `INSERT INTO account_deletion_requests(user_id,status,blocker_snapshot)
           VALUES($1,$2,$3)
           RETURNING id,status,blocker_snapshot,request_count,requested_at,last_requested_at`,
          [actorId, assessedStatus, JSON.stringify(blockers)],
        );
        deletionRequest = created.rows[0]!;
        eventType = "CREATED";
      }

      const revoked = await client.query(
        `UPDATE sessions SET revoked_at=now(),revoke_reason='ACCOUNT_DELETION_REQUESTED'
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [actorId],
      );
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
          revoked.rowCount || 0,
          request.id,
          key,
          JSON.stringify({ hardDeletePerformed: false, policy: "MANUAL_REVIEW_REQUIRED" }),
        ],
      );

      const responseBody = mapDeletionRequest(deletionRequest);
      await completeIdempotency(client, started.id, {
        statusCode: 202,
        body: responseBody,
        resourceType: "ACCOUNT_DELETION_REQUEST",
        resourceId: deletionRequest.id,
      });
      return { replay: false, statusCode: 202, body: responseBody };
    });

    return sendMutation(reply, result);
  });
}
