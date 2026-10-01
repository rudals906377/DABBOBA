import type { FastifyInstance } from "fastify";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { enumInput, integerInput, objectInput, slugIdInput, stringInput, uuidInput } from "../lib/input.js";
import type { ApiContext } from "../types.js";
import { legacyCatalogMediaDeliveryUrl } from "./catalog-media-url.js";
import { signMediaAsset, type MediaRow } from "./media.js";

type CatalogMediaMetadata = Record<string, unknown> & { catalogDeliveryUrl?: unknown };
type ProductImageRole = "primary" | "storefront" | "gallery";
type ProductImageRow = {
  id: string;
  category: string;
  image_url: string | null;
  storefront_image_url: string | null;
  metadata: Record<string, unknown>;
  version: number;
};
type DimensionedMediaRow = MediaRow & {
  width: number | string | null;
  height: number | string | null;
};

const PRODUCT_IMAGE_ROLES = ["primary", "storefront", "gallery"] as const;
const PRODUCT_IMAGE_CLEAR_ROLES = ["storefront", "gallery"] as const;

function metadataRecord(metadata: unknown): CatalogMediaMetadata {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as CatalogMediaMetadata
    : {};
}

export function appendDetailGalleryImageUrl(metadata: unknown, imageUrl: string): string[] {
  const existing = metadataRecord(metadata).detailGalleryImageUrls;
  if (existing !== undefined && (!Array.isArray(existing) || existing.some((item) => typeof item !== "string"))) {
    throw conflict("상품 상세 사진 목록이 올바르지 않습니다.");
  }
  const urls = (existing ?? []) as string[];
  if (urls.length >= 8) throw conflict("상품 상세 사진은 최대 8장까지 연결할 수 있습니다.");
  if (urls.includes(imageUrl)) throw conflict("이미 연결된 상품 상세 사진입니다.");
  return [...urls, imageUrl];
}

export function catalogMediaDeliveryUrl(context: Pick<ApiContext, "config">, mediaId: string, metadata?: unknown): string {
  const baseUrl = context.config.catalogMediaBaseUrl;
  if (!baseUrl) {
    throw new AppError(503, "CATALOG_MEDIA_DELIVERY_UNAVAILABLE", "상품 이미지 제공 주소가 구성되지 않았습니다.");
  }
  const expected = `${baseUrl}/v1/catalog/media/${mediaId}/image`;
  const stored = metadataRecord(metadata).catalogDeliveryUrl;
  if (stored === undefined) return expected;
  if (stored !== expected) {
    throw conflict("이미 연결된 상품 이미지 제공 주소는 변경할 수 없습니다.");
  }
  return expected;
}

function mediaIdFromParams(params: unknown): string {
  return uuidInput((params as Record<string, unknown>).mediaId, "mediaId");
}

function readyMediaDimension(value: number | string | null, label: string): number {
  const dimension = Number(value);
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw badRequest(`완료된 이미지의 ${label} 정보를 확인할 수 없습니다.`);
  }
  return dimension;
}

export function assertStorefrontImageDimensions(
  category: string,
  widthValue: number | string | null,
  heightValue: number | string | null,
): void {
  if (category !== "gacha" && category !== "kuji") {
    throw badRequest("목록 사진은 가챠·쿠지 상품에만 연결할 수 있습니다.");
  }
  const width = readyMediaDimension(widthValue, "가로 크기");
  const height = readyMediaDimension(heightValue, "세로 크기");
  if (category === "gacha" && (width < 1_080 || height < 1_080 || width !== height)) {
    throw badRequest("가챠 목록 사진은 1:1 비율, 최소 1080×1080px이어야 합니다.");
  }
  if (category === "kuji" && (width < 1_200 || height < 675 || width * 9 !== height * 16)) {
    throw badRequest("쿠지 목록 사진은 16:9 비율, 최소 1200×675px이어야 합니다.");
  }
}

export async function registerCatalogMediaRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/admin/catalog-media/:mediaId/url", {
    preHandler: context.auth.requirePermission("catalog.write"),
  }, async (request) => {
    const mediaId = mediaIdFromParams(request.params);
    const media = await context.pool.query<MediaRow>(
      `SELECT * FROM media_assets
       WHERE id=$1 AND owner_id=$2 AND purpose='CATALOG' AND status='READY'`,
      [mediaId, request.actor!.userId],
    );
    if (!media.rowCount) throw notFound("사용 가능한 상품 이미지를 찾을 수 없습니다.");
    return signMediaAsset(context, media.rows[0]!);
  });

  app.patch("/v1/admin/products/:productId/image", {
    preHandler: context.auth.requirePermission("catalog.write"),
  }, async (request, reply) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const body = objectInput(request.body);
    const mediaId = uuidInput(body.mediaId, "mediaId");
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1 })!;
    const role: ProductImageRole = enumInput(body, "role", PRODUCT_IMAGE_ROLES, true) ?? "primary";
    // Fail before starting idempotency or locking rows. The configured API base is
    // the only authority for a persisted public URL; request Host is never used.
    catalogMediaDeliveryUrl(context, mediaId);

    const mutation = await adminIdempotentMutation(context, request, {
      target: { type: "PRODUCT_CATALOG_IMAGE", id: productId, mediaId, role },
      work: async (client) => {
        const product = await client.query<ProductImageRow>(
          "SELECT id,category,image_url,storefront_image_url,metadata,version FROM catalog_products WHERE id=$1 FOR UPDATE",
          [productId],
        );
        if (!product.rowCount) throw notFound("상품을 찾을 수 없습니다.");
        const before = product.rows[0]!;
        if (before.version !== expectedVersion) throw conflict("다른 운영자가 먼저 수정했습니다.");

        const media = await client.query<DimensionedMediaRow>(
          `SELECT * FROM media_assets
           WHERE id=$1 AND owner_id=$2 AND purpose='CATALOG' AND status='READY'
           FOR UPDATE`,
          [mediaId, request.actor!.userId],
        );
        if (!media.rowCount) throw notFound("사용 가능한 상품 이미지를 찾을 수 없습니다.");
        if (role === "storefront") {
          assertStorefrontImageDimensions(before.category, media.rows[0]!.width, media.rows[0]!.height);
        }
        const imageUrl = catalogMediaDeliveryUrl(context, mediaId, media.rows[0]!.metadata);

        await client.query(
          `UPDATE media_assets
           SET metadata=jsonb_set(metadata,'{catalogDeliveryUrl}',to_jsonb($2::text),true)
           WHERE id=$1 AND metadata->>'catalogDeliveryUrl' IS NULL`,
          [mediaId, imageUrl],
        );
        const gallery = role === "gallery" ? appendDetailGalleryImageUrl(before.metadata, imageUrl) : null;
        const imageColumn = role === "storefront" ? "storefront_image_url" : "image_url";
        const updated = await client.query<{ id: string; attached_image_url: string; version: number }>(
          role === "gallery"
            ? `UPDATE catalog_products
               SET metadata=jsonb_set(metadata,'{detailGalleryImageUrls}',to_jsonb($2::text[]),true),version=version+1
               WHERE id=$1 AND version=$3
               RETURNING id,$4::text AS attached_image_url,version`
            : `UPDATE catalog_products
               SET ${imageColumn}=$2,version=version+1
               WHERE id=$1 AND version=$3
               RETURNING id,${imageColumn} AS attached_image_url,version`,
          role === "gallery" ? [productId, gallery, expectedVersion, imageUrl] : [productId, imageUrl, expectedVersion],
        );
        if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
        const after = updated.rows[0]!;
        const responseBody = {
          productId: after.id,
          imageUrl: after.attached_image_url,
          version: after.version,
          mediaId,
          role,
        };
        await writeAdminAudit(client, request, request.actor!, {
          action: "PRODUCT_IMAGE_ATTACHED",
          targetType: "PRODUCT",
          targetId: productId,
          before: {
            imageUrl: role === "gallery" ? before.metadata.detailGalleryImageUrls ?? []
              : role === "storefront" ? before.storefront_image_url : before.image_url,
            version: before.version,
            role,
          },
          after: responseBody,
          metadata: { mediaId, role },
        });
        await writeOutbox(client, request.id, {
          aggregateType: "PRODUCT",
          aggregateId: productId,
          eventType: "catalog.product.image_attached",
          payload: responseBody,
        });
        return {
          statusCode: 200,
          body: responseBody,
          resourceType: "PRODUCT",
          resourceId: productId,
        };
      },
    });
    return sendAdminMutation(reply, mutation);
  });

  app.delete("/v1/admin/products/:productId/image", {
    preHandler: context.auth.requirePermission("catalog.write"),
  }, async (request, reply) => {
    const productId = slugIdInput((request.params as Record<string, unknown>).productId, "productId");
    const body = objectInput(request.body);
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1 })!;
    const role = enumInput(body, "role", PRODUCT_IMAGE_CLEAR_ROLES)!;
    const selectedImageUrl = role === "gallery" ? stringInput(body, "imageUrl", { max: 2_000 })! : null;

    const mutation = await adminIdempotentMutation(context, request, {
      target: { type: "PRODUCT_CATALOG_IMAGE", id: productId, role, imageUrl: selectedImageUrl },
      work: async (client) => {
        const product = await client.query<ProductImageRow>(
          "SELECT id,category,image_url,storefront_image_url,metadata,version FROM catalog_products WHERE id=$1 FOR UPDATE",
          [productId],
        );
        if (!product.rowCount) throw notFound("상품을 찾을 수 없습니다.");
        const before = product.rows[0]!;
        if (before.version !== expectedVersion) throw conflict("다른 운영자가 먼저 수정했습니다.");
        if (role === "storefront" && before.storefront_image_url === null) throw conflict("연결된 목록 사진이 없습니다.");
        const gallery = role === "gallery" ? metadataRecord(before.metadata).detailGalleryImageUrls : null;
        if (role === "gallery" && (!Array.isArray(gallery) || !gallery.includes(selectedImageUrl))) {
          throw conflict("연결된 상세 슬라이드 사진이 없습니다.");
        }

        const updated = await client.query<{ id: string; version: number }>(
          role === "gallery"
            ? `UPDATE catalog_products
               SET metadata=jsonb_set(metadata,'{detailGalleryImageUrls}',to_jsonb($3::text[]),true),version=version+1
               WHERE id=$1 AND version=$2
               RETURNING id,version`
            : `UPDATE catalog_products
               SET storefront_image_url=NULL,version=version+1
               WHERE id=$1 AND version=$2
               RETURNING id,version`,
          role === "gallery" ? [productId, expectedVersion, (gallery as string[]).filter((url) => url !== selectedImageUrl)] : [productId, expectedVersion],
        );
        if (!updated.rowCount) throw conflict("다른 운영자가 먼저 수정했습니다.");
        const responseBody = {
          productId: updated.rows[0]!.id,
          imageUrl: selectedImageUrl,
          version: updated.rows[0]!.version,
          role,
        };
        await writeAdminAudit(client, request, request.actor!, {
          action: role === "gallery" ? "PRODUCT_GALLERY_IMAGE_CLEARED" : "PRODUCT_STOREFRONT_IMAGE_CLEARED",
          targetType: "PRODUCT",
          targetId: productId,
          before: {
            imageUrl: role === "gallery" ? selectedImageUrl : before.storefront_image_url,
            version: before.version,
            role,
          },
          after: responseBody,
          metadata: { role },
        });
        await writeOutbox(client, request.id, {
          aggregateType: "PRODUCT",
          aggregateId: productId,
          eventType: role === "gallery" ? "catalog.product.gallery_image_cleared" : "catalog.product.storefront_image_cleared",
          payload: responseBody,
        });
        return {
          statusCode: 200,
          body: responseBody,
          resourceType: "PRODUCT",
          resourceId: productId,
        };
      },
    });
    return sendAdminMutation(reply, mutation);
  });

  app.get("/v1/catalog/media/:mediaId/image", async (request, reply) => {
    const mediaId = mediaIdFromParams(request.params);
    const deliveryUrl = catalogMediaDeliveryUrl(context, mediaId);
    const deliveryUrls = [deliveryUrl, legacyCatalogMediaDeliveryUrl(mediaId)];
    const media = await context.pool.query<MediaRow>(
      `SELECT media.*
       FROM media_assets AS media
       WHERE media.id=$1
         AND media.status='READY'
         AND media.purpose='CATALOG'
         AND media.metadata->>'catalogDeliveryUrl'=ANY($2::text[])
         AND (
           EXISTS (
             SELECT 1
             FROM catalog_products AS product
             JOIN catalog_ips AS ip ON ip.id=product.ip_id
             WHERE (product.image_url=ANY($2::text[])
               OR product.storefront_image_url=ANY($2::text[])
               OR (jsonb_typeof(product.metadata->'detailGalleryImageUrls')='array'
                 AND (product.metadata->'detailGalleryImageUrls') ?| $2::text[]))
               AND product.is_active AND ip.is_active
           )
           OR EXISTS (
             SELECT 1
             FROM draw_pool_entries AS entry
             JOIN draw_probability_versions AS version ON version.id=entry.probability_version_id
             WHERE entry.prize_image_url_snapshot=ANY($2::text[]) AND version.status IN ('ACTIVE','RETIRED')
           )
           OR EXISTS (
             SELECT 1
             FROM shipping_request_items AS item
             WHERE item.product_snapshot->>'imageUrl'=ANY($2::text[])
           )
         )`,
      [mediaId, deliveryUrls],
    );
    if (!media.rowCount) throw notFound("공개된 상품 이미지를 찾을 수 없습니다.");
    const signed = await signMediaAsset(context, media.rows[0]!);
    return reply
      .header("cache-control", "private, no-store")
      .header("location", signed.url)
      .code(302)
      .send();
  });
}
