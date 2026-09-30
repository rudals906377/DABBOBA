-- 0067 moved catalog product images to the new Supabase media host but left
-- every draw_pool_entries snapshot untouched. ACTIVE and RETIRED snapshots
-- stay immutable (the API translates their legacy URL on read). An unpublished
-- DRAFT is still a working copy whose publish check compares each snapshot with
-- the current prize product, so rebase only the DRAFT rows whose single
-- difference from that product is the 0067 host change. Any other drift is a
-- genuinely stale draft and is left for the operator to recreate.
DO $$
DECLARE
  old_prefix constant text := 'https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api/v1/catalog/media/';
  new_prefix constant text := 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api/v1/catalog/media/';
BEGIN
  UPDATE draw_pool_entries AS entry
     SET prize_image_url_snapshot = prize.image_url
    FROM draw_probability_versions AS version,
         catalog_products AS draw_product,
         catalog_products AS prize
   WHERE version.id = entry.probability_version_id
     AND version.status = 'DRAFT'
     AND draw_product.id = version.product_id
     AND draw_product.is_prize_only = false
     AND draw_product.category IN ('gacha','kuji')
     AND prize.id = entry.prize_product_id
     AND prize.is_active = true
     AND prize.is_prize_only = true
     AND prize.ip_id IS NOT DISTINCT FROM draw_product.ip_id
     AND entry.prize_image_url_snapshot LIKE old_prefix || '%'
     AND prize.image_url = new_prefix || substring(entry.prize_image_url_snapshot FROM char_length(old_prefix) + 1)
     AND entry.prize_name_snapshot IS NOT DISTINCT FROM prize.name
     AND entry.prize_sku_snapshot IS NOT DISTINCT FROM prize.sku
     AND entry.prize_ip_id_snapshot IS NOT DISTINCT FROM prize.ip_id
     AND entry.prize_category_snapshot IS NOT DISTINCT FROM prize.category;
END
$$;
