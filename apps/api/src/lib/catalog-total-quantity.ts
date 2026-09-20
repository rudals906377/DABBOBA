export const CATALOG_TOTAL_QUANTITY_SQL = `CASE
  WHEN p.category='kuji' THEN (
    SELECT deck.total_slots
      FROM draw_probability_versions version
      JOIN kuji_decks deck ON deck.probability_version_id=version.id
     WHERE version.product_id=p.id
       AND version.status='ACTIVE'
  )
  WHEN p.category='gacha' THEN (
    SELECT CASE
      WHEN count(entry.id)>0
       AND count(entry.initial_quantity)=count(entry.id)
      THEN sum(entry.initial_quantity)
      ELSE NULL
    END
      FROM draw_probability_versions version
      JOIN draw_pool_entries entry ON entry.probability_version_id=version.id
     WHERE version.product_id=p.id
       AND version.status='ACTIVE'
  )
  ELSE NULL
END`;
