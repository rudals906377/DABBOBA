import type { FastifyInstance } from "fastify";
import type { ProductCategoryId } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  booleanInput,
  enumInput,
  integerInput,
  nullableStringInput,
  objectInput,
  stringInput,
} from "../lib/input.js";
import { iso } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

const PRODUCT_CATEGORIES = ["gacha", "figure", "kuji", "tcg"] as const;
const CATEGORY_AVAILABILITIES = ["active", "coming-soon", "hidden"] as const;

type CategoryAvailability = (typeof CATEGORY_AVAILABILITIES)[number];

type StorefrontCategorySettingRow = {
  category: ProductCategoryId;
  label: string;
  sort_order: number;
  availability: CategoryAvailability;
  show_on_home: boolean;
  show_on_catalog: boolean;
  show_on_exchange: boolean;
  show_on_wanted: boolean;
  description: string;
  image_url: string | null;
  icon_key: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const mapSetting = (row: StorefrontCategorySettingRow) => ({
  category: row.category,
  label: row.label,
  sortOrder: row.sort_order,
  availability: row.availability,
  showOnHome: row.show_on_home,
  showOnCatalog: row.show_on_catalog,
  showOnExchange: row.show_on_exchange,
  showOnWanted: row.show_on_wanted,
  description: row.description,
  imageUrl: row.image_url,
  iconKey: row.icon_key,
  version: row.version,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

function categoryParam(value: unknown): ProductCategoryId {
  if (typeof value !== "string" || !PRODUCT_CATEGORIES.includes(value as ProductCategoryId)) {
    throw badRequest("category 값을 확인해 주세요.");
  }
  return value as ProductCategoryId;
}

function optionalHttpUrl(value: string | null | undefined, field: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw badRequest(`${field} 값은 http 또는 https URL이어야 합니다.`);
  }
}

function settingInput(body: unknown) {
  const input = objectInput(body);
  const iconKey = nullableStringInput(input, "iconKey", { max: 80 });
  if (iconKey && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(iconKey)) {
    throw badRequest("iconKey 형식을 확인해 주세요.");
  }
  return {
    label: stringInput(input, "label", { max: 40 })!,
    sortOrder: integerInput(input, "sortOrder", { min: 0, max: 2_147_483_647 })!,
    availability: enumInput(input, "availability", CATEGORY_AVAILABILITIES)!,
    showOnHome: booleanInput(input, "showOnHome")!,
    showOnCatalog: booleanInput(input, "showOnCatalog")!,
    showOnExchange: booleanInput(input, "showOnExchange")!,
    showOnWanted: booleanInput(input, "showOnWanted")!,
    description: stringInput(input, "description", { min: 0, max: 240 })!,
    imageUrl: optionalHttpUrl(nullableStringInput(input, "imageUrl", { max: 2_000 }), "imageUrl"),
    iconKey: iconKey ?? null,
    expectedVersion: integerInput(input, "expectedVersion", { min: 1, max: 2_147_483_647 })!,
  };
}

export async function registerStorefrontCategoryRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/catalog/category-settings", async (_request, reply) => {
    const result = await context.pool.query<StorefrontCategorySettingRow>(
      "SELECT * FROM storefront_category_settings ORDER BY sort_order ASC, category ASC",
    );
    reply.header("cache-control", "no-store, max-age=0");
    return { items: result.rows.map(mapSetting) };
  });

  app.get("/v1/admin/category-settings",
    { preHandler: context.auth.requirePermission("catalog.read") },
    async () => {
      const result = await context.pool.query<StorefrontCategorySettingRow>(
        "SELECT * FROM storefront_category_settings ORDER BY sort_order ASC, category ASC",
      );
      return { items: result.rows.map(mapSetting) };
    },
  );

  app.patch("/v1/admin/category-settings/:category",
    { preHandler: context.auth.requirePermission("catalog.write") },
    async (request, reply) => {
      const category = categoryParam((request.params as Record<string, unknown>).category);
      const input = settingInput(request.body);
      const mutation = await adminIdempotentMutation(context, request, {
        target: { type: "STOREFRONT_CATEGORY_SETTING", id: category },
        work: async (client) => {
          const before = await client.query<StorefrontCategorySettingRow>(
            "SELECT * FROM storefront_category_settings WHERE category=$1 FOR UPDATE",
            [category],
          );
          if (!before.rowCount) throw notFound("카테고리 설정을 찾을 수 없습니다.");
          const updated = await client.query<StorefrontCategorySettingRow>(
            `UPDATE storefront_category_settings
             SET label=$2,sort_order=$3,availability=$4,
                 show_on_home=$5,show_on_catalog=$6,show_on_exchange=$7,show_on_wanted=$8,
                 description=$9,image_url=$10,icon_key=$11,version=version+1
             WHERE category=$1 AND version=$12
             RETURNING *`,
            [
              category,
              input.label,
              input.sortOrder,
              input.availability,
              input.showOnHome,
              input.showOnCatalog,
              input.showOnExchange,
              input.showOnWanted,
              input.description,
              input.imageUrl,
              input.iconKey,
              input.expectedVersion,
            ],
          );
          if (!updated.rowCount) throw conflict("다른 운영자가 먼저 카테고리 설정을 수정했습니다.");
          await writeAdminAudit(client, request, request.actor!, {
            action: "STOREFRONT_CATEGORY_SETTING_UPDATED",
            targetType: "STOREFRONT_CATEGORY_SETTING",
            targetId: category,
            before: before.rows[0],
            after: updated.rows[0],
          });
          await writeOutbox(client, request.id, {
            aggregateType: "STOREFRONT_CATEGORY_SETTING",
            aggregateId: category,
            eventType: "catalog.category_setting.updated",
            payload: { category, version: updated.rows[0]!.version },
          });
          return {
            statusCode: 200,
            body: mapSetting(updated.rows[0]!),
            resourceType: "STOREFRONT_CATEGORY_SETTING",
            resourceId: category,
          };
        },
      });
      return sendAdminMutation(reply, mutation);
    },
  );
}
