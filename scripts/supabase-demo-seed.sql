BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(hashtextextended('supabase-demo-seed-v1',0));

INSERT INTO users(id,email,nickname,role,status)
VALUES('da000000-0000-4000-8000-00000000000a','member01@dabboba.local','다뽑러 01','USER','ACTIVE')
ON CONFLICT (id) DO UPDATE
SET email=EXCLUDED.email,
    nickname=CASE
      WHEN users.nickname IN ('테스트 회원 A','데모 회원 A') THEN EXCLUDED.nickname
      ELSE users.nickname
    END,
    status='ACTIVE',
    suspended_until=NULL,
    suspension_reason=NULL,
    deleted_at=NULL,
    updated_at=clock_timestamp();

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE
      id='da000000-0000-4000-8000-00000000000a'
      AND email='member01@dabboba.local' AND role='USER' AND status='ACTIVE')
  THEN RAISE EXCEPTION 'Supabase internal customer identity conflict' USING ERRCODE='23505'; END IF;
END $$;

UPDATE users
SET status='BANNED',
    suspended_until=NULL,
    suspension_reason='중복 내부 계정 퇴역',
    updated_at=clock_timestamp()
WHERE role='USER'
  AND status<>'DELETED'
  AND (
    id='da000000-0000-4000-8000-00000000000b'
    OR email='mobile-test@dabboba.local'
  );

UPDATE sessions
SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
    revoke_reason=COALESCE(revoke_reason,'DUPLICATE_INTERNAL_ACCOUNT_RETIRED')
WHERE revoked_at IS NULL
  AND user_id IN (
    SELECT id FROM users
    WHERE id='da000000-0000-4000-8000-00000000000b'
       OR email='mobile-test@dabboba.local'
  );

DELETE FROM default_shipping_addresses
WHERE id IN (
  'da010000-0000-4000-8000-00000000000a',
  'da010000-0000-4000-8000-00000000000b'
)
  AND delivery_note='supabase-demo-v1: 실제 배송 금지';

INSERT INTO catalog_ips(id,slug,name_ko,name_en,description,image_url,is_active)
VALUES('demo-test-ip','demo-test-ip','다뽀바 컬렉션','DABBOBA Collection','가챠·쿠지 상품 컬렉션',NULL,true)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM catalog_ips WHERE id='demo-test-ip' AND slug='demo-test-ip' AND name_ko='다뽀바 컬렉션' AND is_active=true)
  THEN RAISE EXCEPTION 'Supabase demo IP conflict' USING ERRCODE='23505'; END IF;
END $$;

WITH products(id,sku,category,name,price,image_url,is_prize_only) AS (VALUES
  ('demo-test-gacha','DEMO-TEST-GACHA','gacha','다뽀바 럭키 캡슐',1000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/video/dabboba-capsule-machine-poster.jpg',false),
  ('demo-test-kuji','DEMO-TEST-KUJI','kuji','다뽀바 럭키 쿠지',2000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',false),
  ('demo-test-gacha-prize-a','DEMO-GACHA-PRIZE-A','gacha','캡슐 경품 A',5000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png',true),
  ('demo-test-gacha-prize-b','DEMO-GACHA-PRIZE-B','gacha','캡슐 경품 B',5000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png',true),
  ('demo-test-gacha-prize-c','DEMO-GACHA-PRIZE-C','gacha','캡슐 경품 C',5000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png',true),
  ('demo-test-gacha-prize-d','DEMO-GACHA-PRIZE-D','gacha','캡슐 경품 D',5000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png',true),
  ('demo-test-gacha-prize-e','DEMO-GACHA-PRIZE-E','gacha','캡슐 경품 E',5000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png',true),
  ('demo-test-kuji-prize-a','DEMO-KUJI-PRIZE-A','kuji','쿠지 경품 A',10000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',true),
  ('demo-test-kuji-prize-b','DEMO-KUJI-PRIZE-B','kuji','쿠지 경품 B',10000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',true),
  ('demo-test-kuji-prize-c','DEMO-KUJI-PRIZE-C','kuji','쿠지 경품 C',10000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',true),
  ('demo-test-kuji-prize-d','DEMO-KUJI-PRIZE-D','kuji','쿠지 경품 D',10000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',true),
  ('demo-test-kuji-prize-e','DEMO-KUJI-PRIZE-E','kuji','쿠지 경품 E',10000,'http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png',true)
)
INSERT INTO catalog_products(id,sku,ip_id,category,name,price,currency,image_url,metadata,is_active,is_prize_only)
SELECT id,sku,'demo-test-ip',category,name,price,'KRW',image_url,
       jsonb_build_object('dabbobaFixture','supabase-demo-v1','internalTestOnly',true),true,is_prize_only
FROM products
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM catalog_products WHERE ip_id='demo-test-ip'
      AND metadata->>'dabbobaFixture'='supabase-demo-v1'
      AND id IN ('demo-test-gacha','demo-test-kuji',
        'demo-test-gacha-prize-a','demo-test-gacha-prize-b','demo-test-gacha-prize-c','demo-test-gacha-prize-d','demo-test-gacha-prize-e',
        'demo-test-kuji-prize-a','demo-test-kuji-prize-b','demo-test-kuji-prize-c','demo-test-kuji-prize-d','demo-test-kuji-prize-e')) <> 12
  THEN RAISE EXCEPTION 'Supabase demo product identity conflict' USING ERRCODE='23505'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    WITH expected(id,sku,category,name,price,is_prize_only) AS (VALUES
      ('demo-test-gacha','DEMO-TEST-GACHA','gacha', '다뽀바 럭키 캡슐',1000,false),
      ('demo-test-kuji','DEMO-TEST-KUJI','kuji','다뽀바 럭키 쿠지',2000,false),
      ('demo-test-gacha-prize-a','DEMO-GACHA-PRIZE-A','gacha','캡슐 경품 A',5000,true),
      ('demo-test-gacha-prize-b','DEMO-GACHA-PRIZE-B','gacha','캡슐 경품 B',5000,true),
      ('demo-test-gacha-prize-c','DEMO-GACHA-PRIZE-C','gacha','캡슐 경품 C',5000,true),
      ('demo-test-gacha-prize-d','DEMO-GACHA-PRIZE-D','gacha','캡슐 경품 D',5000,true),
      ('demo-test-gacha-prize-e','DEMO-GACHA-PRIZE-E','gacha','캡슐 경품 E',5000,true),
      ('demo-test-kuji-prize-a','DEMO-KUJI-PRIZE-A','kuji','쿠지 경품 A',10000,true),
      ('demo-test-kuji-prize-b','DEMO-KUJI-PRIZE-B','kuji','쿠지 경품 B',10000,true),
      ('demo-test-kuji-prize-c','DEMO-KUJI-PRIZE-C','kuji','쿠지 경품 C',10000,true),
      ('demo-test-kuji-prize-d','DEMO-KUJI-PRIZE-D','kuji','쿠지 경품 D',10000,true),
      ('demo-test-kuji-prize-e','DEMO-KUJI-PRIZE-E','kuji','쿠지 경품 E',10000,true)
    )
    SELECT 1 FROM expected
    JOIN catalog_products actual USING(id)
    WHERE actual.sku IS DISTINCT FROM expected.sku
       OR actual.ip_id IS DISTINCT FROM 'demo-test-ip'
       OR actual.category IS DISTINCT FROM expected.category
       OR actual.name IS DISTINCT FROM expected.name
       OR actual.price IS DISTINCT FROM expected.price
       OR actual.currency IS DISTINCT FROM 'KRW'
       OR actual.metadata->>'dabbobaFixture' IS DISTINCT FROM 'supabase-demo-v1'
       OR actual.is_active IS DISTINCT FROM true
       OR actual.is_prize_only IS DISTINCT FROM expected.is_prize_only
  ) THEN RAISE EXCEPTION 'Supabase demo product values conflict' USING ERRCODE='23505'; END IF;
END $$;

INSERT INTO product_stock(product_id,on_hand,reserved)
VALUES('demo-test-gacha',20,0),('demo-test-kuji',10,0)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM product_stock WHERE
      (product_id='demo-test-gacha' AND on_hand BETWEEN 0 AND 20 AND reserved BETWEEN 0 AND on_hand) OR
      (product_id='demo-test-kuji' AND on_hand BETWEEN 0 AND 10 AND reserved BETWEEN 0 AND on_hand)) <> 2
  THEN RAISE EXCEPTION 'Supabase demo stock conflict' USING ERRCODE='23505'; END IF;
END $$;

INSERT INTO draw_probability_versions(id,product_id,version)
VALUES
  ('da100000-0000-4000-8000-000000000001','demo-test-gacha',1),
  ('da100000-0000-4000-8000-000000000002','demo-test-kuji',1)
ON CONFLICT DO NOTHING;

WITH entries(id,version_id,prize_id,prize_name,prize_image,prize_sku,category,rarity,weight,quantity) AS (VALUES
  ('da200000-0000-4000-8000-000000000001'::uuid,'da100000-0000-4000-8000-000000000001'::uuid,'demo-test-gacha-prize-a','캡슐 경품 A','http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png','DEMO-GACHA-PRIZE-A','gacha','A',1,4),
  ('da200000-0000-4000-8000-000000000002'::uuid,'da100000-0000-4000-8000-000000000001'::uuid,'demo-test-gacha-prize-b','캡슐 경품 B','http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png','DEMO-GACHA-PRIZE-B','gacha','B',1,4),
  ('da200000-0000-4000-8000-000000000003'::uuid,'da100000-0000-4000-8000-000000000001'::uuid,'demo-test-gacha-prize-c','캡슐 경품 C','http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png','DEMO-GACHA-PRIZE-C','gacha','C',1,4),
  ('da200000-0000-4000-8000-000000000004'::uuid,'da100000-0000-4000-8000-000000000001'::uuid,'demo-test-gacha-prize-d','캡슐 경품 D','http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png','DEMO-GACHA-PRIZE-D','gacha','D',1,4),
  ('da200000-0000-4000-8000-000000000005'::uuid,'da100000-0000-4000-8000-000000000001'::uuid,'demo-test-gacha-prize-e','캡슐 경품 E','http://127.0.0.1:4174/assets/dabboba/draw/gacha/capsule-machine-front-pixel.png','DEMO-GACHA-PRIZE-E','gacha','E',1,4),
  ('da300000-0000-4000-8000-000000000001'::uuid,'da100000-0000-4000-8000-000000000002'::uuid,'demo-test-kuji-prize-a','쿠지 경품 A','http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png','DEMO-KUJI-PRIZE-A','kuji','A',1,2),
  ('da300000-0000-4000-8000-000000000002'::uuid,'da100000-0000-4000-8000-000000000002'::uuid,'demo-test-kuji-prize-b','쿠지 경품 B','http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png','DEMO-KUJI-PRIZE-B','kuji','B',1,2),
  ('da300000-0000-4000-8000-000000000003'::uuid,'da100000-0000-4000-8000-000000000002'::uuid,'demo-test-kuji-prize-c','쿠지 경품 C','http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png','DEMO-KUJI-PRIZE-C','kuji','C',1,2),
  ('da300000-0000-4000-8000-000000000004'::uuid,'da100000-0000-4000-8000-000000000002'::uuid,'demo-test-kuji-prize-d','쿠지 경품 D','http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png','DEMO-KUJI-PRIZE-D','kuji','D',1,2),
  ('da300000-0000-4000-8000-000000000005'::uuid,'da100000-0000-4000-8000-000000000002'::uuid,'demo-test-kuji-prize-e','쿠지 경품 E','http://127.0.0.1:4174/assets/dabboba/draw/gacha/arcade-cabinet.png','DEMO-KUJI-PRIZE-E','kuji','E',1,2)
)
INSERT INTO draw_pool_entries(id,probability_version_id,prize_product_id,
  prize_name_snapshot,prize_image_url_snapshot,prize_sku_snapshot,prize_ip_id_snapshot,
  prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
SELECT id,version_id,prize_id,prize_name,prize_image,prize_sku,'demo-test-ip',category,rarity,weight,quantity,quantity
FROM entries
WHERE EXISTS(SELECT 1 FROM draw_probability_versions v WHERE v.id=entries.version_id AND v.status='DRAFT')
ON CONFLICT DO NOTHING;

INSERT INTO kuji_decks(probability_version_id,total_slots)
SELECT 'da100000-0000-4000-8000-000000000002',10
WHERE EXISTS(SELECT 1 FROM draw_probability_versions WHERE id='da100000-0000-4000-8000-000000000002' AND status='DRAFT')
ON CONFLICT DO NOTHING;

WITH tiers(pool_entry_id,tier_code,tier_rank) AS (VALUES
  ('da300000-0000-4000-8000-000000000001'::uuid,'A',0),
  ('da300000-0000-4000-8000-000000000002'::uuid,'B',1),
  ('da300000-0000-4000-8000-000000000003'::uuid,'C',2),
  ('da300000-0000-4000-8000-000000000004'::uuid,'D',3),
  ('da300000-0000-4000-8000-000000000005'::uuid,'E',4)
)
INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank)
SELECT 'da100000-0000-4000-8000-000000000002',pool_entry_id,tier_code,tier_rank FROM tiers
WHERE EXISTS(SELECT 1 FROM draw_probability_versions WHERE id='da100000-0000-4000-8000-000000000002' AND status='DRAFT')
ON CONFLICT DO NOTHING;

WITH assignment(slot_number,pool_entry_id) AS (VALUES
  __DABBOBA_KUJI_ASSIGNMENTS__
)
INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
SELECT 'da100000-0000-4000-8000-000000000002',slot_number,pool_entry_id FROM assignment
WHERE EXISTS(SELECT 1 FROM draw_probability_versions WHERE id='da100000-0000-4000-8000-000000000002' AND status='DRAFT')
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM draw_pool_entries WHERE probability_version_id IN (
      'da100000-0000-4000-8000-000000000001','da100000-0000-4000-8000-000000000002')) <> 10
    OR (SELECT count(*) FROM kuji_slot_assignments WHERE probability_version_id='da100000-0000-4000-8000-000000000002') <> 10
  THEN RAISE EXCEPTION 'Supabase demo draw fixture conflict' USING ERRCODE='23505'; END IF;
END $$;

UPDATE draw_probability_versions
SET status='ACTIVE',published_by='da000000-0000-4000-8000-00000000000a',published_at=clock_timestamp()
WHERE id IN ('da100000-0000-4000-8000-000000000001','da100000-0000-4000-8000-000000000002')
  AND status='DRAFT';

DO $$ BEGIN
  IF (SELECT count(*) FROM draw_probability_versions WHERE id IN (
      'da100000-0000-4000-8000-000000000001','da100000-0000-4000-8000-000000000002')
      AND status='ACTIVE' AND published_by='da000000-0000-4000-8000-00000000000a') <> 2
  THEN RAISE EXCEPTION 'Supabase demo draw publication conflict' USING ERRCODE='23505'; END IF;
END $$;

COMMIT;
