ALTER TABLE public.catalog_products
  ADD COLUMN storefront_image_url text;

ALTER TABLE public.catalog_products
  ADD CONSTRAINT catalog_products_storefront_image_url_http_check
  CHECK (
    storefront_image_url IS NULL
    OR storefront_image_url ~ '^https?://[^[:space:]]+$'
  );

COMMENT ON COLUMN public.catalog_products.storefront_image_url IS
  'Server-controlled list/card image URL. Gacha uses 1:1 media and kuji uses 16:9 media.';
