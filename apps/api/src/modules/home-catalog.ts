import type { FastifyInstance } from "fastify";
import { withTransaction, type DatabaseClient } from "@dabboba/db";
import type { ProductCategoryId } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { booleanInput, integerInput, objectInput, slugIdInput, stringInput } from "../lib/input.js";
import { iso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const HOME_SECTION_PRODUCT_LIMIT = 20;

type HomeCatalogSectionRow = {
  id: string;
  title: string;
  ip_id: string;
  sort_order: number;
  is_active: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicHomeCatalogSectionRow = HomeCatalogSectionRow & {
  ip_slug: string;
  ip_name_ko: string;
  ip_name_en: string;
  ip_name_ja: string | null;
  ip_aliases: string[];
  ip_description: string;
  ip_image_url: string | null;
  ip_is_active: boolean;
  ip_version: number;
  ip_created_at: Date | string;
  ip_updated_at: Date | string;
};

type HomeCatalogProductRow = {
  id: string;
  sku: string;
  ip_id: string;
  category: ProductCategoryId;
  name: string;
  manufacturer: string | null;
  release_date: string | null;
  price: number | string;
  available_quantity: number | string;
  metadata: Record<string, unknown>;
  image_url: string | null;
  is_active: boolean;
  is_prize_only: boolean;
  character_ids: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const mapAdminSection = (row: HomeCatalogSectionRow) => ({
  id: row.id,
  title: row.title,
  ipId: row.ip_id,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapIp = (row: PublicHomeCatalogSectionRow) => ({
  id: row.ip_id,
  slug: row.ip_slug,
  nameKo: row.ip_name_ko,
  nameEn: row.ip_name_en,
  nameJa: row.ip_name_ja,
  aliases: row.ip_aliases,
  description: row.ip_description,
  imageUrl: row.ip_image_url,
  isActive: row.ip_is_active,
  version: row.ip_version,
  createdAt: iso(row.ip_created_at),
  updatedAt: iso(row.ip_updated_at),
});

const mapProduct = (row: HomeCatalogProductRow) => ({
  id: row.id,
  sku: row.sku,
  ipId: row.ip_id,
  characterIds: row.character_ids,
  category: row.category,
  name: row.name,
  manufacturer: row.manufacturer,
  releaseDate: row.release_date,
  price: numberValue(row.price),
  availableQuantity: numberValue(row.available_quantity),
  metadata: row.metadata,
  imageUrl: row.image_url,
  isActive: row.is_active,
  isPrizeOnly: row.is_prize_only,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

function sectionInput(body: unknown, includeId: boolean) {
  const input = objectInput(body);
  return {
    id: includeId ? slugIdInput(input.id, "id") : undefined,
    title: stringInput(input, "title", { max: 120 })!,
    ipId: slugIdInput(stringInput(input, "ipId", { max: 120 })!, "ipId"),
    sortOrder: integerInput(input, "sortOrder", { min: 0, max: 2_147_483_647 })!,
    isActive: booleanInput(input, "isActive")!,
    expectedVersion: includeId
      ? undefined
      : integerInput(input, "expectedVersion", { min: 1, max: 2_147_483_647 }),
  };
}

async function assertCatalogIpExists(client: DatabaseClient, ipId: string) {
  const result = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1", [ipId]);
  if (!result.rowCount) throw badRequest("등록된 IP를 선택해 주세요.");
}

export async function registerHomeCatalogRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/catalog/home-sections", async () => withTransaction(context.pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const configuredResult = await client.query<{ configured: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM home_catalog_sections) AS configured",
    );
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
         JOIN catalog_ips i ON i.id=s.ip_id
         WHERE s.is_active = true AND i.is_active = true
         ORDER BY s.sort_order ASC, s.id ASC`,
    );

    if (!sectionResult.rowCount) {
      return { configured: configuredResult.rows[0]?.configured === true, items: [] };
    }

    const ipIds = sectionResult.rows.map((section) => section.ip_id);
    const productResult = await client.query<HomeCatalogProductRow>(
      `WITH ranked_products AS (
         SELECT p.*, COALESCE(s.on_hand-s.reserved,0) AS available_quantity,
           COALESCE((SELECT array_agg(pc.character_id::text ORDER BY pc.character_id)
                     FROM product_characters pc WHERE pc.product_id=p.id),'{}'::text[]) AS character_ids,
           row_number() OVER (PARTITION BY p.ip_id ORDER BY p.created_at DESC, p.id DESC) AS home_rank
         FROM catalog_products p
         LEFT JOIN product_stock s ON s.product_id=p.id
         WHERE p.ip_id=ANY($1::text[])
           AND p.is_active = true
           AND p.is_prize_only = false
           AND p.category IN ('gacha', 'kuji')
       )
       SELECT * FROM ranked_products
       WHERE home_rank <= $2
       ORDER BY ip_id ASC, created_at DESC, id DESC`,
      [ipIds, HOME_SECTION_PRODUCT_LIMIT],
    );
    const productsByIp = new Map<string, ReturnType<typeof mapProduct>[]>();
    for (const row of productResult.rows) {
      const products = productsByIp.get(row.ip_id) ?? [];
      products.push(mapProduct(row));
      productsByIp.set(row.ip_id, products);
    }

    const items = sectionResult.rows.flatMap((section) => {
      const products = productsByIp.get(section.ip_id) ?? [];
      if (!products.length) return [];
      return [{
        id: section.id,
        title: section.title,
        sortOrder: section.sort_order,
        isActive: section.is_active,
        version: section.version,
        createdAt: iso(section.created_at),
        updatedAt: iso(section.updated_at),
        ip: mapIp(section),
        products,
      }];
    });

    return { configured: configuredResult.rows[0]?.configured === true, items };
  }));

  app.get("/v1/admin/home-sections",
    { preHandler: context.auth.requirePermission("catalog.read") },
    async () => {
      const result = await context.pool.query<HomeCatalogSectionRow>(
        "SELECT * FROM home_catalog_sections ORDER BY sort_order ASC, id ASC",
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
          const result = await client.query<HomeCatalogSectionRow>(
            `INSERT INTO home_catalog_sections (id,title,ip_id,sort_order,is_active)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [id, input.title, input.ipId, input.sortOrder, input.isActive],
          );
          await writeAdminAudit(client, request, request.actor!, {
            action: "HOME_CATALOG_SECTION_CREATED",
            targetType: "HOME_CATALOG_SECTION",
            targetId: id,
            after: result.rows[0],
          });
          await writeOutbox(client, request.id, {
            aggregateType: "HOME_CATALOG_SECTION",
            aggregateId: id,
            eventType: "catalog.home_section.created",
            payload: { id, ipId: input.ipId },
          });
          return {
            statusCode: 201,
            body: mapAdminSection(result.rows[0]!),
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
            "SELECT * FROM home_catalog_sections WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (!before.rowCount) throw notFound();
          await assertCatalogIpExists(client, input.ipId);
          const updated = await client.query<HomeCatalogSectionRow>(
            `UPDATE home_catalog_sections
             SET title=$2,ip_id=$3,sort_order=$4,is_active=$5,version=version+1
             WHERE id=$1 AND version=$6 RETURNING *`,
            [id, input.title, input.ipId, input.sortOrder, input.isActive, input.expectedVersion],
          );
          if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
          await writeAdminAudit(client, request, request.actor!, {
            action: "HOME_CATALOG_SECTION_UPDATED",
            targetType: "HOME_CATALOG_SECTION",
            targetId: id,
            before: before.rows[0],
            after: updated.rows[0],
          });
          await writeOutbox(client, request.id, {
            aggregateType: "HOME_CATALOG_SECTION",
            aggregateId: id,
            eventType: "catalog.home_section.updated",
            payload: { id, ipId: input.ipId, isActive: input.isActive },
          });
          return {
            statusCode: 200,
            body: mapAdminSection(updated.rows[0]!),
            resourceType: "HOME_CATALOG_SECTION",
            resourceId: id,
          };
        },
      });
      return sendAdminMutation(reply, mutation);
    },
  );
}
