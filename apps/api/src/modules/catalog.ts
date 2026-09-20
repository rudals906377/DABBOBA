import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_SALE_STATUSES,
  REQUEST_STATUSES,
  type ProductCategoryId,
  type ProductSaleStatus,
} from "@dabboba/domain";
import type { CommerceLaunchMode } from "@dabboba/config";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { assertDrawCapacity } from "../lib/draw-capacity.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import {
  booleanInput,
  enumInput,
  integerInput,
  nullableStringInput,
  objectInput,
  queryString,
  slugIdInput,
  stringArrayInput,
  stringInput,
  uuidInput,
} from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import { CATALOG_TOTAL_QUANTITY_SQL } from "../lib/catalog-total-quantity.js";
import { effectiveCommerceMode } from "../lib/commerce-mode.js";
import {
  CATALOG_REMAINING_KUJI_TIERS_SQL,
  type CatalogRemainingKujiTierRow,
} from "../lib/catalog-kuji-prize-tiers.js";
import {
  CUSTOMER_CATALOG_GENERATION,
  DEMO_SELLER_PRODUCT_IDS,
  demoProfileRequested,
} from "../lib/demo-testing.js";
import type { ApiContext } from "../types.js";
import { assertReadyOwnedMedia } from "./media.js";

type IpRow = {
  id: string;
  slug: string;
  name_ko: string;
  name_en: string;
  name_ja: string | null;
  aliases: string[];
  description: string;
  image_url: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type ProductRow = {
  id: string;
  sku: string;
  ip_id: string;
  category: ProductCategoryId;
  name: string;
  manufacturer: string | null;
  release_date: string | null;
  price: number;
  available_quantity: number | string;
  total_quantity?: number | string | null;
  metadata: Record<string, unknown>;
  image_url: string | null;
  storefront_image_url: string | null;
  is_active: boolean;
  is_prize_only: boolean;
  sale_status: ProductSaleStatus;
  character_ids: string[];
  remaining_kuji_tiers?: CatalogRemainingKujiTierRow[];
  version: number;
  created_at: Date;
  updated_at: Date;
  sort_score?: number | string;
};

const CATALOG_PRODUCT_SORTS = ["latest", "popular", "price-high", "price-low"] as const;
type CatalogProductSort = (typeof CATALOG_PRODUCT_SORTS)[number];

type CharacterRow = {
  id: string;
  ip_id: string;
  name: string;
  aliases: string[];
  image_url: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type CatalogRequestRow = {
  id: string;
  user_id: string;
  kind: "PRODUCT" | "IP";
  name: string;
  reference_url: string | null;
  description: string | null;
  media_id: string | null;
  status: (typeof REQUEST_STATUSES)[number];
  canonical_target_id: string | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

const mapIp = (row: IpRow) => ({
  id: row.id,
  slug: row.slug,
  nameKo: row.name_ko,
  nameEn: row.name_en,
  nameJa: row.name_ja,
  aliases: row.aliases,
  description: row.description,
  imageUrl: row.image_url,
  isActive: row.is_active,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

function productBlockedReason(row: ProductRow, commerceMode: CommerceLaunchMode) {
  if (row.sale_status === "DRAFT") return "DRAFT" as const;
  if (row.sale_status === "COMING_SOON") return "COMING_SOON" as const;
  if (row.sale_status === "PAUSED") return "PAUSED" as const;
  if (commerceMode !== "LIVE") return "COMMERCE_PRELAUNCH" as const;
  if (numberValue(row.available_quantity) <= 0) return "OUT_OF_STOCK" as const;
  return null;
}

const mapProduct = (row: ProductRow, commerceMode: CommerceLaunchMode = "LIVE") => ({
  id: row.id,
  sku: row.sku,
  ipId: row.ip_id,
  characterIds: row.character_ids,
  category: row.category,
  name: row.name,
  manufacturer: row.manufacturer,
  releaseDate: row.release_date,
  price: numberValue(row.price) > 0 ? numberValue(row.price) : null,
  availableQuantity: numberValue(row.available_quantity),
  totalQuantity: row.total_quantity === null || row.total_quantity === undefined
    ? null
    : numberValue(row.total_quantity),
  metadata: row.metadata,
  imageUrl: row.image_url,
  storefrontImageUrl: row.storefront_image_url,
  isActive: row.is_active,
  isPrizeOnly: row.is_prize_only,
  saleStatus: row.sale_status,
  purchasable: productBlockedReason(row, commerceMode) === null,
  blockedReason: productBlockedReason(row, commerceMode),
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  ...(row.remaining_kuji_tiers === undefined ? {} : {
    remainingKujiTiers: row.remaining_kuji_tiers.map((tier) => ({
      tierCode: tier.tierCode,
      tierRank: numberValue(tier.tierRank),
      label: tier.label,
      initialQuantity: numberValue(tier.initialQuantity),
      remainingQuantity: numberValue(tier.remainingQuantity),
    })),
  }),
});

const mapCharacter = (row: CharacterRow) => ({
  id: row.id,
  ipId: row.ip_id,
  name: row.name,
  aliases: row.aliases,
  imageUrl: row.image_url,
  isActive: row.is_active,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapCatalogRequest = (row: CatalogRequestRow) => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  name: row.name,
  referenceUrl: row.reference_url,
  description: row.description,
  mediaId: row.media_id,
  status: row.status,
  canonicalTargetId: row.canonical_target_id,
  decisionReason: row.decision_reason,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

function ipInput(body: unknown) {
  const input = objectInput(body);
  return {
    id: input.id === undefined ? undefined : slugIdInput(input.id, "id"),
    slug: slugIdInput(stringInput(input, "slug", { max: 100 })!, "slug"),
    nameKo: stringInput(input, "nameKo", { max: 160 })!,
    nameEn: stringInput(input, "nameEn", { max: 160 })!,
    nameJa: nullableStringInput(input, "nameJa", { max: 160 }),
    aliases: stringArrayInput(input, "aliases", 30)!,
    description: stringInput(input, "description", { min: 0, max: 5000 })!,
    imageUrl: nullableStringInput(input, "imageUrl", { max: 2000 }),
    isActive: booleanInput(input, "isActive")!,
    expectedVersion: integerInput(input, "expectedVersion", { min: 1, optional: true }),
  };
}

function booleanQuery(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw badRequest(`${key} 값은 true 또는 false여야 합니다.`);
}

function characterInput(body: unknown) {
  const input = objectInput(body);
  return {
    ipId: slugIdInput(stringInput(input, "ipId", { max: 120 })!, "ipId"),
    name: stringInput(input, "name", { max: 160 })!,
    aliases: stringArrayInput(input, "aliases", 20)!,
    imageUrl: nullableStringInput(input, "imageUrl", { max: 2000 }),
    isActive: booleanInput(input, "isActive")!,
    expectedVersion: integerInput(input, "expectedVersion", { min: 1, optional: true }),
  };
}

function productInput(body: unknown) {
  const input = objectInput(body);
  const metadata = input.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw badRequest("metadata 값을 확인해 주세요.");
  const rawCharacterIds = stringArrayInput(input, "characterIds", 30, true);
  const characterIds = rawCharacterIds?.map((value) => uuidInput(value, "characterId"));
  if (characterIds && new Set(characterIds).size !== characterIds.length) throw badRequest("같은 캐릭터를 중복 지정할 수 없습니다.");
  return {
    id: input.id === undefined ? undefined : slugIdInput(input.id, "id"),
    sku: stringInput(input, "sku", { max: 80 })!,
    ipId: slugIdInput(stringInput(input, "ipId", { max: 120 })!, "ipId"),
    characterIds,
    category: enumInput(input, "category", PRODUCT_CATEGORIES)!,
    name: stringInput(input, "name", { max: 240 })!,
    manufacturer: nullableStringInput(input, "manufacturer", { max: 160 }),
    releaseDate: nullableStringInput(input, "releaseDate", { max: 10 }),
    price: integerInput(input, "price", { min: 0, max: 2_147_483_647 })!,
    availableQuantity: integerInput(input, "availableQuantity", { min: 0, max: 2_147_483_647 })!,
    metadata: metadata as Record<string, unknown>,
    imageUrl: nullableStringInput(input, "imageUrl", { max: 2000 }),
    isActive: booleanInput(input, "isActive")!,
    isPrizeOnly: booleanInput(input, "isPrizeOnly", true),
    saleStatus: input.saleStatus === undefined
      ? undefined
      : enumInput(input, "saleStatus", PRODUCT_SALE_STATUSES),
    expectedVersion: integerInput(input, "expectedVersion", { min: 1, optional: true }),
  };
}

async function assertProductSaleStatusReady(
  client: DatabaseClient,
  input: {
    id: string;
    category: ProductCategoryId;
    price: number;
    availableQuantity: number;
    imageUrl: string | null;
    storefrontImageUrl?: string | null;
    isActive: boolean;
    isPrizeOnly: boolean;
    saleStatus: ProductSaleStatus;
  },
) {
  if (input.saleStatus !== "ON_SALE") return;
  if (!input.isActive || input.isPrizeOnly) throw conflict("판매 상품만 판매중 상태로 전환할 수 있습니다.");
  if (input.price <= 0) throw conflict("판매중 상품은 0원보다 큰 가격이 필요합니다.");
  if (!input.imageUrl && !input.storefrontImageUrl) throw conflict("판매중 상품은 공개 이미지가 필요합니다.");
  if (input.availableQuantity <= 0) throw conflict("판매중 전환 시 사용 가능한 재고가 필요합니다.");
  if (input.category === "gacha" || input.category === "kuji") {
    const active = await client.query(
      `SELECT 1
         FROM draw_probability_versions AS version
        WHERE version.product_id=$1
          AND version.status='ACTIVE'
          AND ($2::text <> 'kuji' OR EXISTS (
            SELECT 1 FROM kuji_decks AS deck WHERE deck.probability_version_id=version.id
          ))
        LIMIT 1`,
      [input.id, input.category],
    );
    if (!active.rowCount) throw conflict("판매중 가챠·쿠지는 공개된 확률표 또는 쿠지 덱이 필요합니다.");
  }
}

async function assertCharactersBelongToIp(client: DatabaseClient, ipId: string, characterIds: readonly string[]) {
  if (!characterIds.length) return;
  const matched = await client.query<{ count: string }>(
    "SELECT count(*) FROM catalog_characters WHERE id=ANY($1::uuid[]) AND ip_id=$2",
    [characterIds, ipId],
  );
  if (Number(matched.rows[0]?.count) !== characterIds.length) {
    throw badRequest("선택한 캐릭터가 상품 IP에 속하지 않습니다.");
  }
}

function requestQuery(request: FastifyRequest): Record<string, unknown> {
  return (request.query || {}) as Record<string, unknown>;
}

function queryBoolean(value: unknown, key: string): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw badRequest(`${key} 값을 확인해 주세요.`);
}

function catalogSortCursorValue(row: ProductRow, sort: CatalogProductSort): string {
  if (sort === "latest") return sort;
  return `${sort}:${numberValue(row.sort_score ?? 0)}`;
}

function catalogCursorScore(cursorSort: string | undefined, sort: CatalogProductSort): number | null {
  if (sort === "latest") return cursorSort === "latest" ? 0 : null;
  const prefix = `${sort}:`;
  if (!cursorSort?.startsWith(prefix)) return null;
  const value = Number(cursorSort.slice(prefix.length));
  return Number.isSafeInteger(value) && value >= -1 ? value : null;
}

export async function registerCatalogRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/catalog/ips", async (request) => {
    const query = requestQuery(request);
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const values: unknown[] = [limit + 1];
    const filters = ["is_active = true"];
    if (demoProfileRequested()) {
      values.push(CUSTOMER_CATALOG_GENERATION);
      filters.push(`EXISTS (
        SELECT 1 FROM catalog_products p
        WHERE p.ip_id=catalog_ips.id AND p.is_active AND NOT p.is_prize_only
          AND p.metadata->>'catalogGeneration'=$${values.length}
      )`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(name_ko ILIKE $${values.length} OR name_en ILIKE $${values.length} OR array_to_string(aliases, ' ') ILIKE $${values.length})`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
    }
    const result = await context.pool.query<IpRow>(
      `SELECT * FROM catalog_ips WHERE ${filters.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT $1`,
      values,
    );
    return cursorPage(result.rows, limit, mapIp);
  });

  app.get("/v1/catalog/characters", async (request) => {
    const query = requestQuery(request);
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const ipId = query.ipId === undefined ? undefined : slugIdInput(query.ipId, "ipId");
    const values: unknown[] = [limit + 1];
    const filters = ["c.is_active = true", "i.is_active = true"];
    if (demoProfileRequested()) {
      values.push(CUSTOMER_CATALOG_GENERATION);
      filters.push(`EXISTS (
        SELECT 1 FROM catalog_products p
        WHERE p.ip_id=c.ip_id AND p.is_active AND NOT p.is_prize_only
          AND p.metadata->>'catalogGeneration'=$${values.length}
      )`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(c.name ILIKE $${values.length} OR array_to_string(c.aliases, ' ') ILIKE $${values.length})`);
    }
    if (ipId) {
      values.push(ipId);
      filters.push(`c.ip_id = $${values.length}`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(c.created_at, c.id) < ($${values.length - 1}, $${values.length})`);
    }
    const result = await context.pool.query<CharacterRow>(
      `SELECT c.* FROM catalog_characters c
       JOIN catalog_ips i ON i.id=c.ip_id
       WHERE ${filters.join(" AND ")}
       ORDER BY c.created_at DESC,c.id DESC LIMIT $1`,
      values,
    );
    return cursorPage(result.rows, limit, mapCharacter);
  });

  app.get("/v1/catalog/products", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const commerceMode = effectiveCommerceMode(context.config);
    const query = requestQuery(request);
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const category = query.category === undefined ? undefined : enumInput(query, "category", PRODUCT_CATEGORIES);
    const ipId = query.ipId === undefined ? undefined : slugIdInput(query.ipId, "ipId");
    const characterId = query.characterId === undefined ? undefined : uuidInput(query.characterId, "characterId");
    const sort = enumInput(query, "sort", CATALOG_PRODUCT_SORTS, true) ?? "latest";
    const excludeSoldOut = queryBoolean(query.excludeSoldOut, "excludeSoldOut");
    const values: unknown[] = [limit + 1];
    const filters = [
      "p.is_active = true",
      "p.is_prize_only = false",
      "p.sale_status IN ('COMING_SOON','ON_SALE')",
      "i.is_active = true",
      `(p.sale_status <> 'ON_SALE' OR p.category NOT IN ('gacha','kuji') OR EXISTS (
        SELECT 1 FROM draw_probability_versions active_version
         WHERE active_version.product_id=p.id AND active_version.status='ACTIVE'
      ))`,
    ];
    if (demoProfileRequested()) {
      values.push([...DEMO_SELLER_PRODUCT_IDS], CUSTOMER_CATALOG_GENERATION);
      filters.push(`p.id=ANY($${values.length - 1}::text[]) AND p.metadata->>'catalogGeneration'=$${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(p.name ILIKE $${values.length}
        OR p.sku ILIKE $${values.length}
        OR COALESCE(p.manufacturer,'') ILIKE $${values.length}
        OR i.name_ko ILIKE $${values.length}
        OR i.name_en ILIKE $${values.length}
        OR array_to_string(i.aliases,' ') ILIKE $${values.length})`);
    }
    if (category) { values.push(category); filters.push(`p.category = $${values.length}`); }
    if (ipId) { values.push(ipId); filters.push(`p.ip_id = $${values.length}`); }
    if (characterId) { values.push(characterId); filters.push(`EXISTS (SELECT 1 FROM product_characters pc_filter WHERE pc_filter.product_id=p.id AND pc_filter.character_id=$${values.length})`); }
    if (excludeSoldOut) filters.push("COALESCE(s.on_hand-s.reserved,0) > 0");

    const pageFilters: string[] = [];
    if (cursor) {
      const score = catalogCursorScore(cursor.sort, sort);
      if (score === null) throw badRequest("페이지 커서와 정렬 기준이 일치하지 않습니다.");
      if (sort === "latest") {
        values.push(cursor.createdAt, cursor.id);
        pageFilters.push(`(created_at,id)<($${values.length - 1},$${values.length})`);
      } else {
        values.push(score, cursor.createdAt, cursor.id);
        const scoreIndex = values.length - 2;
        const createdAtIndex = values.length - 1;
        const idIndex = values.length;
        const direction = sort === "price-low" ? ">" : "<";
        pageFilters.push(`(sort_score ${direction} $${scoreIndex}::numeric
          OR (sort_score=$${scoreIndex}::numeric
            AND (created_at,id)<($${createdAtIndex},$${idIndex})))`);
      }
    }

    const sortScore = sort === "popular"
      ? `(SELECT count(*)::bigint FROM home_product_click_events click_event
          WHERE click_event.product_id=p.id
            AND click_event.created_at>=now()-interval '30 days')`
      : sort === "price-low"
        ? `CASE WHEN p.price>0 THEN p.price ELSE 2147483647 END`
        : sort === "price-high"
          ? `CASE WHEN p.price>0 THEN p.price ELSE -1 END`
          : "0";
    const orderBy = sort === "latest"
      ? "created_at DESC,id DESC"
      : sort === "price-low"
        ? "sort_score ASC,created_at DESC,id DESC"
        : "sort_score DESC,created_at DESC,id DESC";
    const result = await context.pool.query<ProductRow>(
       `WITH product_catalog AS (
         SELECT p.*, COALESCE(s.on_hand - s.reserved, 0) AS available_quantity,
           ${CATALOG_TOTAL_QUANTITY_SQL} AS total_quantity,
           ${CATALOG_REMAINING_KUJI_TIERS_SQL} AS remaining_kuji_tiers,
           COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id) FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids,
           ${sortScore} AS sort_score
         FROM catalog_products p JOIN catalog_ips i ON i.id = p.ip_id
         LEFT JOIN product_stock s ON s.product_id = p.id
         WHERE ${filters.join(" AND ")}
       )
       SELECT * FROM product_catalog
       ${pageFilters.length ? `WHERE ${pageFilters.join(" AND ")}` : ""}
       ORDER BY ${orderBy} LIMIT $1`,
      values,
    );
    return cursorPage(
      result.rows,
      limit,
      (row) => mapProduct(row, commerceMode),
      (row) => catalogSortCursorValue(row, sort),
    );
  });

  app.get("/v1/catalog/products/:productId", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const commerceMode = effectiveCommerceMode(context.config);
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const demoProduct = demoProfileRequested();
    if (demoProduct && !DEMO_SELLER_PRODUCT_IDS.includes(productId as typeof DEMO_SELLER_PRODUCT_IDS[number])) {
      throw notFound("상품을 찾을 수 없습니다.");
    }
    const result = await context.pool.query<ProductRow>(
      `SELECT p.*,COALESCE(s.on_hand-s.reserved,0) AS available_quantity,
        ${CATALOG_TOTAL_QUANTITY_SQL} AS total_quantity,
        ${CATALOG_REMAINING_KUJI_TIERS_SQL} AS remaining_kuji_tiers,
        COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id)
          FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids
       FROM catalog_products p
       JOIN catalog_ips i ON i.id=p.ip_id
       LEFT JOIN product_stock s ON s.product_id=p.id
       WHERE p.id=$1 AND p.is_active=true
         AND p.is_prize_only=false
         AND p.sale_status IN ('COMING_SOON','ON_SALE')
         AND i.is_active=true
         AND (p.sale_status <> 'ON_SALE' OR p.category NOT IN ('gacha','kuji') OR EXISTS (
           SELECT 1 FROM draw_probability_versions active_version
            WHERE active_version.product_id=p.id AND active_version.status='ACTIVE'
         ))`,
      [productId],
    );
    if (!result.rowCount) throw notFound("상품을 찾을 수 없습니다.");
    return mapProduct(result.rows[0]!, commerceMode);
  });

  app.post("/v1/catalog/requests", { preHandler: context.auth.requireUser }, async (request, reply) => {
    const input = objectInput(request.body);
    const kind = enumInput(input, "kind", ["PRODUCT", "IP"] as const)!;
    const name = stringInput(input, "name", { max: 240 })!;
    const referenceUrl = nullableStringInput(input, "referenceUrl", { max: 2000 });
    const description = nullableStringInput(input, "description", { max: 5000 });
    const mediaId = input.mediaId === undefined || input.mediaId === null ? null : uuidInput(input.mediaId, "mediaId");
    if (referenceUrl) { try { new URL(referenceUrl); } catch { throw badRequest("참고 링크를 확인해 주세요."); } }
    const key=idempotencyKey(request.headers);const hash=requestHash({kind,name,referenceUrl:referenceUrl||null,description:description||null,mediaId});
    const result = await withTransaction(context.pool, async (client) => {
      const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CREATE_CATALOG_REQUEST",key,hash});if(!idem.fresh)return{replay:true,statusCode:idem.statusCode,body:idem.body};
      if (mediaId) await assertReadyOwnedMedia(client, request.actor!.userId, [mediaId], ["CATALOG_REQUEST"]);
      const created = await client.query<CatalogRequestRow>(
        `INSERT INTO catalog_requests (user_id, kind, name, reference_url, description, media_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [request.actor!.userId, kind, name, referenceUrl || null, description || null, mediaId],
      );
      const body=mapCatalogRequest(created.rows[0]!);await completeIdempotency(client,idem.id,{statusCode:201,body,resourceType:"CATALOG_REQUEST",resourceId:created.rows[0]!.id});return{replay:false,statusCode:201,body};
    });
    if(result.replay)reply.header("x-idempotent-replay","true");return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/admin/ips", { preHandler: context.auth.requirePermission("catalog.read") }, async (request) => {
    const query = requestQuery(request); const { limit, cursor } = pagination(query); const search = queryString(query.q);
    const values: unknown[] = [limit + 1]; const filters: string[] = [];
    if (search) { values.push(`%${search}%`); filters.push(`(name_ko ILIKE $${values.length} OR name_en ILIKE $${values.length} OR array_to_string(aliases, ' ') ILIKE $${values.length})`); }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`); }
    const result = await context.pool.query<IpRow>(`SELECT * FROM catalog_ips ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, mapIp);
  });

  app.post("/v1/admin/ips", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const input = ipInput(request.body); const id = input.id || input.slug;
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "IP", id }, work: async (client) => {
      const result = await client.query<IpRow>(
        `INSERT INTO catalog_ips (id, slug, name_ko, name_en, name_ja, aliases, description, image_url, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, input.slug, input.nameKo, input.nameEn, input.nameJa || null, input.aliases, input.description, input.imageUrl || null, input.isActive],
      );
      await writeAdminAudit(client, request, request.actor!, { action: "IP_CREATED", targetType: "IP", targetId: id, after: result.rows[0] });
      await writeOutbox(client, request.id, { aggregateType: "IP", aggregateId: id, eventType: "catalog.ip.created", payload: { id } });
      return { statusCode: 201, body: mapIp(result.rows[0]!), resourceType: "IP", resourceId: id };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.patch("/v1/admin/ips/:ipId", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const id = slugIdInput((request.params as Record<string, unknown>).ipId, "ipId"); const input = ipInput(request.body);
    if (!input.expectedVersion) throw badRequest("expectedVersion 값이 필요합니다.");
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "IP", id }, work: async (client) => {
      const before = await client.query<IpRow>("SELECT * FROM catalog_ips WHERE id = $1 FOR UPDATE", [id]);
      if (!before.rowCount) throw notFound();
      const updated = await client.query<IpRow>(
        `UPDATE catalog_ips SET slug=$2,name_ko=$3,name_en=$4,name_ja=$5,aliases=$6,description=$7,image_url=$8,is_active=$9,version=version+1
         WHERE id=$1 AND version=$10 RETURNING *`,
        [id, input.slug, input.nameKo, input.nameEn, input.nameJa || null, input.aliases, input.description, input.imageUrl || null, input.isActive, input.expectedVersion],
      );
      if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
      await writeAdminAudit(client, request, request.actor!, { action: "IP_UPDATED", targetType: "IP", targetId: id, before: before.rows[0], after: updated.rows[0] });
      return { statusCode: 200, body: mapIp(updated.rows[0]!), resourceType: "IP", resourceId: id };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.get("/v1/admin/characters", { preHandler: context.auth.requirePermission("catalog.read") }, async (request) => {
    const query = requestQuery(request); const { limit, cursor } = pagination(query); const search = queryString(query.q);
    const ipId = query.ipId === undefined ? undefined : slugIdInput(query.ipId, "ipId");
    const values: unknown[] = [limit + 1]; const filters: string[] = [];
    if (search) { values.push(`%${search}%`); filters.push(`(name ILIKE $${values.length} OR array_to_string(aliases, ' ') ILIKE $${values.length})`); }
    if (ipId) { values.push(ipId); filters.push(`ip_id = $${values.length}`); }
    if (cursor) { values.push(cursor.createdAt, cursor.id); filters.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`); }
    const result = await context.pool.query<CharacterRow>(`SELECT * FROM catalog_characters ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY created_at DESC,id DESC LIMIT $1`, values);
    return cursorPage(result.rows, limit, mapCharacter);
  });

  app.post("/v1/admin/characters", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const input = characterInput(request.body);
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "CHARACTER", ipId: input.ipId, name: input.name }, work: async (client) => {
      const result = await client.query<CharacterRow>(
        `INSERT INTO catalog_characters (ip_id,name,aliases,image_url,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.ipId, input.name, input.aliases, input.imageUrl || null, input.isActive],
      );
      await writeAdminAudit(client, request, request.actor!, { action: "CHARACTER_CREATED", targetType: "CHARACTER", targetId: result.rows[0]!.id, after: result.rows[0] });
      return { statusCode: 201, body: mapCharacter(result.rows[0]!), resourceType: "CHARACTER", resourceId: result.rows[0]!.id };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.patch("/v1/admin/characters/:characterId", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const id = uuidInput((request.params as Record<string, unknown>).characterId, "characterId"); const input = characterInput(request.body);
    if (!input.expectedVersion) throw badRequest("expectedVersion 값이 필요합니다.");
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "CHARACTER", id }, work: async (client) => {
      const before = await client.query<CharacterRow>("SELECT * FROM catalog_characters WHERE id=$1 FOR UPDATE", [id]); if (!before.rowCount) throw notFound();
      const updated = await client.query<CharacterRow>(
        `UPDATE catalog_characters SET ip_id=$2,name=$3,aliases=$4,image_url=$5,is_active=$6,version=version+1
         WHERE id=$1 AND version=$7 RETURNING *`,
        [id,input.ipId,input.name,input.aliases,input.imageUrl || null,input.isActive,input.expectedVersion],
      );
      if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
      await writeAdminAudit(client, request, request.actor!, { action: "CHARACTER_UPDATED", targetType: "CHARACTER", targetId: id, before: before.rows[0], after: updated.rows[0] });
      return { statusCode: 200, body: mapCharacter(updated.rows[0]!), resourceType: "CHARACTER", resourceId: id };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.get("/v1/admin/products", { preHandler: context.auth.requirePermission("catalog.read") }, async (request) => {
    const query = requestQuery(request); const { limit, cursor } = pagination(query); const search = queryString(query.q);
    const category = query.category === undefined ? undefined : enumInput(query, "category", PRODUCT_CATEGORIES);
    const ipId = query.ipId === undefined ? undefined : slugIdInput(query.ipId, "ipId");
    const characterId = query.characterId === undefined ? undefined : uuidInput(query.characterId, "characterId");
    const prizeOnly = booleanQuery(query, "prizeOnly");
    const saleStatus = query.saleStatus === undefined
      ? undefined
      : enumInput(query, "saleStatus", PRODUCT_SALE_STATUSES);
    const values: unknown[] = [limit + 1]; const filters: string[] = [];
    if (search) { values.push(`%${search}%`); filters.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR COALESCE(p.manufacturer,'') ILIKE $${values.length})`); }
    if (category) { values.push(category); filters.push(`p.category=$${values.length}`); }
    if (ipId) { values.push(ipId); filters.push(`p.ip_id=$${values.length}`); }
    if (characterId) { values.push(characterId); filters.push(`EXISTS (SELECT 1 FROM product_characters pc_filter WHERE pc_filter.product_id=p.id AND pc_filter.character_id=$${values.length})`); }
    if (prizeOnly !== undefined) { values.push(prizeOnly); filters.push(`p.is_prize_only=$${values.length}`); }
    if (saleStatus) { values.push(saleStatus); filters.push(`p.sale_status=$${values.length}`); }
    if (cursor) { values.push(cursor.createdAt,cursor.id); filters.push(`(p.created_at,p.id)<($${values.length-1},$${values.length})`); }
    const result = await context.pool.query<ProductRow>(
      `SELECT p.*,COALESCE(s.on_hand-s.reserved,0) AS available_quantity,
         ${CATALOG_TOTAL_QUANTITY_SQL} AS total_quantity,
         COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id) FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids
       FROM catalog_products p LEFT JOIN product_stock s ON s.product_id=p.id
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY p.created_at DESC,p.id DESC LIMIT $1`, values,
    );
    return cursorPage(result.rows, limit, (row) => mapProduct(row, effectiveCommerceMode(context.config)));
  });

  app.get("/v1/admin/products/:productId", { preHandler: context.auth.requirePermission("catalog.read") }, async (request) => {
    const id = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const result = await context.pool.query<ProductRow>(
      `SELECT p.*,COALESCE(s.on_hand-s.reserved,0) AS available_quantity,
         ${CATALOG_TOTAL_QUANTITY_SQL} AS total_quantity,
         COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id) FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids
       FROM catalog_products p LEFT JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1`,
      [id],
    );
    if (!result.rowCount) throw notFound("상품을 찾을 수 없습니다.");
    return mapProduct(result.rows[0]!, effectiveCommerceMode(context.config));
  });

  app.post("/v1/admin/products", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const input = productInput(request.body); const id = input.id || input.sku.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!id) throw badRequest("상품 id를 생성할 수 없습니다.");
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "PRODUCT", id }, work: async (client) => {
      await assertCharactersBelongToIp(client, input.ipId, input.characterIds || []);
      const created = await client.query<ProductRow>(
        `INSERT INTO catalog_products (id,sku,ip_id,category,name,manufacturer,release_date,price,image_url,metadata,is_active,is_prize_only,sale_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT') RETURNING *, $13::integer AS available_quantity, $14::text[] AS character_ids`,
        [id,input.sku,input.ipId,input.category,input.name,input.manufacturer || null,input.releaseDate || null,input.price,input.imageUrl || null,JSON.stringify(input.metadata),input.isActive,input.isPrizeOnly ?? false,input.availableQuantity,input.characterIds || []],
      );
      await client.query("INSERT INTO product_stock (product_id,on_hand,reserved) VALUES ($1,$2,0)", [id,input.availableQuantity]);
      for (const characterId of input.characterIds || []) await client.query("INSERT INTO product_characters (product_id,character_id) VALUES ($1,$2)", [id,uuidInput(characterId,"characterId")]);
      const requestedSaleStatus = input.saleStatus ?? "DRAFT";
      await assertProductSaleStatusReady(client, {
        id,
        category: input.category,
        price: input.price,
        availableQuantity: input.availableQuantity,
        imageUrl: input.imageUrl ?? null,
        isActive: input.isActive,
        isPrizeOnly: input.isPrizeOnly ?? false,
        saleStatus: requestedSaleStatus,
      });
      const result = requestedSaleStatus === "DRAFT"
        ? created
        : await client.query<ProductRow>(
            `UPDATE catalog_products SET sale_status=$2
              WHERE id=$1
              RETURNING *, $3::integer AS available_quantity, $4::text[] AS character_ids`,
            [id, requestedSaleStatus, input.availableQuantity, input.characterIds || []],
          );
      await writeAdminAudit(client, request, request.actor!, { action: "PRODUCT_CREATED", targetType: "PRODUCT", targetId: id, after: result.rows[0] });
      await writeOutbox(client, request.id, { aggregateType: "PRODUCT", aggregateId: id, eventType: "catalog.product.created", payload: { id } });
      return {
        statusCode: 201,
        body: mapProduct(result.rows[0]!, effectiveCommerceMode(context.config)),
        resourceType: "PRODUCT",
        resourceId: id,
      };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.patch("/v1/admin/products/:productId", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const id = slugIdInput((request.params as Record<string, unknown>).productId, "productId"); const input = productInput(request.body);
    if (!input.expectedVersion) throw badRequest("expectedVersion 값이 필요합니다.");
    const mutation = await adminIdempotentMutation(context, request, { target: { type: "PRODUCT", id }, work: async (client) => {
      const before = await client.query<ProductRow>(
        `SELECT p.*,s.on_hand-s.reserved AS available_quantity,
           COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id) FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids
         FROM catalog_products p JOIN product_stock s ON s.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p,s`, [id],
      );
      if (!before.rowCount) throw notFound();
      if (input.category !== before.rows[0]!.category) {
        throw conflict("판매·추첨 자산의 의미를 보존하기 위해 상품 카테고리는 생성 후 변경할 수 없습니다. 새 SKU를 등록해 주세요.");
      }
      if (input.isPrizeOnly !== undefined && input.isPrizeOnly !== before.rows[0]!.is_prize_only) {
        throw conflict("경품 전용 여부는 생성 후 변경할 수 없습니다. 새 SKU를 등록해 주세요.");
      }
      if (input.characterIds !== undefined) await assertCharactersBelongToIp(client, input.ipId, input.characterIds);
      const stock = await client.query<{ on_hand: number; reserved: number }>("SELECT on_hand,reserved FROM product_stock WHERE product_id=$1 FOR UPDATE", [id]);
      const currentAvailableQuantity = numberValue(stock.rows[0]?.on_hand) - numberValue(stock.rows[0]?.reserved);
      if (input.availableQuantity !== currentAvailableQuantity) {
        throw conflict("상품 수정에서는 재고를 변경할 수 없습니다. 재고 운영의 불변 조정 원장을 사용해 주세요.");
      }
      if (["gacha","kuji"].includes(input.category)) {
        const activeVersion = await client.query<{ id: string }>("SELECT id FROM draw_probability_versions WHERE product_id=$1 AND status='ACTIVE' FOR UPDATE", [id]);
        if (activeVersion.rowCount) await assertDrawCapacity(client, {
          probabilityVersionId: activeVersion.rows[0]!.id,
          productId: id,
          onHand: numberValue(stock.rows[0]!.on_hand),
        });
      }
      const requestedSaleStatus = input.saleStatus ?? before.rows[0]!.sale_status;
      await assertProductSaleStatusReady(client, {
        id,
        category: input.category,
        price: input.price,
        availableQuantity: currentAvailableQuantity,
        imageUrl: input.imageUrl ?? null,
        storefrontImageUrl: before.rows[0]!.storefront_image_url,
        isActive: input.isActive,
        isPrizeOnly: before.rows[0]!.is_prize_only,
        saleStatus: requestedSaleStatus,
      });
      const updated = await client.query<ProductRow>(
        `UPDATE catalog_products SET sku=$2,ip_id=$3,category=$4,name=$5,manufacturer=$6,release_date=$7,price=$8,image_url=$9,metadata=$10,is_active=$11,sale_status=$12,version=version+1
         WHERE id=$1 AND version=$13 RETURNING *, $14::integer AS available_quantity, COALESCE($15::text[], $16::text[]) AS character_ids`,
        [id,input.sku,input.ipId,input.category,input.name,input.manufacturer || null,input.releaseDate || null,input.price,input.imageUrl || null,JSON.stringify(input.metadata),input.isActive,requestedSaleStatus,input.expectedVersion,input.availableQuantity,input.characterIds || null,before.rows[0]!.character_ids],
      );
      if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
      if (input.characterIds !== undefined) {
        await client.query("DELETE FROM product_characters WHERE product_id=$1", [id]);
        for (const characterId of input.characterIds) await client.query("INSERT INTO product_characters (product_id,character_id) VALUES ($1,$2)", [id,uuidInput(characterId,"characterId")]);
      }
      await writeAdminAudit(client, request, request.actor!, { action: "PRODUCT_UPDATED", targetType: "PRODUCT", targetId: id, before: before.rows[0], after: updated.rows[0] });
      return {
        statusCode: 200,
        body: mapProduct(updated.rows[0]!, effectiveCommerceMode(context.config)),
        resourceType: "PRODUCT",
        resourceId: id,
      };
    }});
    return sendAdminMutation(reply, mutation);
  });

  app.get("/v1/admin/catalog-requests", { preHandler: context.auth.requirePermission("catalog.read") }, async (request) => {
    const query = requestQuery(request); const { limit,cursor }=pagination(query);
    const status=query.status===undefined?undefined:enumInput(query,"status",REQUEST_STATUSES); const kind=query.kind===undefined?undefined:enumInput(query,"kind",["PRODUCT","IP"] as const);const search=queryString(query.q);const values:unknown[]=[limit+1]; const filters:string[]=[];
    if(status){values.push(status);filters.push(`status=$${values.length}`);}if(kind){values.push(kind);filters.push(`kind=$${values.length}`);}if(search){values.push(`%${search}%`);filters.push(`(name ILIKE $${values.length} OR COALESCE(description,'') ILIKE $${values.length})`);} if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(created_at,id)<($${values.length-1},$${values.length})`);}
    const result=await context.pool.query<CatalogRequestRow>(`SELECT * FROM catalog_requests ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY created_at DESC,id DESC LIMIT $1`,values);
    return cursorPage(result.rows,limit,mapCatalogRequest);
  });

  app.post("/v1/admin/catalog-requests/:requestId/decision", { preHandler: context.auth.requirePermission("catalog.write") }, async (request, reply) => {
    const id=uuidInput((request.params as Record<string,unknown>).requestId,"requestId"); const body=objectInput(request.body);
    const decision=enumInput(body,"decision",["APPROVED","REJECTED","ON_HOLD","MERGED"] as const)!; const reason=stringInput(body,"reason",{max:1000})!;
    const canonicalTargetValue=nullableStringInput(body,"canonicalTargetId",{max:120});const canonicalTargetId=canonicalTargetValue?slugIdInput(canonicalTargetValue,"canonicalTargetId"):null;
    if((decision==="APPROVED"||decision==="MERGED")&&!canonicalTargetId) throw badRequest("승인 또는 병합할 기존 대상을 선택해 주세요.");if(!["APPROVED","MERGED"].includes(decision)&&canonicalTargetId)throw badRequest("거절 또는 보류 처리에는 병합 대상을 지정할 수 없습니다.");
    const mutation=await adminIdempotentMutation(context,request,{target:{type:"CATALOG_REQUEST",id},bodyReason:reason,work:async(client)=>{
      const before=await client.query<CatalogRequestRow>("SELECT * FROM catalog_requests WHERE id=$1 FOR UPDATE",[id]); if(!before.rowCount)throw notFound();
      if(!["PENDING","ON_HOLD"].includes(before.rows[0]!.status))throw conflict();
      if(canonicalTargetId){const target=before.rows[0]!.kind==="PRODUCT"?await client.query<{is_active:boolean}>("SELECT p.is_active AND NOT p.is_prize_only AND i.is_active AS is_active FROM catalog_products p JOIN catalog_ips i ON i.id=p.ip_id WHERE p.id=$1 FOR SHARE OF p,i",[canonicalTargetId]):await client.query<{is_active:boolean}>("SELECT is_active FROM catalog_ips WHERE id=$1 FOR SHARE",[canonicalTargetId]);if(!target.rowCount)throw badRequest("승인 또는 병합 대상을 찾을 수 없습니다.");if(!target.rows[0]!.is_active)throw conflict("사용자 검색에 노출되는 활성 정규 대상만 승인 또는 병합할 수 있습니다.");}
      const updated=await client.query<CatalogRequestRow>(
        `UPDATE catalog_requests SET status=$2,canonical_target_id=$3,decision_reason=$4,decided_by=$5,decided_at=now() WHERE id=$1 RETURNING *`,
        [id,decision,canonicalTargetId||null,reason,request.actor!.userId],
      );
      await writeAdminAudit(client,request,request.actor!,{action:"CATALOG_REQUEST_DECIDED",targetType:"CATALOG_REQUEST",targetId:id,reason,before:before.rows[0],after:updated.rows[0]});
      await writeOutbox(client,request.id,{aggregateType:"CATALOG_REQUEST",aggregateId:id,eventType:"catalog.request.decided",payload:{userId:before.rows[0]!.user_id,decision,canonicalTargetId:canonicalTargetId||null}});
      return{statusCode:200,body:mapCatalogRequest(updated.rows[0]!),resourceType:"CATALOG_REQUEST",resourceId:id};
    }});return sendAdminMutation(reply,mutation);
  });
}
