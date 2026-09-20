import type { DatabaseClient } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import { PRODUCT_CATEGORIES } from "@dabboba/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { requireLiveCommerce } from "../lib/commerce-mode.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import {
  beginIdempotency,
  completeIdempotency,
  idempotencyKey,
  requestHash,
} from "../lib/idempotency.js";
import { enumInput, objectInput, queryString, stringInput, uuidInput } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import { assertUgcOperationsPolicyAccepted } from "../lib/ugc-policy.js";
import type { Actor } from "../plugins/auth.js";
import type { ApiContext } from "../types.js";

type InventoryStatus =
  | "OWNED"
  | "EXCHANGE_LISTED"
  | "EXCHANGE_OFFERED"
  | "SHIPPING"
  | "DELIVERED"
  | "TRANSFERRED"
  | "REFUNDED"
  | "POINT_RETURNED"
  | "EXPIRED_HOLD";
type InventorySourceType = "PURCHASE" | "GACHA" | "KUJI" | "ADMIN_ADJUSTMENT";
type ListingStatus = "OPEN" | "MATCHED" | "COMPLETED" | "CANCELLED" | "HIDDEN";
type OfferStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
type CompletionMode = "MUTUAL_CONFIRMATION" | "ADMIN_OVERRIDE";

type InventoryRow = {
  id: string;
  owner_id: string;
  product_id: string;
  source_type: InventorySourceType;
  inventory_status: InventoryStatus;
  acquired_at: Date | string;
  storage_expires_at?: Date | string;
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
  product_created_at: Date | string;
  product_updated_at: Date | string;
  created_at: Date | string;
};

type ListingLifecycleRow = {
  id: string;
  author_id: string;
  offered_inventory_unit_id: string;
  offered_inventory_unit_ids: string[];
  status: ListingStatus;
  accepted_offer_id: string | null;
  matched_at: Date | null;
  author_confirmed_at: Date | null;
  proposer_confirmed_at: Date | null;
  completed_at: Date | null;
  completion_mode: CompletionMode | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  resolved_by_admin_id: string | null;
};

type LockedListingLifecycleRow = ListingLifecycleRow & {
  expires_at: Date | string;
  is_expired: boolean;
};

type ListingRow = InventoryRow & {
  listing_id: string;
  author_id: string;
  author_nickname: string;
  listing_title: string;
  listing_details: string;
  listing_status: ListingStatus;
  accepted_offer_id: string | null;
  matched_at: Date | null;
  author_confirmed_at: Date | null;
  proposer_confirmed_at: Date | null;
  completed_at: Date | null;
  completion_mode: CompletionMode | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  resolved_by_admin_id: string | null;
  offer_count: number | string;
  offered_inventories: InventoryRow[];
  listing_created_at: Date;
  listing_updated_at: Date;
  listing_expires_at: Date;
};

type OfferLifecycleRow = {
  id: string;
  listing_id: string;
  proposer_id: string;
  offered_inventory_unit_id: string;
  offered_inventory_unit_ids: string[];
  status: OfferStatus;
};

type OfferRow = InventoryRow & {
  offer_id: string;
  listing_id: string;
  proposer_id: string;
  proposer_nickname: string;
  offer_status: OfferStatus;
  offered_inventories: InventoryRow[];
  offer_created_at: Date;
  offer_updated_at: Date;
};

type InventoryLockRow = {
  id: string;
  owner_id: string;
  product_id: string;
  source_id: string | null;
  status: InventoryStatus;
  source_type: InventorySourceType;
  storage_expires_at: Date | string;
  storage_active: boolean;
  draw_owner_id: string | null;
  draw_entitlement_id: string | null;
  draw_prize_product_id: string | null;
};

type Queryable = Pick<DatabaseClient, "query">;

const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  OPEN: ["MATCHED", "CANCELLED", "HIDDEN"],
  MATCHED: ["COMPLETED", "CANCELLED", "HIDDEN"],
  COMPLETED: [],
  CANCELLED: [],
  HIDDEN: ["CANCELLED"],
};

const OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  PENDING: ["ACCEPTED", "REJECTED", "WITHDRAWN"],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export function isExchangeListingTransitionAllowed(from: ListingStatus, to: ListingStatus): boolean {
  return from === to || LISTING_TRANSITIONS[from].includes(to);
}

export function isExchangeOfferTransitionAllowed(from: OfferStatus, to: OfferStatus): boolean {
  return from === to || OFFER_TRANSITIONS[from].includes(to);
}

export function isDrawExchangeSource(sourceType: InventorySourceType): boolean {
  return sourceType === "GACHA";
}

export function isExchangeEligibleInventory(
  status: InventoryStatus,
  sourceType: InventorySourceType,
  isOriginalDrawOwner: boolean,
  isStorageActive: boolean,
): boolean {
  return status === "OWNED"
    && isDrawExchangeSource(sourceType)
    && isOriginalDrawOwner
    && isStorageActive;
}

export function orderedInventoryIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right, "en-US"));
}

export function exchangeInventoryBundleInput(input: Record<string, unknown>): string[] {
  const canonical = input.offeredInventoryUnitIds;
  const legacy = input.offeredInventoryUnitId;
  if (canonical === undefined) {
    return [uuidInput(legacy, "offeredInventoryUnitId")];
  }
  if (!Array.isArray(canonical) || canonical.length < 1 || canonical.length > 2) {
    throw badRequest("교환 상품은 1개 또는 2개를 선택해 주세요.");
  }
  const ids = canonical.map((value, index) => uuidInput(value, `offeredInventoryUnitIds[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw badRequest("같은 교환 상품을 중복해서 선택할 수 없습니다.");
  }
  if (legacy !== undefined && uuidInput(legacy, "offeredInventoryUnitId") !== ids[0]) {
    throw badRequest("기존 교환 상품 값은 첫 번째 교환 상품과 같아야 합니다.");
  }
  return ids;
}

const inventoryProjection = (inventoryAlias: string, productAlias: string, stockAlias: string) => `
  ${inventoryAlias}.id,${inventoryAlias}.owner_id,${inventoryAlias}.product_id,
  ${inventoryAlias}.source_type,${inventoryAlias}.status AS inventory_status,${inventoryAlias}.acquired_at,
  ${inventoryAlias}.storage_expires_at,
  ${productAlias}.sku,${productAlias}.ip_id,
  COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id)
    FROM product_characters pc WHERE pc.product_id=${productAlias}.id),'{}'::text[]) AS character_ids,
  ${productAlias}.category,${productAlias}.name AS product_name,${productAlias}.manufacturer,
  ${productAlias}.release_date,${productAlias}.price,
  COALESCE(${stockAlias}.on_hand-${stockAlias}.reserved,0) AS available_quantity,
  ${productAlias}.metadata,${productAlias}.image_url,${productAlias}.storefront_image_url,
  ${productAlias}.is_active AS product_active,
  ${productAlias}.is_prize_only,${productAlias}.version AS product_version,
  ${productAlias}.created_at AS product_created_at,${productAlias}.updated_at AS product_updated_at,
  ${inventoryAlias}.acquired_at AS created_at`;

const inventorySelect = inventoryProjection("iu", "p", "s");

const listingInventoryBundleSelect = `(SELECT COALESCE(
    jsonb_agg(to_jsonb(bundle_inventory)-'position' ORDER BY bundle_inventory.position),
    '[]'::jsonb
  )
  FROM (
    SELECT listing_item.position,${inventoryProjection("bundle_iu", "bundle_product", "bundle_stock")}
    FROM exchange_listing_items listing_item
    JOIN inventory_units bundle_iu ON bundle_iu.id=listing_item.inventory_unit_id
    JOIN catalog_products bundle_product ON bundle_product.id=bundle_iu.product_id
    LEFT JOIN product_stock bundle_stock ON bundle_stock.product_id=bundle_product.id
    WHERE listing_item.listing_id=l.id
    ORDER BY listing_item.position
  ) bundle_inventory) AS offered_inventories`;

const offerInventoryBundleSelect = `(SELECT COALESCE(
    jsonb_agg(to_jsonb(bundle_inventory)-'position' ORDER BY bundle_inventory.position),
    '[]'::jsonb
  )
  FROM (
    SELECT offer_item.position,${inventoryProjection("bundle_iu", "bundle_product", "bundle_stock")}
    FROM exchange_offer_items offer_item
    JOIN inventory_units bundle_iu ON bundle_iu.id=offer_item.inventory_unit_id
    JOIN catalog_products bundle_product ON bundle_product.id=bundle_iu.product_id
    LEFT JOIN product_stock bundle_stock ON bundle_stock.product_id=bundle_product.id
    WHERE offer_item.offer_id=o.id
    ORDER BY offer_item.position
  ) bundle_inventory) AS offered_inventories`;

const listingBundleIsPubliclyEligible = `EXISTS (
    SELECT 1 FROM exchange_listing_items visible_listing_item
    WHERE visible_listing_item.listing_id=l.id
  ) AND NOT EXISTS (
    SELECT 1
    FROM exchange_listing_items invalid_listing_item
    JOIN inventory_units invalid_listing_inventory
      ON invalid_listing_inventory.id=invalid_listing_item.inventory_unit_id
    JOIN catalog_products invalid_listing_product
      ON invalid_listing_product.id=invalid_listing_inventory.product_id
    JOIN catalog_ips invalid_listing_ip ON invalid_listing_ip.id=invalid_listing_product.ip_id
    WHERE invalid_listing_item.listing_id=l.id
      AND (
        invalid_listing_inventory.source_type<>'GACHA'
        OR invalid_listing_product.is_active=false
        OR invalid_listing_ip.is_active=false
        OR NOT EXISTS (
          SELECT 1 FROM draw_results listing_draw_result
          WHERE listing_draw_result.prize_inventory_unit_id=invalid_listing_inventory.id
            AND listing_draw_result.user_id=l.author_id
            AND listing_draw_result.entitlement_id=invalid_listing_inventory.source_id
            AND listing_draw_result.prize_product_id=invalid_listing_inventory.product_id
        )
      )
  )`;

const offerBundleIsVisible = `EXISTS (
    SELECT 1 FROM exchange_offer_items visible_offer_item
    WHERE visible_offer_item.offer_id=o.id
  ) AND NOT EXISTS (
    SELECT 1
    FROM exchange_offer_items invalid_offer_item
    JOIN inventory_units invalid_offer_inventory
      ON invalid_offer_inventory.id=invalid_offer_item.inventory_unit_id
    WHERE invalid_offer_item.offer_id=o.id
      AND (
        invalid_offer_inventory.source_type<>'GACHA'
        OR NOT EXISTS (
          SELECT 1 FROM draw_results offer_draw_result
          WHERE offer_draw_result.prize_inventory_unit_id=invalid_offer_inventory.id
            AND offer_draw_result.user_id=o.proposer_id
            AND offer_draw_result.entitlement_id=invalid_offer_inventory.source_id
            AND offer_draw_result.prize_product_id=invalid_offer_inventory.product_id
        )
      )
  )`;

const listingSelect = `SELECT
  l.id AS listing_id,l.author_id,u.nickname AS author_nickname,l.title AS listing_title,l.details AS listing_details,
  l.status AS listing_status,l.accepted_offer_id,l.matched_at,l.author_confirmed_at,l.proposer_confirmed_at,
  l.completed_at,l.completion_mode,l.cancelled_at,l.cancelled_by,l.cancel_reason,l.resolved_by_admin_id,
  l.created_at AS listing_created_at,l.updated_at AS listing_updated_at,l.expires_at AS listing_expires_at,
  (SELECT count(*)
   FROM exchange_offers o
   WHERE o.listing_id=l.id AND o.status<>'WITHDRAWN'
     AND EXISTS (SELECT 1 FROM exchange_offer_items counted_item WHERE counted_item.offer_id=o.id)
     AND NOT EXISTS (
       SELECT 1
       FROM exchange_offer_items counted_item
       JOIN inventory_units offer_inventory ON offer_inventory.id=counted_item.inventory_unit_id
       WHERE counted_item.offer_id=o.id
         AND (offer_inventory.source_type<>'GACHA' OR NOT EXISTS (
           SELECT 1 FROM draw_results offer_draw_result
           WHERE offer_draw_result.prize_inventory_unit_id=offer_inventory.id
             AND offer_draw_result.user_id=o.proposer_id
             AND offer_draw_result.entitlement_id=offer_inventory.source_id
             AND offer_draw_result.prize_product_id=offer_inventory.product_id
         ))
     )) AS offer_count,
  ${listingInventoryBundleSelect},
  ${inventorySelect}
  FROM exchange_listings l JOIN users u ON u.id=l.author_id
  JOIN exchange_listing_items primary_listing_item ON primary_listing_item.listing_id=l.id
    AND primary_listing_item.position=0
  JOIN inventory_units iu ON iu.id=primary_listing_item.inventory_unit_id
  JOIN catalog_products p ON p.id=iu.product_id
  JOIN catalog_ips i ON i.id=p.ip_id
  LEFT JOIN product_stock s ON s.product_id=p.id`;

const offerSelect = `SELECT
  o.id AS offer_id,o.listing_id,o.proposer_id,proposer.nickname AS proposer_nickname,o.status AS offer_status,
  o.created_at AS offer_created_at,o.updated_at AS offer_updated_at,${offerInventoryBundleSelect},${inventorySelect}
  FROM exchange_offers o JOIN users proposer ON proposer.id=o.proposer_id
  JOIN exchange_offer_items primary_offer_item ON primary_offer_item.offer_id=o.id
    AND primary_offer_item.position=0
  JOIN inventory_units iu ON iu.id=primary_offer_item.inventory_unit_id
  JOIN catalog_products p ON p.id=iu.product_id LEFT JOIN product_stock s ON s.product_id=p.id`;

const mapProduct = (row: InventoryRow) => ({
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
});

const mapInventory = (row: InventoryRow) => ({
  id: row.id,
  ownerId: row.owner_id,
  productId: row.product_id,
  product: mapProduct(row),
  sourceType: row.source_type,
  status: row.inventory_status,
  acquiredAt: iso(row.acquired_at),
  ...(row.storage_expires_at ? { storageExpiresAt: iso(row.storage_expires_at) } : {}),
});

const mapListing = (row: ListingRow) => {
  const offeredInventories = row.offered_inventories.map(mapInventory);
  return {
  id: row.listing_id,
  authorId: row.author_id,
  authorNickname: row.author_nickname,
  title: row.listing_title,
  details: row.listing_details,
  status: row.listing_status,
  offeredInventory: offeredInventories[0]!,
  offeredInventories,
  offerCount: numberValue(row.offer_count),
  acceptedOfferId: row.accepted_offer_id,
  matchedAt: nullableIso(row.matched_at),
  authorConfirmedAt: nullableIso(row.author_confirmed_at),
  proposerConfirmedAt: nullableIso(row.proposer_confirmed_at),
  completedAt: nullableIso(row.completed_at),
  completionMode: row.completion_mode,
  cancelledAt: nullableIso(row.cancelled_at),
  cancelledBy: row.cancelled_by,
  cancelReason: row.cancel_reason,
  resolvedByAdminId: row.resolved_by_admin_id,
  expiresAt: iso(row.listing_expires_at),
  createdAt: iso(row.listing_created_at),
  updatedAt: iso(row.listing_updated_at),
  };
};

const mapOffer = (row: OfferRow) => {
  const offeredInventories = row.offered_inventories.map(mapInventory);
  return {
  id: row.offer_id,
  listingId: row.listing_id,
  proposerId: row.proposer_id,
  proposerNickname: row.proposer_nickname,
  offeredInventory: offeredInventories[0]!,
  offeredInventories,
  status: row.offer_status,
  createdAt: iso(row.offer_created_at),
  updatedAt: iso(row.offer_updated_at),
  };
};

const listingPage = (rows: ListingRow[], limit: number) => cursorPage(
  rows.map((row) => ({ id: row.listing_id, created_at: row.listing_created_at, listing: row })),
  limit,
  ({ listing }) => mapListing(listing),
);

function queryOf(request: FastifyRequest) {
  return (request.query || {}) as Record<string, unknown>;
}

function exchangeBlockVisibility(viewerParameter: string, authorExpression: string) {
  return `(${viewerParameter}::uuid IS NULL OR NOT EXISTS(
    SELECT 1 FROM user_blocks visibility_block
    WHERE (visibility_block.blocker_id=${viewerParameter} AND visibility_block.blocked_id=${authorExpression})
       OR (visibility_block.blocker_id=${authorExpression} AND visibility_block.blocked_id=${viewerParameter})
  ))`;
}

async function optionalUserActor(context: ApiContext, request: FastifyRequest): Promise<Actor | null> {
  if (!request.headers?.authorization) return null;
  try {
    const actor = await context.auth.loadActor(request);
    return actor.sessionKind === "USER" && actor.role === "USER" ? actor : null;
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) return null;
    throw error;
  }
}

async function fetchListing(queryable: Queryable, listingId: string) {
  const result = await queryable.query<ListingRow>(`${listingSelect} WHERE l.id=$1`, [listingId]);
  if (!result.rowCount) throw notFound();
  return mapListing(result.rows[0]!);
}

async function fetchOffer(queryable: Queryable, offerId: string) {
  const result = await queryable.query<OfferRow>(`${offerSelect} WHERE o.id=$1`, [offerId]);
  if (!result.rowCount) throw notFound();
  return mapOffer(result.rows[0]!);
}

async function lockListing(client: DatabaseClient, listingId: string) {
  const result = await client.query<LockedListingLifecycleRow>(
    `SELECT id,author_id,offered_inventory_unit_id,
      ARRAY(SELECT item.inventory_unit_id FROM exchange_listing_items item
        WHERE item.listing_id=exchange_listings.id ORDER BY item.position) AS offered_inventory_unit_ids,
      status,accepted_offer_id,matched_at,
      author_confirmed_at,proposer_confirmed_at,completed_at,completion_mode,cancelled_at,
      cancelled_by,cancel_reason,resolved_by_admin_id,
      expires_at,expires_at<=now() AS is_expired
     FROM exchange_listings WHERE id=$1 FOR UPDATE`,
    [listingId],
  );
  if (!result.rowCount) throw notFound();
  return result.rows[0]!;
}

async function lockOffers(client: DatabaseClient, listingId: string) {
  const result = await client.query<OfferLifecycleRow>(
    `SELECT id,listing_id,proposer_id,offered_inventory_unit_id,
      ARRAY(SELECT item.inventory_unit_id FROM exchange_offer_items item
        WHERE item.offer_id=exchange_offers.id ORDER BY item.position) AS offered_inventory_unit_ids,
      status
     FROM exchange_offers WHERE listing_id=$1 ORDER BY id FOR UPDATE`,
    [listingId],
  );
  return result.rows;
}

async function lockInventoryUnits(client: DatabaseClient, inventoryIds: readonly string[]) {
  const ids = orderedInventoryIds(inventoryIds);
  if (!ids.length) return new Map<string, InventoryLockRow>();
  const result = await client.query<InventoryLockRow>(
    `SELECT iu.id,iu.owner_id,iu.product_id,iu.source_id,iu.status,iu.source_type,
       iu.storage_expires_at,iu.storage_expires_at>now() AS storage_active,
       draw_result.user_id AS draw_owner_id,
       draw_result.entitlement_id AS draw_entitlement_id,
       draw_result.prize_product_id AS draw_prize_product_id
     FROM inventory_units iu
     LEFT JOIN draw_results draw_result ON draw_result.prize_inventory_unit_id=iu.id
     WHERE iu.id=ANY($1::uuid[]) ORDER BY iu.id FOR UPDATE OF iu`,
    [ids],
  );
  if (result.rows.length !== ids.length) throw notFound("교환 상품을 찾을 수 없습니다.");
  return new Map(result.rows.map((row) => [row.id, row]));
}

export function isOriginalGachaDrawProvenance(input: {
  sourceType: InventorySourceType;
  inventorySourceId: string | null;
  inventoryProductId: string;
  drawOwnerId: string | null;
  drawEntitlementId: string | null;
  drawPrizeProductId: string | null;
  expectedOwnerId: string;
}): boolean {
  return isDrawExchangeSource(input.sourceType)
    && input.drawOwnerId === input.expectedOwnerId
    && input.inventorySourceId !== null
    && input.drawEntitlementId === input.inventorySourceId
    && input.drawPrizeProductId === input.inventoryProductId;
}

function hasOriginalGachaDrawProvenance(inventory: InventoryLockRow, ownerId: string): boolean {
  return isOriginalGachaDrawProvenance({
    sourceType: inventory.source_type,
    inventorySourceId: inventory.source_id,
    inventoryProductId: inventory.product_id,
    drawOwnerId: inventory.draw_owner_id,
    drawEntitlementId: inventory.draw_entitlement_id,
    drawPrizeProductId: inventory.draw_prize_product_id,
    expectedOwnerId: ownerId,
  });
}

function requireInventoryState(
  locked: Map<string, InventoryLockRow>,
  inventoryId: string,
  ownerId: string,
  status: InventoryStatus,
) {
  const inventory = locked.get(inventoryId);
  if (!inventory) throw notFound("교환 상품을 찾을 수 없습니다.");
  if (inventory.owner_id !== ownerId || inventory.status !== status) {
    throw conflict("교환 상품의 소유권 또는 예약 상태가 변경되었습니다.");
  }
}

function requireInventoryBundle(
  locked: Map<string, InventoryLockRow>,
  inventoryIds: readonly string[],
  ownerId: string,
  status: InventoryStatus,
) {
  if (inventoryIds.length < 1 || inventoryIds.length > 2 || new Set(inventoryIds).size !== inventoryIds.length) {
    throw conflict("교환 상품 묶음 구성이 올바르지 않습니다.");
  }
  for (const inventoryId of inventoryIds) {
    requireInventoryState(locked, inventoryId, ownerId, status);
  }
}

function requireExchangeEligibleInventory(
  locked: Map<string, InventoryLockRow>,
  inventoryId: string,
  ownerId: string,
) {
  const inventory = locked.get(inventoryId);
  if (!inventory) throw notFound("교환 상품을 찾을 수 없습니다.");
  if (inventory.owner_id !== ownerId) {
    throw conflict("교환 상품의 소유권 또는 예약 상태가 변경되었습니다.");
  }
  if (!inventory.storage_active) {
    throw conflict("보관 기간이 만료된 상품은 교환에 사용할 수 없습니다.");
  }
  if (!isExchangeEligibleInventory(
    inventory.status,
    inventory.source_type,
    hasOriginalGachaDrawProvenance(inventory, ownerId),
    inventory.storage_active,
  )) {
    throw conflict("가챠로 직접 뽑아 보관함에 보관 중인 상품만 교환에 사용할 수 있습니다.");
  }
}

function requireOriginalGachaDrawInventory(
  locked: Map<string, InventoryLockRow>,
  inventoryId: string,
  ownerId: string,
) {
  const inventory = locked.get(inventoryId);
  if (!inventory) throw notFound("교환 상품을 찾을 수 없습니다.");
  if (!hasOriginalGachaDrawProvenance(inventory, ownerId)) {
    throw conflict("가챠로 직접 뽑아 보관함에 보관 중인 상품만 교환에 사용할 수 있습니다.");
  }
}

function requireOriginalGachaDrawBundle(
  locked: Map<string, InventoryLockRow>,
  inventoryIds: readonly string[],
  ownerId: string,
) {
  for (const inventoryId of inventoryIds) {
    requireOriginalGachaDrawInventory(locked, inventoryId, ownerId);
  }
}

function requireActiveStorageBundle(
  locked: Map<string, InventoryLockRow>,
  inventoryIds: readonly string[],
) {
  for (const inventoryId of inventoryIds) {
    const inventory = locked.get(inventoryId);
    if (!inventory) throw notFound("교환 상품을 찾을 수 없습니다.");
    if (!inventory.storage_active) {
      throw conflict("보관 기간이 만료된 상품은 교환에 사용할 수 없습니다.");
    }
  }
}

function requireExchangeEligibleBundle(
  locked: Map<string, InventoryLockRow>,
  inventoryIds: readonly string[],
  ownerId: string,
) {
  if (inventoryIds.length < 1 || inventoryIds.length > 2 || new Set(inventoryIds).size !== inventoryIds.length) {
    throw badRequest("교환 상품은 중복 없이 1개 또는 2개를 선택해 주세요.");
  }
  for (const inventoryId of inventoryIds) {
    requireExchangeEligibleInventory(locked, inventoryId, ownerId);
  }
}

async function reserveInventoryUnits(
  client: DatabaseClient,
  inventoryIds: readonly string[],
  ownerId: string,
  reservedStatus: "EXCHANGE_LISTED" | "EXCHANGE_OFFERED",
) {
  const ids = orderedInventoryIds(inventoryIds);
  const reserved = await client.query(
    `UPDATE inventory_units SET status=$3
     WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status='OWNED'
       AND storage_expires_at>now()
     RETURNING id`,
    [ids, ownerId, reservedStatus],
  );
  if (reserved.rowCount !== ids.length) {
    throw conflict("이미 다른 처리에 사용 중이거나 보관 기간이 만료된 상품입니다.");
  }
}

async function releaseInventoryUnits(
  client: DatabaseClient,
  inventoryIds: readonly string[],
  expectedStatus: "EXCHANGE_LISTED" | "EXCHANGE_OFFERED",
) {
  const ids = orderedInventoryIds(inventoryIds);
  if (!ids.length) return;
  const released = await client.query(
    "UPDATE inventory_units SET status='OWNED' WHERE id=ANY($1::uuid[]) AND status=$2 RETURNING id",
    [ids, expectedStatus],
  );
  if (released.rowCount !== ids.length) throw conflict("교환 상품 예약 상태가 변경되었습니다.");
}

type MutationResult<T> = { statusCode: number; body: T; resourceId: string };

async function runIdempotentMutation<T>(
  context: ApiContext,
  request: FastifyRequest,
  input: {
    scope: string;
    hashInput: unknown;
    resourceType: string;
    key?: string;
  },
  work: (client: DatabaseClient) => Promise<MutationResult<T>>,
): Promise<{ statusCode: number; body: T }> {
  const key = input.key ?? idempotencyKey(request.headers);
  return withTransaction(context.pool, async (client) => {
    const started = await beginIdempotency(client, {
      actorId: request.actor!.userId,
      scope: input.scope,
      key,
      hash: requestHash(input.hashInput),
    });
    if (!started.fresh) return { statusCode: started.statusCode, body: started.body as T };
    const result = await work(client);
    await completeIdempotency(client, started.id, {
      statusCode: result.statusCode,
      body: result.body,
      resourceType: input.resourceType,
      resourceId: result.resourceId,
    });
    return { statusCode: result.statusCode, body: result.body };
  });
}

async function finalizeOwnershipExchange(
  client: DatabaseClient,
  listing: ListingLifecycleRow,
  offer: OfferLifecycleRow,
  mode: CompletionMode,
  adminId: string | null,
) {
  const listingInventoryIds = listing.offered_inventory_unit_ids;
  const offerInventoryIds = offer.offered_inventory_unit_ids;
  const allInventoryIds = [...listingInventoryIds, ...offerInventoryIds];
  if (new Set(allInventoryIds).size !== allInventoryIds.length) {
    throw conflict("같은 보관 상품은 양쪽 교환 묶음에 함께 포함될 수 없습니다.");
  }
  const locked = await lockInventoryUnits(client, allInventoryIds);
  requireInventoryBundle(locked, listingInventoryIds, listing.author_id, "EXCHANGE_LISTED");
  requireInventoryBundle(locked, offerInventoryIds, offer.proposer_id, "EXCHANGE_OFFERED");
  requireOriginalGachaDrawBundle(locked, listingInventoryIds, listing.author_id);
  requireOriginalGachaDrawBundle(locked, offerInventoryIds, offer.proposer_id);

  const transferred = await client.query(
    `UPDATE inventory_units
     SET owner_id=CASE
       WHEN id=ANY($1::uuid[]) THEN $4::uuid
       WHEN id=ANY($2::uuid[]) THEN $3::uuid
       ELSE owner_id
     END,status='OWNED',
       storage_expires_at=GREATEST(storage_expires_at,now()+interval '14 days')
     WHERE (id=ANY($1::uuid[]) AND owner_id=$3 AND status='EXCHANGE_LISTED')
        OR (id=ANY($2::uuid[]) AND owner_id=$4 AND status='EXCHANGE_OFFERED')
     RETURNING id`,
    [
      listingInventoryIds,
      offerInventoryIds,
      listing.author_id,
      offer.proposer_id,
    ],
  );
  if (transferred.rowCount !== allInventoryIds.length) throw conflict("교환 상품 소유권이 변경되었습니다.");

  await client.query(
    `INSERT INTO inventory_ownership_transfers
      (exchange_listing_id,inventory_unit_id,from_owner_id,to_owner_id,transferred_by_admin_id)
     SELECT $1::uuid,item.inventory_unit_id,$2::uuid,$3::uuid,$4::uuid
       FROM unnest($5::uuid[]) AS item(inventory_unit_id)
     UNION ALL
     SELECT $1::uuid,item.inventory_unit_id,$3::uuid,$2::uuid,$4::uuid
       FROM unnest($6::uuid[]) AS item(inventory_unit_id)`,
    [
      listing.id,
      listing.author_id,
      offer.proposer_id,
      adminId,
      listingInventoryIds,
      offerInventoryIds,
    ],
  );

  const completed = await client.query(
    `UPDATE exchange_listings
     SET status='COMPLETED',completed_at=now(),completion_mode=$2,resolved_by_admin_id=$3
     WHERE id=$1 AND status='MATCHED' RETURNING id`,
    [listing.id, mode, adminId],
  );
  if (!completed.rowCount) throw conflict("이미 완료되었거나 취소된 교환입니다.");
}

export async function expireStaleExchangeListings(queryable: Queryable): Promise<number> {
  const expired = await queryable.query<{ id: string }>(
    `WITH expired_listings AS (
       UPDATE exchange_listings listing
          SET status='CANCELLED',cancelled_at=now(),cancelled_by=author_id,
              cancel_reason='AUTO_EXPIRED'
        WHERE listing.status='OPEN'
          AND (
            listing.expires_at<=now()
            OR EXISTS (
              SELECT 1
                FROM exchange_listing_items item
                JOIN inventory_units inventory ON inventory.id=item.inventory_unit_id
               WHERE item.listing_id=listing.id
                 AND inventory.storage_expires_at<=now()
            )
          )
        RETURNING listing.id
     ), rejected_offers AS (
       UPDATE exchange_offers offer
          SET status='REJECTED',decided_at=now()
        WHERE offer.status='PENDING'
          AND offer.listing_id IN (SELECT id FROM expired_listings)
        RETURNING offer.id
     ), released_listing_items AS (
       UPDATE inventory_units inventory
          SET status='OWNED'
        WHERE inventory.status='EXCHANGE_LISTED'
          AND inventory.id IN (
            SELECT item.inventory_unit_id
              FROM exchange_listing_items item
             WHERE item.listing_id IN (SELECT id FROM expired_listings)
          )
        RETURNING inventory.id
     ), released_offer_items AS (
       UPDATE inventory_units inventory
          SET status='OWNED'
        WHERE inventory.status='EXCHANGE_OFFERED'
          AND inventory.id IN (
            SELECT item.inventory_unit_id
              FROM exchange_offer_items item
             WHERE item.offer_id IN (SELECT id FROM rejected_offers)
          )
        RETURNING inventory.id
     )
     SELECT id FROM expired_listings`,
  );
  return expired.rowCount ?? expired.rows.length;
}

async function cancelMatchedExchange(
  client: DatabaseClient,
  listing: ListingLifecycleRow,
  offer: OfferLifecycleRow,
  adminId: string,
  reason: string,
) {
  const locked = await lockInventoryUnits(client, [
    ...listing.offered_inventory_unit_ids,
    ...offer.offered_inventory_unit_ids,
  ]);
  requireInventoryBundle(
    locked,
    listing.offered_inventory_unit_ids,
    listing.author_id,
    "EXCHANGE_LISTED",
  );
  requireInventoryBundle(
    locked,
    offer.offered_inventory_unit_ids,
    offer.proposer_id,
    "EXCHANGE_OFFERED",
  );
  await releaseInventoryUnits(client, listing.offered_inventory_unit_ids, "EXCHANGE_LISTED");
  await releaseInventoryUnits(client, offer.offered_inventory_unit_ids, "EXCHANGE_OFFERED");
  const cancelled = await client.query(
    `UPDATE exchange_listings
     SET status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancel_reason=$3,resolved_by_admin_id=$2
     WHERE id=$1 AND status='MATCHED' RETURNING id`,
    [listing.id, adminId, reason],
  );
  if (!cancelled.rowCount) throw conflict("이미 완료되었거나 취소된 교환입니다.");
}

export async function registerExchangeRoutes(app: FastifyInstance, context: ApiContext) {
  app.get(
    "/v1/exchange/inventory",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request) => {
      await expireStaleExchangeListings(context.pool);
      const query = queryOf(request);
      const { limit, cursor } = pagination(query);
      const search = queryString(query.q);
      const values: unknown[] = [request.actor!.userId, limit + 1];
      const filters = [
        "iu.owner_id=$1",
        "iu.status='OWNED'",
        "iu.source_type='GACHA'",
        "iu.storage_expires_at>now()",
        `EXISTS (
          SELECT 1 FROM draw_results draw_result
          WHERE draw_result.prize_inventory_unit_id=iu.id
            AND draw_result.user_id=iu.owner_id
            AND draw_result.entitlement_id=iu.source_id
            AND draw_result.prize_product_id=iu.product_id
        )`,
        "p.is_active=true",
      ];
      if (search) {
        values.push(`%${search}%`);
        filters.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length})`);
      }
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        filters.push(`(iu.acquired_at,iu.id)<($${values.length - 1},$${values.length})`);
      }
      const result = await context.pool.query<InventoryRow>(
        `SELECT ${inventorySelect} FROM inventory_units iu
         JOIN catalog_products p ON p.id=iu.product_id
         LEFT JOIN product_stock s ON s.product_id=p.id
         WHERE ${filters.join(" AND ")}
         ORDER BY iu.acquired_at DESC,iu.id DESC LIMIT $2`,
        values,
      );
      return cursorPage(result.rows, limit, mapInventory);
    },
  );

  app.get("/v1/exchange/listings", { preHandler: requireLiveCommerce(context) }, async (request) => {
    await expireStaleExchangeListings(context.pool);
    const viewerId = (await optionalUserActor(context, request))?.userId ?? null;
    const query = queryOf(request);
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const category = query.category === undefined
      ? undefined
      : enumInput(query, "category", PRODUCT_CATEGORIES);
    const values: unknown[] = [viewerId, limit + 1];
    const filters = [
      "l.status='OPEN'",
      listingBundleIsPubliclyEligible,
      exchangeBlockVisibility("$1", "l.author_id"),
    ];
    if (search) {
      values.push(`%${search}%`);
      filters.push(
        `(l.title ILIKE $${values.length} OR l.details ILIKE $${values.length}
          OR EXISTS (
            SELECT 1
            FROM exchange_listing_items search_listing_item
            JOIN inventory_units search_inventory ON search_inventory.id=search_listing_item.inventory_unit_id
            JOIN catalog_products search_product ON search_product.id=search_inventory.product_id
            JOIN catalog_ips search_ip ON search_ip.id=search_product.ip_id
            WHERE search_listing_item.listing_id=l.id
              AND (search_product.name ILIKE $${values.length}
                OR search_ip.name_ko ILIKE $${values.length}
                OR search_ip.name_en ILIKE $${values.length}
                OR search_ip.name_ja ILIKE $${values.length}
                OR array_to_string(search_ip.aliases, ' ') ILIKE $${values.length})
          ))`,
      );
    }
    if (category) {
      values.push(category);
      filters.push(`EXISTS (
        SELECT 1
        FROM exchange_listing_items category_listing_item
        JOIN inventory_units category_inventory ON category_inventory.id=category_listing_item.inventory_unit_id
        JOIN catalog_products category_product ON category_product.id=category_inventory.product_id
        WHERE category_listing_item.listing_id=l.id AND category_product.category=$${values.length}
      )`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(l.created_at,l.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<ListingRow>(
      `${listingSelect} WHERE ${filters.join(" AND ")} ORDER BY l.created_at DESC,l.id DESC LIMIT $2`,
      values,
    );
    return listingPage(result.rows, limit);
  });

  app.get(
    "/v1/exchange/activity",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request) => {
      await expireStaleExchangeListings(context.pool);
      const actorId = request.actor!.userId;
      const [authored, applied] = await Promise.all([
        context.pool.query<ListingRow>(
          `${listingSelect} WHERE l.author_id=$1 AND l.status<>'HIDDEN'
           AND ${listingBundleIsPubliclyEligible}
           ORDER BY l.updated_at DESC,l.id DESC LIMIT 100`,
          [actorId],
        ),
        context.pool.query<ListingRow>(
          `${listingSelect} WHERE l.status<>'HIDDEN'
           AND ${listingBundleIsPubliclyEligible}
           AND EXISTS (
             SELECT 1 FROM exchange_offers my_offer
              WHERE my_offer.listing_id=l.id AND my_offer.proposer_id=$1
           )
           ORDER BY l.updated_at DESC,l.id DESC LIMIT 100`,
          [actorId],
        ),
      ]);
      return {
        authored: authored.rows.map(mapListing),
        applied: applied.rows.map(mapListing),
      };
    },
  );

  app.get("/v1/exchange/listings/:listingId", { preHandler: requireLiveCommerce(context) }, async (request) => {
    await expireStaleExchangeListings(context.pool);
    const listingId = uuidInput((request.params as Record<string, unknown>).listingId, "listingId");
    const actor = await optionalUserActor(context, request);
    const result = await context.pool.query<ListingRow>(
      `${listingSelect} WHERE l.id=$2 AND l.status<>'HIDDEN'
       AND ${listingBundleIsPubliclyEligible}
       AND ${exchangeBlockVisibility("$1", "l.author_id")}`,
      [actor?.userId ?? null, listingId],
    );
    if (!result.rowCount) throw notFound();
    const listing = mapListing(result.rows[0]!);
    if (!actor) return listing;
    const authorOwnsListing = actor.userId === result.rows[0]!.author_id;
    const offerRows = await context.pool.query<OfferRow>(
      `${offerSelect} WHERE o.listing_id=$1 ${authorOwnsListing ? "" : "AND o.proposer_id=$2"}
       AND ${exchangeBlockVisibility("$2", "o.proposer_id")}
       AND ${offerBundleIsVisible}
       ORDER BY o.created_at DESC,o.id DESC`,
      [listingId, actor.userId],
    );
    return { ...listing, offers: offerRows.rows.map(mapOffer) };
  });

  app.post(
    "/v1/exchange/listings",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      const body = objectInput(request.body);
      const title = stringInput(body, "title", { max: 160 })!;
      const details = stringInput(body, "details", { max: 5000 })!;
      const inventoryIds = exchangeInventoryBundleInput(body);
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.listing.create",
          hashInput: { title, details, inventoryIds },
          resourceType: "EXCHANGE_LISTING",
        },
        async (client) => {
          await assertUgcOperationsPolicyAccepted(client, request.actor!.userId);
          const locked = await lockInventoryUnits(client, inventoryIds);
          requireExchangeEligibleBundle(locked, inventoryIds, request.actor!.userId);
          const created = await client.query<{ id: string }>(
            `INSERT INTO exchange_listings(author_id,offered_inventory_unit_id,title,details)
             VALUES($1,$2,$3,$4) RETURNING id`,
            [request.actor!.userId, inventoryIds[0], title, details],
          );
          const listingId = created.rows[0]!.id;
          if (inventoryIds.length === 2) {
            await client.query(
              `INSERT INTO exchange_listing_items(listing_id,inventory_unit_id,position)
               VALUES($1,$2,1)`,
              [listingId, inventoryIds[1]],
            );
          }
          await reserveInventoryUnits(client, inventoryIds, request.actor!.userId, "EXCHANGE_LISTED");
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: "exchange.listing.created",
            payload: {
              listingId,
              authorId: request.actor!.userId,
              inventoryUnitIds: inventoryIds,
              itemCount: inventoryIds.length,
            },
          });
          return { statusCode: 201, body: await fetchListing(client, listingId), resourceId: listingId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/exchange/listings/:listingId/offers",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      await expireStaleExchangeListings(context.pool);
      const listingId = uuidInput((request.params as Record<string, unknown>).listingId, "listingId");
      const body = objectInput(request.body);
      const inventoryIds = exchangeInventoryBundleInput(body);
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.offer.create",
          hashInput: { listingId, inventoryIds },
          resourceType: "EXCHANGE_OFFER",
        },
        async (client) => {
          await assertUgcOperationsPolicyAccepted(client, request.actor!.userId);
          const listing = await lockListing(client, listingId);
          if (listing.is_expired) throw conflict("교환 글의 등록 기간이 만료되었습니다.");
          if (listing.status !== "OPEN") throw conflict("제안을 받을 수 없는 교환 글입니다.");
          if (listing.author_id === request.actor!.userId) {
            throw forbidden("본인 글에는 교환을 제안할 수 없습니다.");
          }
          const blocked = await client.query(
            `SELECT 1 FROM user_blocks
             WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
            [listing.author_id, request.actor!.userId],
          );
          if (blocked.rowCount) throw forbidden();
          if (inventoryIds.some((inventoryId) => listing.offered_inventory_unit_ids.includes(inventoryId))) {
            throw conflict("등록 상품과 동일한 보관 상품은 제안할 수 없습니다.");
          }
          const locked = await lockInventoryUnits(client, [
            ...listing.offered_inventory_unit_ids,
            ...inventoryIds,
          ]);
          requireInventoryBundle(
            locked,
            listing.offered_inventory_unit_ids,
            listing.author_id,
            "EXCHANGE_LISTED",
          );
          requireActiveStorageBundle(locked, listing.offered_inventory_unit_ids);
          requireOriginalGachaDrawBundle(
            locked,
            listing.offered_inventory_unit_ids,
            listing.author_id,
          );
          requireExchangeEligibleBundle(locked, inventoryIds, request.actor!.userId);
          const created = await client.query<{ id: string }>(
            `INSERT INTO exchange_offers(listing_id,proposer_id,offered_inventory_unit_id,message)
             SELECT listing.id,$2,$3,'이 상품 묶음과 교환하실래요?'
               FROM exchange_listings listing
              WHERE listing.id=$1 AND listing.status='OPEN' AND listing.expires_at>now()
             ON CONFLICT DO NOTHING RETURNING id`,
            [listingId, request.actor!.userId, inventoryIds[0]],
          );
          if (!created.rowCount) {
            throw conflict("교환 글이 만료되었거나 이미 진행 중인 제안이 있습니다.");
          }
          const offerId = created.rows[0]!.id;
          if (inventoryIds.length === 2) {
            await client.query(
              `INSERT INTO exchange_offer_items(offer_id,inventory_unit_id,position)
               VALUES($1,$2,1)`,
              [offerId, inventoryIds[1]],
            );
          }
          await reserveInventoryUnits(client, inventoryIds, request.actor!.userId, "EXCHANGE_OFFERED");
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: "exchange.offer.created",
            payload: {
              listingId,
              offerId,
              authorId: listing.author_id,
              inventoryUnitIds: inventoryIds,
              itemCount: inventoryIds.length,
            },
          });
          return { statusCode: 201, body: await fetchOffer(client, offerId), resourceId: offerId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/exchange/listings/:listingId/offers/:offerId/decision",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      await expireStaleExchangeListings(context.pool);
      const params = request.params as Record<string, unknown>;
      const listingId = uuidInput(params.listingId, "listingId");
      const offerId = uuidInput(params.offerId, "offerId");
      const body = objectInput(request.body);
      const decision = enumInput(body, "decision", ["ACCEPTED", "REJECTED"] as const)!;
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.offer.decision",
          hashInput: { listingId, offerId, decision },
          resourceType: "EXCHANGE_OFFER",
        },
        async (client) => {
          const listing = await lockListing(client, listingId);
          if (listing.author_id !== request.actor!.userId) {
            throw forbidden("작성자만 제안을 처리할 수 있습니다.");
          }
          if (listing.is_expired) throw conflict("교환 글의 등록 기간이 만료되었습니다.");
          if (listing.status !== "OPEN") throw conflict("이미 결정된 교환 글입니다.");
          const offers = await lockOffers(client, listingId);
          const offer = offers.find((candidate) => candidate.id === offerId);
          if (!offer) throw notFound();
          if (!isExchangeOfferTransitionAllowed(offer.status, decision) || offer.status !== "PENDING") {
            throw conflict("이미 처리된 제안입니다.");
          }

          if (decision === "REJECTED") {
            const locked = await lockInventoryUnits(client, offer.offered_inventory_unit_ids);
            requireInventoryBundle(
              locked,
              offer.offered_inventory_unit_ids,
              offer.proposer_id,
              "EXCHANGE_OFFERED",
            );
            const rejected = await client.query(
              `UPDATE exchange_offers SET status='REJECTED',decided_at=now()
               WHERE id=$1 AND status='PENDING' RETURNING id`,
              [offerId],
            );
            if (!rejected.rowCount) throw conflict("이미 처리된 제안입니다.");
            await releaseInventoryUnits(client, offer.offered_inventory_unit_ids, "EXCHANGE_OFFERED");
          } else {
            const pendingOffers = offers.filter((candidate) => candidate.status === "PENDING");
            const locked = await lockInventoryUnits(client, [
              ...listing.offered_inventory_unit_ids,
              ...pendingOffers.flatMap((candidate) => candidate.offered_inventory_unit_ids),
            ]);
            requireInventoryBundle(
              locked,
              listing.offered_inventory_unit_ids,
              listing.author_id,
              "EXCHANGE_LISTED",
            );
            requireActiveStorageBundle(locked, listing.offered_inventory_unit_ids);
            for (const pending of pendingOffers) {
              requireInventoryBundle(
                locked,
                pending.offered_inventory_unit_ids,
                pending.proposer_id,
                "EXCHANGE_OFFERED",
              );
            }
            requireActiveStorageBundle(locked, offer.offered_inventory_unit_ids);
            requireOriginalGachaDrawBundle(
              locked,
              listing.offered_inventory_unit_ids,
              listing.author_id,
            );
            requireOriginalGachaDrawBundle(
              locked,
              offer.offered_inventory_unit_ids,
              offer.proposer_id,
            );
            const accepted = await client.query(
              "UPDATE exchange_offers SET status='ACCEPTED',decided_at=now() WHERE id=$1 AND status='PENDING' RETURNING id",
              [offerId],
            );
            if (!accepted.rowCount) throw conflict("이미 처리된 제안입니다.");
            const rejected = pendingOffers.filter((candidate) => candidate.id !== offerId);
            if (rejected.length) {
              const rejectedResult = await client.query(
                `UPDATE exchange_offers SET status='REJECTED',decided_at=now()
                 WHERE id=ANY($1::uuid[]) AND status='PENDING' RETURNING id`,
                [rejected.map((candidate) => candidate.id)],
              );
              if (rejectedResult.rowCount !== rejected.length) {
                throw conflict("제안 처리 상태가 변경되었습니다.");
              }
              await releaseInventoryUnits(
                client,
                rejected.flatMap((candidate) => candidate.offered_inventory_unit_ids),
                "EXCHANGE_OFFERED",
              );
            }
            const matched = await client.query(
              `UPDATE exchange_listings
               SET status='MATCHED',accepted_offer_id=$2,matched_at=now()
               WHERE id=$1 AND status='OPEN' AND expires_at>now() RETURNING id`,
              [listingId, offerId],
            );
            if (!matched.rowCount) throw conflict("이미 결정된 교환 글입니다.");
          }
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: `exchange.offer.${decision.toLowerCase()}`,
            payload: { listingId, offerId, proposerId: offer.proposer_id },
          });
          return { statusCode: 200, body: await fetchOffer(client, offerId), resourceId: offerId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/exchange/listings/:listingId/cancel",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      const listingId = uuidInput((request.params as Record<string, unknown>).listingId, "listingId");
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.listing.cancel",
          hashInput: { listingId },
          resourceType: "EXCHANGE_LISTING",
        },
        async (client) => {
          const listing = await lockListing(client, listingId);
          if (listing.author_id !== request.actor!.userId) {
            throw forbidden("작성자만 교환 글을 취소할 수 있습니다.");
          }
          if (listing.status !== "OPEN") {
            throw conflict("매칭된 교환은 운영자 확인을 통해서만 취소할 수 있습니다.");
          }
          const offers = await lockOffers(client, listingId);
          const pending = offers.filter((offer) => offer.status === "PENDING");
          const locked = await lockInventoryUnits(client, [
            ...listing.offered_inventory_unit_ids,
            ...pending.flatMap((offer) => offer.offered_inventory_unit_ids),
          ]);
          requireInventoryBundle(
            locked,
            listing.offered_inventory_unit_ids,
            listing.author_id,
            "EXCHANGE_LISTED",
          );
          for (const offer of pending) {
            requireInventoryBundle(
              locked,
              offer.offered_inventory_unit_ids,
              offer.proposer_id,
              "EXCHANGE_OFFERED",
            );
          }
          if (pending.length) {
            const rejectedResult = await client.query(
              `UPDATE exchange_offers SET status='REJECTED',decided_at=now()
               WHERE id=ANY($1::uuid[]) AND status='PENDING' RETURNING id`,
              [pending.map((offer) => offer.id)],
            );
            if (rejectedResult.rowCount !== pending.length) {
              throw conflict("제안 처리 상태가 변경되었습니다.");
            }
            await releaseInventoryUnits(
              client,
              pending.flatMap((offer) => offer.offered_inventory_unit_ids),
              "EXCHANGE_OFFERED",
            );
          }
          await releaseInventoryUnits(client, listing.offered_inventory_unit_ids, "EXCHANGE_LISTED");
          const cancelled = await client.query(
            `UPDATE exchange_listings
             SET status='CANCELLED',cancelled_at=now(),cancelled_by=$2,cancel_reason='AUTHOR_CANCELLED'
             WHERE id=$1 AND status='OPEN' RETURNING id`,
            [listingId, request.actor!.userId],
          );
          if (!cancelled.rowCount) throw conflict("이미 변경된 교환 글입니다.");
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: "exchange.listing.cancelled",
            payload: {
              listingId,
              authorId: listing.author_id,
              proposerIds: pending.map((offer) => offer.proposer_id),
            },
          });
          return { statusCode: 200, body: await fetchListing(client, listingId), resourceId: listingId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/exchange/listings/:listingId/offers/:offerId/withdraw",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      const params = request.params as Record<string, unknown>;
      const listingId = uuidInput(params.listingId, "listingId");
      const offerId = uuidInput(params.offerId, "offerId");
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.offer.withdraw",
          hashInput: { listingId, offerId },
          resourceType: "EXCHANGE_OFFER",
        },
        async (client) => {
          const listing = await lockListing(client, listingId);
          if (listing.status !== "OPEN") throw conflict("매칭된 제안은 철회할 수 없습니다.");
          const offers = await lockOffers(client, listingId);
          const offer = offers.find((candidate) => candidate.id === offerId);
          if (!offer) throw notFound();
          if (offer.proposer_id !== request.actor!.userId) {
            throw forbidden("제안자만 교환 제안을 철회할 수 있습니다.");
          }
          if (offer.status !== "PENDING") throw conflict("이미 처리된 제안입니다.");
          const locked = await lockInventoryUnits(client, offer.offered_inventory_unit_ids);
          requireInventoryBundle(
            locked,
            offer.offered_inventory_unit_ids,
            offer.proposer_id,
            "EXCHANGE_OFFERED",
          );
          const withdrawn = await client.query(
            `UPDATE exchange_offers SET status='WITHDRAWN',decided_at=now()
             WHERE id=$1 AND status='PENDING' RETURNING id`,
            [offerId],
          );
          if (!withdrawn.rowCount) throw conflict("이미 처리된 제안입니다.");
          await releaseInventoryUnits(client, offer.offered_inventory_unit_ids, "EXCHANGE_OFFERED");
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: "exchange.offer.withdrawn",
            payload: { listingId, offerId, authorId: listing.author_id },
          });
          return { statusCode: 200, body: await fetchOffer(client, offerId), resourceId: offerId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/v1/exchange/listings/:listingId/completion-confirmation",
    { preHandler: [requireLiveCommerce(context), context.auth.requireUser] },
    async (request, reply) => {
      const listingId = uuidInput((request.params as Record<string, unknown>).listingId, "listingId");
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.listing.completion-confirmation",
          hashInput: { listingId },
          resourceType: "EXCHANGE_LISTING",
        },
        async (client) => {
          const listing = await lockListing(client, listingId);
          if (listing.status !== "MATCHED" || !listing.accepted_offer_id) {
            throw conflict("완료 확인이 가능한 매칭 상태가 아닙니다.");
          }
          const offers = await lockOffers(client, listingId);
          const acceptedOffer = offers.find((offer) => offer.id === listing.accepted_offer_id);
          if (!acceptedOffer || acceptedOffer.status !== "ACCEPTED") {
            throw conflict("수락된 제안 정보를 확인할 수 없습니다.");
          }
          const isAuthor = request.actor!.userId === listing.author_id;
          const isProposer = request.actor!.userId === acceptedOffer.proposer_id;
          if (!isAuthor && !isProposer) {
            throw forbidden("교환 당사자만 완료를 확인할 수 있습니다.");
          }
          if ((isAuthor && listing.author_confirmed_at) || (isProposer && listing.proposer_confirmed_at)) {
            return {
              statusCode: 200,
              body: await fetchListing(client, listingId),
              resourceId: listingId,
            };
          }

          const locked = await lockInventoryUnits(client, [
            ...listing.offered_inventory_unit_ids,
            ...acceptedOffer.offered_inventory_unit_ids,
          ]);
          requireInventoryBundle(
            locked,
            listing.offered_inventory_unit_ids,
            listing.author_id,
            "EXCHANGE_LISTED",
          );
          requireInventoryBundle(
            locked,
            acceptedOffer.offered_inventory_unit_ids,
            acceptedOffer.proposer_id,
            "EXCHANGE_OFFERED",
          );

          const confirmed = await client.query<ListingLifecycleRow>(
            `UPDATE exchange_listings SET
               author_confirmed_at=CASE WHEN $2 THEN COALESCE(author_confirmed_at,now()) ELSE author_confirmed_at END,
               proposer_confirmed_at=CASE WHEN $3 THEN COALESCE(proposer_confirmed_at,now()) ELSE proposer_confirmed_at END
             WHERE id=$1 AND status='MATCHED'
             RETURNING id,author_id,offered_inventory_unit_id,
               ARRAY(SELECT item.inventory_unit_id FROM exchange_listing_items item
                 WHERE item.listing_id=exchange_listings.id ORDER BY item.position) AS offered_inventory_unit_ids,
               status,accepted_offer_id,matched_at,
               author_confirmed_at,proposer_confirmed_at,completed_at,completion_mode,cancelled_at,
               cancelled_by,cancel_reason,resolved_by_admin_id`,
            [listingId, isAuthor, isProposer],
          );
          if (!confirmed.rowCount) throw conflict("완료 확인 상태가 변경되었습니다.");
          const updated = confirmed.rows[0]!;
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: "exchange.completion.confirmed",
            payload: {
              listingId,
              confirmingUserId: request.actor!.userId,
              side: isAuthor ? "AUTHOR" : "PROPOSER",
            },
          });
          if (updated.author_confirmed_at && updated.proposer_confirmed_at) {
            await finalizeOwnershipExchange(
              client,
              updated,
              acceptedOffer,
              "MUTUAL_CONFIRMATION",
              null,
            );
            await writeOutbox(client, request.id, {
              aggregateType: "EXCHANGE_LISTING",
              aggregateId: listingId,
              eventType: "exchange.completed",
              payload: {
                listingId,
                authorId: listing.author_id,
                proposerId: acceptedOffer.proposer_id,
                completionMode: "MUTUAL_CONFIRMATION",
              },
            });
          }
          return { statusCode: 200, body: await fetchListing(client, listingId), resourceId: listingId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/v1/admin/exchange/listings",
    { preHandler: context.auth.requirePermission("exchange.resolve") },
    async (request) => {
      const query = queryOf(request);
      const { limit, cursor } = pagination(query);
      const search = queryString(query.q);
      const status = query.status === undefined
        ? undefined
        : enumInput(query, "status", ["OPEN", "MATCHED", "COMPLETED", "CANCELLED", "HIDDEN"] as const);
      const values: unknown[] = [limit + 1];
      const filters: string[] = [];
      if (search) {
        values.push(`%${search}%`);
        filters.push(
          `(l.title ILIKE $${values.length} OR l.details ILIKE $${values.length}
            OR u.nickname ILIKE $${values.length} OR l.id::text ILIKE $${values.length}
            OR EXISTS (
              SELECT 1
              FROM exchange_listing_items admin_search_item
              JOIN inventory_units admin_search_inventory
                ON admin_search_inventory.id=admin_search_item.inventory_unit_id
              JOIN catalog_products admin_search_product
                ON admin_search_product.id=admin_search_inventory.product_id
              WHERE admin_search_item.listing_id=l.id
                AND (admin_search_product.name ILIKE $${values.length}
                  OR admin_search_product.sku ILIKE $${values.length})
            ))`,
        );
      }
      if (status) {
        values.push(status);
        filters.push(`l.status=$${values.length}`);
      }
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        filters.push(`(l.created_at,l.id)<($${values.length - 1},$${values.length})`);
      }
      const result = await context.pool.query<ListingRow>(
        `${listingSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
         ORDER BY l.created_at DESC,l.id DESC LIMIT $1`,
        values,
      );
      return listingPage(result.rows, limit);
    },
  );

  app.post(
    "/v1/admin/exchange/listings/:listingId/resolution",
    { preHandler: context.auth.requirePermission("exchange.resolve") },
    async (request, reply) => {
      const listingId = uuidInput((request.params as Record<string, unknown>).listingId, "listingId");
      const body = objectInput(request.body);
      const action = enumInput(body, "action", ["COMPLETE", "CANCEL"] as const)!;
      const reason = stringInput(body, "reason", { min: 2, max: 1000 })!;
      const mutation = adminMutationHeaders(request, reason);
      const result = await runIdempotentMutation(
        context,
        request,
        {
          scope: "exchange.admin.resolve",
          hashInput: { listingId, action, reason },
          resourceType: "EXCHANGE_LISTING",
          key: mutation.idempotencyKey,
        },
        async (client) => {
          const listing = await lockListing(client, listingId);
          if (listing.status !== "MATCHED" || !listing.accepted_offer_id) {
            throw conflict("운영 처리가 가능한 매칭 상태가 아닙니다.");
          }
          const offers = await lockOffers(client, listingId);
          const acceptedOffer = offers.find((offer) => offer.id === listing.accepted_offer_id);
          if (!acceptedOffer || acceptedOffer.status !== "ACCEPTED") {
            throw conflict("수락된 제안 정보를 확인할 수 없습니다.");
          }
          const before = await fetchListing(client, listingId);
          if (action === "COMPLETE") {
            await finalizeOwnershipExchange(
              client,
              listing,
              acceptedOffer,
              "ADMIN_OVERRIDE",
              request.actor!.userId,
            );
          } else {
            await cancelMatchedExchange(
              client,
              listing,
              acceptedOffer,
              request.actor!.userId,
              reason,
            );
          }
          const after = await fetchListing(client, listingId);
          await writeAdminAudit(client, request, request.actor!, {
            action: action === "COMPLETE" ? "EXCHANGE_COMPLETED" : "EXCHANGE_CANCELLED",
            targetType: "EXCHANGE_LISTING",
            targetId: listingId,
            reason,
            before,
            after,
            metadata: {
              acceptedOfferId: acceptedOffer.id,
              proposerId: acceptedOffer.proposer_id,
              listingInventoryUnitIds: listing.offered_inventory_unit_ids,
              offerInventoryUnitIds: acceptedOffer.offered_inventory_unit_ids,
            },
          });
          await writeOutbox(client, request.id, {
            aggregateType: "EXCHANGE_LISTING",
            aggregateId: listingId,
            eventType: action === "COMPLETE" ? "exchange.completed" : "exchange.cancelled",
            payload: {
              listingId,
              authorId: listing.author_id,
              proposerId: acceptedOffer.proposer_id,
              listingInventoryUnitIds: listing.offered_inventory_unit_ids,
              offerInventoryUnitIds: acceptedOffer.offered_inventory_unit_ids,
              completionMode: action === "COMPLETE" ? "ADMIN_OVERRIDE" : null,
            },
          });
          return { statusCode: 200, body: after, resourceId: listingId };
        },
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
