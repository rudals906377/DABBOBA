/**
 * Customer-safe Kuji tier projection for catalog cards.
 *
 * This deliberately exposes only aggregate tier quantities from the active
 * published deck. It must never include sealed slot-to-prize assignments.
 */
export const CATALOG_REMAINING_KUJI_TIERS_SQL = `CASE
  WHEN p.category='kuji' THEN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'tierCode', tier.tier_code,
        'tierRank', tier.tier_rank,
        'label', entry.rarity,
        'initialQuantity', entry.initial_quantity,
        'remainingQuantity', entry.remaining_quantity
      ) ORDER BY tier.tier_rank ASC, tier.tier_code ASC
    )
      FROM draw_probability_versions AS probability_version
      JOIN kuji_deck_tiers AS tier
        ON tier.probability_version_id=probability_version.id
      JOIN draw_pool_entries AS entry
        ON entry.id=tier.pool_entry_id
     WHERE probability_version.product_id=p.id
       AND probability_version.status='ACTIVE'
       AND entry.remaining_quantity>0
  ), '[]'::jsonb)
  ELSE '[]'::jsonb
END`;

export type CatalogRemainingKujiTierRow = {
  tierCode: string;
  tierRank: number | string;
  label: string;
  initialQuantity: number | string;
  remainingQuantity: number | string;
};
