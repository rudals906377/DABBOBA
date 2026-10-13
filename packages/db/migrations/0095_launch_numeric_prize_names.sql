-- Owner-approved temporary labels, not verified character names. No stock,
-- image, quantity or published probability snapshots are changed here.
UPDATE public.catalog_products prize
   SET name=(substring(prize.id from '-prize-([0-9]+)$')::integer)::text,
       metadata=prize.metadata || jsonb_build_object('namePending',false,'temporaryNumericName',true),
       version=prize.version+1
 WHERE prize.is_prize_only AND (
   (prize.metadata->>'parentProductId'='gacha-chiikawa-monitor-cupcake'
    AND prize.id ~ '^gacha-chiikawa-monitor-cupcake-prize-0[1-7]$')
   OR (prize.metadata->>'parentProductId'='gacha-sanrio-can-figures'
       AND prize.id ~ '^gacha-sanrio-can-figures-prize-0[1-5]$')
 );

-- The operator confirmed these reference prices equal the parent 1-draw price.
-- Apply before publishing launch probability versions; old draw snapshots stay
-- immutable. Never substitute unknown individual quantities for these prices.
UPDATE public.catalog_products prize SET price=parent.price,version=prize.version+1
  FROM public.catalog_products parent
 WHERE prize.is_prize_only AND prize.metadata->>'parentProductId'=parent.id
   AND parent.id IN (
     'gacha-chiikawa-monitor-cupcake','gacha-death-note-collection-rich',
     'gacha-demon-slayer-onemutan-13','gacha-demon-slayer-petatto-2',
     'gacha-demon-slayer-petatto-3','gacha-hatsune-miku-petadoll',
     'gacha-sanrio-can-figures','gacha-sylvanian-adventure'
   ) AND parent.price>0 AND prize.price IS DISTINCT FROM parent.price;
