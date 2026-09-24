-- The new Supabase project has the same 84 private media objects and UUIDs.
-- Change only mutable delivery metadata and catalog references. Published draw
-- snapshots remain immutable; the API resolves their legacy delivery URLs.
DO $$
DECLARE
  old_prefix constant text := 'https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/v1/catalog/media/';
  new_prefix constant text := 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api/v1/catalog/media/';
BEGIN
  IF EXISTS (
    SELECT 1 FROM media_assets AS media
    WHERE media.metadata->>'catalogDeliveryUrl' LIKE old_prefix || '%'
      AND (
        media.purpose <> 'CATALOG'
        OR media.metadata->>'catalogDeliveryUrl' <> old_prefix || media.id::text || '/image'
      )
  ) THEN
    RAISE EXCEPTION 'Legacy catalog media metadata is not a canonical catalog image URL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM catalog_products AS product
    WHERE (product.image_url LIKE old_prefix || '%' OR product.storefront_image_url LIKE old_prefix || '%')
      AND (
        (product.image_url LIKE old_prefix || '%' AND NOT EXISTS (
          SELECT 1 FROM media_assets AS media
          WHERE media.purpose='CATALOG' AND media.status='READY'
            AND product.image_url=old_prefix || media.id::text || '/image'
            AND media.metadata->>'catalogDeliveryUrl'=product.image_url
        ))
        OR (product.storefront_image_url LIKE old_prefix || '%' AND NOT EXISTS (
          SELECT 1 FROM media_assets AS media
          WHERE media.purpose='CATALOG' AND media.status='READY'
            AND product.storefront_image_url=old_prefix || media.id::text || '/image'
            AND media.metadata->>'catalogDeliveryUrl'=product.storefront_image_url
        ))
      )
  ) THEN
    RAISE EXCEPTION 'Legacy product image does not point to a ready canonical media object';
  END IF;

  UPDATE media_assets AS media
     SET metadata=jsonb_set(
       media.metadata,
       '{catalogDeliveryUrl}',
       to_jsonb(new_prefix || media.id::text || '/image'),
       true
     )
   WHERE media.purpose='CATALOG'
     AND media.metadata->>'catalogDeliveryUrl'=old_prefix || media.id::text || '/image';

  UPDATE catalog_products AS product
     SET image_url=CASE WHEN product.image_url LIKE old_prefix || '%'
           THEN new_prefix || substring(product.image_url FROM char_length(old_prefix) + 1)
           ELSE product.image_url END,
         storefront_image_url=CASE WHEN product.storefront_image_url LIKE old_prefix || '%'
           THEN new_prefix || substring(product.storefront_image_url FROM char_length(old_prefix) + 1)
           ELSE product.storefront_image_url END,
         version=product.version+1
   WHERE product.image_url LIKE old_prefix || '%'
      OR product.storefront_image_url LIKE old_prefix || '%';
END
$$;
