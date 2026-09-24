import type { FastifyInstance } from "fastify";
import { rebaseLegacyCatalogMediaUrl } from "./catalog-media-url.js";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import type { CommerceLaunchMode } from "@dabboba/config";
import type { ProductCategoryId, ProductSaleStatus } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  assertOnlyKeys,
  booleanInput,
  enumInput,
  integerInput,
  nullableStringInput,
  objectInput,
  slugIdInput,
  stringArrayInput,
  stringInput,
  uuidInput,
} from "../lib/input.js";
import { iso, numberValue } from "../lib/rows.js";
import { CATALOG_TOTAL_QUANTITY_SQL } from "../lib/catalog-total-quantity.js";
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
import { effectiveCommerceMode } from "../lib/commerce-mode.js";

const HOME_SECTION_PRODUCT_LIMIT = 20;
const HOME_RECENT_DRAW_LIMIT = 2;
const HOME_SECTION_SOURCE_KINDS = ["MANUAL", "IP", "NEW", "POPULAR"] as const;

type HomeCatalogSectionSourceKind = typeof HOME_SECTION_SOURCE_KINDS[number];

type HomeCatalogSectionRow = {
  id: string;
  title: string;
  subtitle: string | null;
  ip_id: string | null;
  layout_kind: "gacha" | "kuji" | null;
  source_kind: HomeCatalogSectionSourceKind;
  visible_limit: number;
  manual_product_ids?: string[];
  sort_order: number;
  is_active: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicHomeCatalogSectionRow = HomeCatalogSectionRow & {
  ip_slug: string | null;
  ip_name_ko: string | null;
  ip_name_en: string | null;
  ip_name_ja: string | null;
  ip_aliases: string[] | null;
  ip_description: string | null;
  ip_image_url: string | null;
  ip_is_active: boolean | null;
  ip_version: number | null;
  ip_created_at: Date | string | null;
  ip_updated_at: Date | string | null;
};

type HomeCatalogProductRow = {
  home_section_id: string;
  id: string;
  sku: string;
  ip_id: string;
  category: ProductCategoryId;
  name: string;
  manufacturer: string | null;
  release_date: string | null;
  price: number | string;
  available_quantity: number | string;
  total_quantity: number | string | null;
  metadata: Record<string, unknown>;
  image_url: string | null;
  storefront_image_url: string | null;
  is_active: boolean;
  is_prize_only: boolean;
  sale_status: ProductSaleStatus;
  character_ids: string[];
  remaining_kuji_tiers?: CatalogRemainingKujiTierRow[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type HomeRecentDrawRow = {
  id: string;
  product_id: string;
  category: "gacha" | "kuji";
  prize_name_snapshot: string;
  prize_image_url_snapshot: string | null;
  rarity: string;
  committed_at: Date | string;
};

const mapAdminSection = (row: HomeCatalogSectionRow) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  ipId: row.ip_id,
  layoutKind: row.layout_kind,
  sourceKind: row.source_kind,
  visibleLimit: row.visible_limit,
  manualProductIds: row.manual_product_ids ?? [],
  sortOrder: row.sort_order,
  isActive: row.is_active,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapIp = (row: PublicHomeCatalogSectionRow) => row.ip_id === null ? null : ({
  id: row.ip_id,
  slug: row.ip_slug!,
  nameKo: row.ip_name_ko!,
  nameEn: row.ip_name_en!,
  nameJa: row.ip_name_ja,
  aliases: row.ip_aliases!,
  description: row.ip_description!,
  imageUrl: row.ip_image_url,
  isActive: row.ip_is_active!,
  version: row.ip_version!,
  createdAt: iso(row.ip_created_at!),
  updatedAt: iso(row.ip_updated_at!),
});

function productBlockedReason(row: HomeCatalogProductRow, commerceMode: CommerceLaunchMode) {
  if (row.sale_status === "DRAFT") return "DRAFT" as const;
  if (row.sale_status === "COMING_SOON") return "COMING_SOON" as const;
  if (row.sale_status === "PAUSED") return "PAUSED" as const;
  if (commerceMode !== "LIVE") return "COMMERCE_PRELAUNCH" as const;
  if (numberValue(row.available_quantity) <= 0) return "OUT_OF_STOCK" as const;
  return null;
}

const mapProduct = (row: HomeCatalogProductRow, commerceMode: CommerceLaunchMode) => {
  const discloseInventory = commerceMode === "LIVE" && row.sale_status === "ON_SALE";
  return {
    id: row.id,
    sku: row.sku,
    ipId: row.ip_id,
    characterIds: row.character_ids,
    category: row.category,
    name: row.name,
    manufacturer: row.manufacturer,
    releaseDate: row.release_date,
    price: numberValue(row.price) > 0 ? numberValue(row.price) : null,
    availableQuantity: discloseInventory ? numberValue(row.available_quantity) : 0,
    totalQuantity: discloseInventory && row.total_quantity !== null
      ? numberValue(row.total_quantity)
      : null,
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
      remainingKujiTiers: (discloseInventory ? row.remaining_kuji_tiers : []).map((tier) => ({
        tierCode: tier.tierCode,
        tierRank: numberValue(tier.tierRank),
        label: tier.label,
        initialQuantity: numberValue(tier.initialQuantity),
        remainingQuantity: numberValue(tier.remainingQuantity),
      })),
    }),
  };
};

const mapHomeRecentDraw = (row: HomeRecentDrawRow, catalogMediaBaseUrl: string | null | undefined) => ({
  id: row.id,
  productId: row.product_id,
  category: row.category,
  prizeName: row.prize_name_snapshot,
  prizeImageUrl: rebaseLegacyCatalogMediaUrl(catalogMediaBaseUrl, row.prize_image_url_snapshot),
  rarity: row.rarity,
  committedAt: iso(row.committed_at),
});

async function homeRecentDrawActivity(client: Pick<DatabaseClient, "query">, demo: boolean, catalogMediaBaseUrl: string | null | undefined) {
  const result = await client.query<HomeRecentDrawRow>(
    `SELECT result.id,result.product_id,draw_product.category,
            pool_entry.prize_name_snapshot,pool_entry.prize_image_url_snapshot,
            pool_entry.rarity,result.committed_at
       FROM draw_results result
       JOIN draw_pool_entries pool_entry ON pool_entry.id=result.pool_entry_id
       JOIN catalog_products draw_product ON draw_product.id=result.product_id
       JOIN catalog_ips ip ON ip.id=draw_product.ip_id
       JOIN storefront_category_settings category_setting ON category_setting.category=draw_product.category
      WHERE draw_product.is_active=true
        AND draw_product.is_prize_only=false
        AND draw_product.category IN ('gacha','kuji')
        AND ip.is_active=true
        AND category_setting.availability='active'
        AND category_setting.show_on_home=true
        AND ($1::text IS NULL OR (
          draw_product.metadata->>'catalogGeneration'=$1 AND draw_product.id=ANY($2::text[])
        ))
      ORDER BY result.committed_at DESC,result.id DESC
      LIMIT $3`,
    [demo ? CUSTOMER_CATALOG_GENERATION : null, [...DEMO_SELLER_PRODUCT_IDS], HOME_RECENT_DRAW_LIMIT],
  );
  return result.rows.map((row) => mapHomeRecentDraw(row, catalogMediaBaseUrl));
}

async function homeProductBadgeState(client: DatabaseClient, demo: boolean) {
  const result = await client.query<{ product_id: string }>(
    `SELECT click_event.product_id
       FROM home_product_click_events click_event
       JOIN catalog_products product ON product.id=click_event.product_id
       JOIN catalog_ips ip ON ip.id=product.ip_id
       JOIN storefront_category_settings category_setting ON category_setting.category=product.category
      WHERE product.is_active=true
        AND product.is_prize_only=false
        AND product.sale_status IN ('COMING_SOON','ON_SALE')
        AND product.category IN ('gacha','kuji')
        AND ip.is_active=true
        AND category_setting.availability='active'
        AND category_setting.show_on_home=true
        AND click_event.created_at >= now() - interval '30 days'
        AND ($1::text IS NULL OR (
          product.metadata->>'catalogGeneration'=$1 AND product.id=ANY($2::text[])
        ))
      GROUP BY click_event.product_id
      ORDER BY count(*) DESC, click_event.product_id ASC
      LIMIT 1`,
    [demo ? CUSTOMER_CATALOG_GENERATION : null, [...DEMO_SELLER_PRODUCT_IDS]],
  );
  return {
    bestProductId: result.rows[0]?.product_id ?? null,
    evaluatedAt: new Date().toISOString(),
  };
}

function sectionInput(body: unknown, includeId: boolean) {
  const input = objectInput(body);
  assertOnlyKeys(input, [
    ...(includeId ? ["id"] : ["expectedVersion"]),
    "title",
    "subtitle",
    "ipId",
    "layoutKind",
    "sourceKind",
    "visibleLimit",
    "manualProductIds",
    "sortOrder",
    "isActive",
  ]);
  const subtitle = nullableStringInput(input, "subtitle", { max: 240 });
  if (subtitle === undefined) throw badRequest("subtitle 값이 필요합니다.");
  const rawIpId = nullableStringInput(input, "ipId", { max: 120 });
  if (rawIpId === undefined) throw badRequest("ipId 값이 필요합니다.");
  const ipId = rawIpId === null ? null : slugIdInput(rawIpId, "ipId");
  const sourceKind = enumInput(input, "sourceKind", HOME_SECTION_SOURCE_KINDS)!;
  const manualProductIds = stringArrayInput(input, "manualProductIds", HOME_SECTION_PRODUCT_LIMIT)!
    .map((productId) => slugIdInput(productId, "manualProductIds"));
  if (new Set(manualProductIds).size !== manualProductIds.length) {
    throw badRequest("수동 상품은 중복해서 선택할 수 없습니다.");
  }
  if (sourceKind === "IP" && ipId === null) {
    throw badRequest("IP 자동 구성은 등록된 IP가 필요합니다.");
  }
  if (sourceKind !== "MANUAL" && manualProductIds.length > 0) {
    throw badRequest("수동 상품 순서는 수동 구성에서만 사용할 수 있습니다.");
  }
  return {
    id: includeId ? slugIdInput(input.id, "id") : undefined,
    title: stringInput(input, "title", { max: 120 })!,
    subtitle,
    ipId,
    layoutKind: enumInput(input, "layoutKind", ["gacha", "kuji"] as const)!,
    sourceKind,
    visibleLimit: integerInput(input, "visibleLimit", { min: 1, max: HOME_SECTION_PRODUCT_LIMIT })!,
    manualProductIds,
    sortOrder: integerInput(input, "sortOrder", { min: 0, max: 2_147_483_647 })!,
    isActive: booleanInput(input, "isActive")!,
    expectedVersion: includeId
      ? undefined
      : integerInput(input, "expectedVersion", { min: 1, max: 2_147_483_647 }),
  };
}

async function assertCatalogIpExists(client: DatabaseClient, ipId: string | null) {
  if (ipId === null) return;
  const result = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1", [ipId]);
  if (!result.rowCount) throw badRequest("등록된 IP를 선택해 주세요.");
}

async function assertManualProductsMatchSection(
  client: DatabaseClient,
  input: {
    sourceKind: HomeCatalogSectionSourceKind;
    manualProductIds: string[];
    layoutKind: "gacha" | "kuji";
    ipId: string | null;
  },
) {
  if (input.sourceKind !== "MANUAL" || input.manualProductIds.length === 0) return;
  const result = await client.query<{ id: string; ip_id: string; category: ProductCategoryId }>(
    `SELECT id,ip_id,category
       FROM catalog_products
      WHERE id=ANY($1::text[])`,
    [input.manualProductIds],
  );
  const productById = new Map(result.rows.map((product) => [product.id, product]));
  for (const productId of input.manualProductIds) {
    const product = productById.get(productId);
    if (!product) throw badRequest(`등록된 상품을 찾을 수 없습니다: ${productId}`);
    if (product.category !== input.layoutKind) {
      throw badRequest("수동 상품은 섹션 상품 유형과 같아야 합니다.");
    }
    if (input.ipId !== null && product.ip_id !== input.ipId) {
      throw badRequest("수동 상품은 선택한 IP에 속해야 합니다.");
    }
  }
}

async function replaceManualProducts(client: DatabaseClient, sectionId: string, productIds: string[]) {
  await client.query("DELETE FROM home_catalog_section_products WHERE section_id=$1", [sectionId]);
  if (productIds.length === 0) return;
  await client.query(
    `INSERT INTO home_catalog_section_products(section_id,product_id,sort_order)
     SELECT $1,ordered.product_id,(ordered.ordinality - 1)::smallint
       FROM unnest($2::text[]) WITH ORDINALITY AS ordered(product_id,ordinality)`,
    [sectionId, productIds],
  );
}

export async function registerHomeCatalogRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/catalog/recent-draws", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const demo = demoProfileRequested();
    return withTransaction(context.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return {
        serverNow: new Date().toISOString(),
        items: await homeRecentDrawActivity(client, demo, context.config.catalogMediaBaseUrl),
      };
    });
  });

  app.get("/v1/catalog/home-sections", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const commerceMode = effectiveCommerceMode(context.config);
    return withTransaction(context.pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const demo = demoProfileRequested();
    const configuredResult = await client.query<{
      configured: boolean;
      supports_section_sources: boolean;
    }>(
        `SELECT
           EXISTS (
             SELECT 1 FROM home_catalog_sections
             WHERE $1::text IS NULL OR ip_id=$1
           ) AS configured,
           (
             SELECT count(*)=4
               FROM information_schema.columns
              WHERE table_schema='public'
                AND table_name='home_catalog_sections'
                AND column_name IN ('layout_kind','subtitle','source_kind','visible_limit')
           ) AS supports_section_sources`,
        [null],
    );
    if (configuredResult.rows[0]?.supports_section_sources !== true) {
      return {
        configured: configuredResult.rows[0]?.configured === true,
        items: [],
        bestProductId: null,
        evaluatedAt: new Date().toISOString(),
      };
    }
    const badges = await homeProductBadgeState(client, demo);
    const sectionResult = await client.query<PublicHomeCatalogSectionRow>(
        `SELECT s.*,
           i.slug AS ip_slug,
           i.name_ko AS ip_name_ko,
           i.name_en AS ip_name_en,
           i.name_ja AS ip_name_ja,
           i.aliases AS ip_aliases,
           i.description AS ip_description,
           i.image_url AS ip_image_url,
           i.is_active AS ip_is_active,
           i.version AS ip_version,
           i.created_at AS ip_created_at,
           i.updated_at AS ip_updated_at
         FROM home_catalog_sections s
         LEFT JOIN catalog_ips i ON i.id=s.ip_id
         WHERE s.is_active = true
           AND (s.ip_id IS NULL OR i.is_active = true)
           AND s.layout_kind IS NOT NULL
           AND (s.source_kind <> 'IP' OR s.ip_id IS NOT NULL)
           AND ($1::text IS NULL OR s.ip_id=$1)
         ORDER BY s.sort_order ASC, s.id ASC`,
        [null],
    );

    if (!sectionResult.rowCount) {
      return { configured: configuredResult.rows[0]?.configured === true, items: [], ...badges };
    }

    const sectionIds = sectionResult.rows.map((section) => section.id);
    const ipIds = sectionResult.rows.map((section) => section.ip_id);
    const layoutKinds = sectionResult.rows.map((section) => section.layout_kind!);
    const sourceKinds = sectionResult.rows.map((section) => section.source_kind);
    const visibleLimits = sectionResult.rows.map((section) => section.visible_limit);
    const productResult = await client.query<HomeCatalogProductRow>(
      `WITH section_targets AS (
         SELECT *
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::integer[])
                AS section_target(section_id, ip_id, layout_kind, source_kind, visible_limit)
       ), candidate_products AS (
         SELECT section_target.section_id AS home_section_id,
           section_target.source_kind,
           section_target.visible_limit,
           p.*, COALESCE(s.on_hand-s.reserved,0) AS available_quantity,
           ${CATALOG_TOTAL_QUANTITY_SQL} AS total_quantity,
           ${CATALOG_REMAINING_KUJI_TIERS_SQL} AS remaining_kuji_tiers,
           COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id)
                     FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids,
           manual_product.sort_order AS manual_sort_order,
           COALESCE((
             SELECT count(*)
               FROM home_product_click_events click_event
              WHERE click_event.product_id=p.id
                AND click_event.created_at >= now() - interval '30 days'
           ),0) AS popularity_score
         FROM section_targets section_target
         JOIN catalog_products p
           ON p.category=section_target.layout_kind
         JOIN catalog_ips product_ip
           ON product_ip.id=p.ip_id
          AND product_ip.is_active=true
         JOIN storefront_category_settings category_setting
           ON category_setting.category=p.category
         LEFT JOIN product_stock s ON s.product_id=p.id
         LEFT JOIN home_catalog_section_products manual_product
           ON manual_product.section_id=section_target.section_id
          AND manual_product.product_id=p.id
         WHERE p.is_active = true
           AND p.is_prize_only = false
           AND p.sale_status IN ('COMING_SOON','ON_SALE')
           AND (section_target.ip_id IS NULL OR p.ip_id=section_target.ip_id)
           AND (
             section_target.source_kind IN ('IP','POPULAR')
             OR (section_target.source_kind='NEW' AND p.created_at >= now() - interval '30 days')
             OR (section_target.source_kind='MANUAL' AND manual_product.product_id IS NOT NULL)
           )
           AND category_setting.availability='active'
           AND category_setting.show_on_home=true
           AND (p.sale_status <> 'ON_SALE' OR EXISTS (
             SELECT 1 FROM draw_probability_versions active_version
              WHERE active_version.product_id=p.id AND active_version.status='ACTIVE'
           ))
           AND ($6::text IS NULL OR (
             p.metadata->>'catalogGeneration'=$6 AND p.id=ANY($7::text[])
           ))
       ), ranked_products AS (
         SELECT candidate_product.*,
           row_number() OVER (
             PARTITION BY candidate_product.home_section_id
             ORDER BY
               CASE WHEN candidate_product.source_kind='MANUAL' THEN candidate_product.manual_sort_order END ASC NULLS LAST,
               CASE WHEN candidate_product.source_kind='POPULAR' THEN candidate_product.popularity_score END DESC NULLS LAST,
               candidate_product.created_at DESC,
               candidate_product.id DESC
           ) AS home_rank
         FROM candidate_products candidate_product
       )
       SELECT * FROM ranked_products
       WHERE home_rank <= visible_limit
       ORDER BY home_section_id ASC, home_rank ASC`,
      [
        sectionIds,
        ipIds,
        layoutKinds,
        sourceKinds,
        visibleLimits,
        demo ? CUSTOMER_CATALOG_GENERATION : null,
        [...DEMO_SELLER_PRODUCT_IDS],
      ],
    );
    const productsBySection = new Map<string, ReturnType<typeof mapProduct>[]>();
    for (const row of productResult.rows) {
      const products = productsBySection.get(row.home_section_id) ?? [];
      products.push(mapProduct(row, commerceMode));
      productsBySection.set(row.home_section_id, products);
    }

    const items = sectionResult.rows.flatMap((section) => {
      const products = productsBySection.get(section.id) ?? [];
      if (!products.length) return [];
      return [{
        id: section.id,
        title: section.title,
        subtitle: section.subtitle,
        layoutKind: section.layout_kind!,
        sourceKind: section.source_kind,
        visibleLimit: section.visible_limit,
        sortOrder: section.sort_order,
        isActive: section.is_active,
        version: section.version,
        createdAt: iso(section.created_at),
        updatedAt: iso(section.updated_at),
        ip: mapIp(section),
        products,
      }];
    });

      return { configured: configuredResult.rows[0]?.configured === true, items, ...badges };
    });
  });

  app.post("/v1/catalog/home-product-clicks/:productId", async (request) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const body = objectInput(request.body);
    assertOnlyKeys(body, ["eventId"]);
    const eventId = uuidInput(body.eventId, "eventId");
    const demo = demoProfileRequested();

    return withTransaction(context.pool, async (client) => {
      const product = await client.query<{ id: string }>(
        `SELECT product.id
           FROM catalog_products product
           JOIN catalog_ips ip ON ip.id=product.ip_id
           JOIN storefront_category_settings category_setting ON category_setting.category=product.category
          WHERE product.id=$1
            AND product.is_active=true
            AND product.is_prize_only=false
            AND product.sale_status IN ('COMING_SOON','ON_SALE')
            AND product.category IN ('gacha','kuji')
            AND ip.is_active=true
            AND category_setting.availability='active'
            AND category_setting.show_on_home=true
            AND ($2::text IS NULL OR (
              product.metadata->>'catalogGeneration'=$2 AND product.id=ANY($3::text[])
            ))`,
        [productId, demo ? CUSTOMER_CATALOG_GENERATION : null, [...DEMO_SELLER_PRODUCT_IDS]],
      );
      if (!product.rowCount) throw notFound("홈에서 볼 수 있는 상품을 찾을 수 없습니다.");

      const inserted = await client.query<{ product_id: string }>(
        `INSERT INTO home_product_click_events(id,product_id)
         VALUES($1,$2)
         ON CONFLICT (id) DO NOTHING
         RETURNING product_id`,
        [eventId, productId],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<{ product_id: string }>(
          "SELECT product_id FROM home_product_click_events WHERE id=$1",
          [eventId],
        );
        if (existing.rows[0]?.product_id !== productId) {
          throw conflict("같은 클릭 기록 번호를 다른 상품에 사용할 수 없습니다.");
        }
      }

      return homeProductBadgeState(client, demo);
    });
  });

  app.get("/v1/admin/home-sections",
    { preHandler: context.auth.requirePermission("catalog.read") },
    async () => {
      const result = await context.pool.query<HomeCatalogSectionRow>(
        `SELECT section.*,
           COALESCE((
             SELECT array_agg(manual_product.product_id ORDER BY manual_product.sort_order)
               FROM home_catalog_section_products manual_product
              WHERE manual_product.section_id=section.id
           ),'{}'::text[]) AS manual_product_ids
         FROM home_catalog_sections section
         ORDER BY section.sort_order ASC, section.id ASC`,
      );
      return { configured: Boolean(result.rowCount), items: result.rows.map(mapAdminSection) };
    },
  );

  app.post("/v1/admin/home-sections",
    { preHandler: context.auth.requirePermission("catalog.write") },
    async (request, reply) => {
      const input = sectionInput(request.body, true);
      const id = input.id!;
      const mutation = await adminIdempotentMutation(context, request, {
        target: { type: "HOME_CATALOG_SECTION", id },
        work: async (client) => {
          await assertCatalogIpExists(client, input.ipId);
          await assertManualProductsMatchSection(client, input);
          const result = await client.query<HomeCatalogSectionRow>(
            `INSERT INTO home_catalog_sections
               (id,title,subtitle,ip_id,layout_kind,source_kind,visible_limit,sort_order,is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              input.title,
              input.subtitle,
              input.ipId,
              input.layoutKind,
              input.sourceKind,
              input.visibleLimit,
              input.sortOrder,
              input.isActive,
            ],
          );
          await replaceManualProducts(client, id, input.manualProductIds);
          const after = { ...result.rows[0]!, manual_product_ids: input.manualProductIds };
          await writeAdminAudit(client, request, request.actor!, {
            action: "HOME_CATALOG_SECTION_CREATED",
            targetType: "HOME_CATALOG_SECTION",
            targetId: id,
            after,
          });
          await writeOutbox(client, request.id, {
            aggregateType: "HOME_CATALOG_SECTION",
            aggregateId: id,
            eventType: "catalog.home_section.created",
            payload: {
              id,
              ipId: input.ipId,
              layoutKind: input.layoutKind,
              sourceKind: input.sourceKind,
              visibleLimit: input.visibleLimit,
            },
          });
          return {
            statusCode: 201,
            body: mapAdminSection(after),
            resourceType: "HOME_CATALOG_SECTION",
            resourceId: id,
          };
        },
      });
      return sendAdminMutation(reply, mutation);
    },
  );

  app.patch("/v1/admin/home-sections/:sectionId",
    { preHandler: context.auth.requirePermission("catalog.write") },
    async (request, reply) => {
      const id = slugIdInput((request.params as Record<string, unknown>).sectionId, "sectionId");
      const input = sectionInput(request.body, false);
      if (!input.expectedVersion) throw badRequest("expectedVersion 값이 필요합니다.");
      const mutation = await adminIdempotentMutation(context, request, {
        target: { type: "HOME_CATALOG_SECTION", id },
        work: async (client) => {
          const before = await client.query<HomeCatalogSectionRow>(
            `SELECT section.*,
               COALESCE((
                 SELECT array_agg(manual_product.product_id ORDER BY manual_product.sort_order)
                   FROM home_catalog_section_products manual_product
                  WHERE manual_product.section_id=section.id
               ),'{}'::text[]) AS manual_product_ids
             FROM home_catalog_sections section
             WHERE section.id=$1
             FOR UPDATE OF section`,
            [id],
          );
          if (!before.rowCount) throw notFound();
          await assertCatalogIpExists(client, input.ipId);
          await assertManualProductsMatchSection(client, input);
          const updated = await client.query<HomeCatalogSectionRow>(
            `UPDATE home_catalog_sections
             SET title=$2,subtitle=$3,ip_id=$4,layout_kind=$5,source_kind=$6,
                 visible_limit=$7,sort_order=$8,is_active=$9,version=version+1
             WHERE id=$1 AND version=$10 RETURNING *`,
            [
              id,
              input.title,
              input.subtitle,
              input.ipId,
              input.layoutKind,
              input.sourceKind,
              input.visibleLimit,
              input.sortOrder,
              input.isActive,
              input.expectedVersion,
            ],
          );
          if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
          await replaceManualProducts(client, id, input.manualProductIds);
          const after = { ...updated.rows[0]!, manual_product_ids: input.manualProductIds };
          await writeAdminAudit(client, request, request.actor!, {
            action: "HOME_CATALOG_SECTION_UPDATED",
            targetType: "HOME_CATALOG_SECTION",
            targetId: id,
            before: before.rows[0],
            after,
          });
          await writeOutbox(client, request.id, {
            aggregateType: "HOME_CATALOG_SECTION",
            aggregateId: id,
            eventType: "catalog.home_section.updated",
            payload: {
              id,
              ipId: input.ipId,
              layoutKind: input.layoutKind,
              sourceKind: input.sourceKind,
              visibleLimit: input.visibleLimit,
              isActive: input.isActive,
            },
          });
          return {
            statusCode: 200,
            body: mapAdminSection(after),
            resourceType: "HOME_CATALOG_SECTION",
            resourceId: id,
          };
        },
      });
      return sendAdminMutation(reply, mutation);
    },
  );
}
