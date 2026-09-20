-- Retire the local-development catalog without deleting immutable commerce
-- history. migrate.ts executes this entire file and its schema_migrations row
-- inside one transaction, so every assertion below precedes every state change.

SET LOCAL lock_timeout = '5s';

-- Freeze the relations used by the fail-closed checks. Runtime writes either
-- finish before this point or make the migration fail without partial changes.
LOCK TABLE
  public.catalog_ips,
  public.catalog_products,
  public.draw_probability_versions,
  public.draw_pool_entries,
  public.draw_entitlements,
  public.orders,
  public.order_lines,
  public.stock_reservations,
  public.payments,
  public.kuji_room_entries,
  public.kuji_slot_bindings
IN SHARE ROW EXCLUSIVE MODE NOWAIT;

-- Materialize the target once so version retirement, product deactivation,
-- obligation checks, and derived IP retirement cannot drift apart.
CREATE TEMP TABLE dabboba_0039_target_products (
  id text PRIMARY KEY,
  ip_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO dabboba_0039_target_products(id, ip_id)
SELECT product.id, product.ip_id
FROM public.catalog_products AS product
WHERE product.id = ANY (ARRAY[
  'one-piece-tcg',
  'dragon-ball-figure',
  'demon-slayer-gacha',
  'jujutsu-kaisen-gacha',
  'naruto-figure',
  'bleach-figure',
  'my-hero-academia-figure',
  'hunter-x-hunter-kuji',
  'chainsaw-man-figure',
  'attack-on-titan-figure',
  'jojos-bizarre-adventure-kuji',
  'spy-x-family-gacha',
  'haikyu-gacha',
  'blue-lock-gacha',
  'oshi-no-ko-gacha',
  'frieren-figure',
  'cyberpunk-edgerunners-figure',
  'dandadan-gacha',
  'kaiju-no-8-kuji',
  'evangelion-kuji',
  'mobile-suit-gundam-kuji',
  'pokemon-tcg',
  'detective-conan-gacha',
  'tokyo-revengers-kuji',
  'that-time-i-got-reincarnated-as-a-slime-kuji'
]::text[])
   OR product.metadata ? 'developmentFixture';

CREATE TEMP TABLE dabboba_0039_target_ips (
  id text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO dabboba_0039_target_ips(id)
SELECT candidate.id
FROM unnest(ARRAY[
  'one-piece',
  'dragon-ball',
  'demon-slayer',
  'jujutsu-kaisen',
  'naruto',
  'bleach',
  'my-hero-academia',
  'hunter-x-hunter',
  'chainsaw-man',
  'attack-on-titan',
  'jojos-bizarre-adventure',
  'spy-x-family',
  'haikyu',
  'blue-lock',
  'oshi-no-ko',
  'frieren',
  'cyberpunk-edgerunners',
  'dandadan',
  'kaiju-no-8',
  'evangelion',
  'mobile-suit-gundam',
  'pokemon',
  'detective-conan',
  'tokyo-revengers',
  'that-time-i-got-reincarnated-as-a-slime'
]::text[]) AS candidate(id);

INSERT INTO dabboba_0039_target_ips(id)
SELECT target.ip_id
FROM dabboba_0039_target_products AS target
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  -- A reviewed non-prototype sale must never be silently retired just because
  -- its pool accidentally references a development prize.
  IF EXISTS (
    SELECT 1
    FROM public.draw_probability_versions AS version
    JOIN public.draw_pool_entries AS entry
      ON entry.probability_version_id = version.id
    JOIN dabboba_0039_target_products AS prize_product
      ON prize_product.id = entry.prize_product_id
    LEFT JOIN dabboba_0039_target_products AS sale_product
      ON sale_product.id = version.product_id
    WHERE version.status = 'ACTIVE'
      AND sale_product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Prototype prize is referenced by a non-prototype active draw version'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.draw_entitlements AS entitlement
    JOIN dabboba_0039_target_products AS target
      ON target.id = entitlement.product_id
    WHERE entitlement.status = 'AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by available draw entitlements'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders AS orders
    JOIN public.order_lines AS line ON line.order_id = orders.id
    JOIN dabboba_0039_target_products AS target ON target.id = line.product_id
    WHERE orders.status = 'PENDING_PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by unresolved orders'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS payment
    JOIN public.order_lines AS line ON line.order_id = payment.order_id
    JOIN dabboba_0039_target_products AS target ON target.id = line.product_id
    WHERE payment.status IN ('PENDING','AUTHORIZED')
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by unresolved payments'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_reservations AS reservation
    JOIN dabboba_0039_target_products AS target ON target.id = reservation.product_id
    WHERE reservation.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by active stock reservations'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kuji_room_entries AS room_entry
    JOIN dabboba_0039_target_products AS target ON target.id = room_entry.product_id
    WHERE room_entry.state IN ('WAITING','CHECKOUT_PENDING','DRAWING')
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by active kuji room entries'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kuji_slot_bindings AS binding
    JOIN public.kuji_slot_assignments AS assignment
      ON assignment.id = binding.slot_assignment_id
    JOIN public.draw_probability_versions AS version
      ON version.id = assignment.probability_version_id
    JOIN dabboba_0039_target_products AS target ON target.id = version.product_id
    WHERE binding.state = 'RESERVED'
  ) THEN
    RAISE EXCEPTION 'Prototype catalog retirement is blocked by reserved kuji slot bindings'
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- Retire active target sale versions before the active-prize deactivation
-- trigger sees their target prize products.
UPDATE public.draw_probability_versions AS version
SET status = 'RETIRED'
FROM dabboba_0039_target_products AS target
WHERE version.product_id = target.id
  AND version.status = 'ACTIVE';

UPDATE public.catalog_products AS product
SET is_active = false,
    updated_at = now()
FROM dabboba_0039_target_products AS target
WHERE product.id = target.id
  AND product.is_active = true;

UPDATE public.catalog_ips AS ip
SET is_active = false,
    updated_at = now()
FROM dabboba_0039_target_ips AS target
WHERE ip.id = target.id
  AND ip.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.catalog_products AS product
    WHERE product.ip_id = ip.id
      AND product.is_active = true
  );
