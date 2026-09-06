import { createHash } from "node:crypto";
import type { DatabaseClient } from "@dabboba/db";

export const MOBILE_TEST_EMAIL = "mobile-test@dabboba.local";

const FIXTURE_KEY = "mobile-test-storage-v1";
const FIXTURE_POINT_REFERENCE = `${FIXTURE_KEY}:welcome-points`;
const FIXTURE_POINT_AMOUNT = 3_000;

const STORAGE_FIXTURES = [
  {
    templateProductId: "spy-x-family-gacha",
    drawProductId: "dev-draw-spy-family-gacha",
    drawSku: "DEV-DRAW-SPY-FAMILY-GACHA",
    drawName: "스파이 패밀리 테스트 가챠",
    prizeProductId: "dev-prize-spy-family-mascot",
    prizeSku: "DEV-PRIZE-SPY-FAMILY-MASCOT",
    prizeName: "아냐 캡슐 봉제 마스코트 (테스트)",
    sourceType: "GACHA",
    slot: "gacha-1",
  },
  {
    templateProductId: "blue-lock-gacha",
    drawProductId: "dev-draw-blue-lock-gacha",
    drawSku: "DEV-DRAW-BLUE-LOCK-GACHA",
    drawName: "블루 록 테스트 가챠",
    prizeProductId: "dev-prize-blue-lock-figure",
    prizeSku: "DEV-PRIZE-BLUE-LOCK-FIGURE",
    prizeName: "블루 록 캡슐 피규어 (테스트)",
    sourceType: "GACHA",
    slot: "gacha-2",
  },
  {
    templateProductId: "mobile-suit-gundam-kuji",
    drawProductId: "dev-draw-gundam-kuji",
    drawSku: "DEV-DRAW-GUNDAM-KUJI",
    drawName: "기동전사 건담 테스트 쿠지",
    prizeProductId: "dev-prize-gundam-acrylic",
    prizeSku: "DEV-PRIZE-GUNDAM-ACRYLIC",
    prizeName: "건담 아크릴 스탠드 (테스트)",
    sourceType: "KUJI",
    slot: "kuji-1",
  },
  {
    templateProductId: "evangelion-kuji",
    drawProductId: "dev-draw-evangelion-kuji",
    drawSku: "DEV-DRAW-EVANGELION-KUJI",
    drawName: "에반게리온 테스트 쿠지",
    prizeProductId: "dev-prize-evangelion-mascot",
    prizeSku: "DEV-PRIZE-EVANGELION-MASCOT",
    prizeName: "에반게리온 30주년 마스코트 (테스트)",
    sourceType: "KUJI",
    slot: "kuji-2",
  },
] as const;

type SourceProductRow = {
  id: string;
  ip_id: string;
  category: "gacha" | "kuji";
  price: number | string;
  image_url: string | null;
};

type DrawFixture = (typeof STORAGE_FIXTURES)[number] & {
  source: SourceProductRow;
  probabilityVersionId: string;
  probabilityVersion: number;
  poolEntryId: string;
  kujiSlotAssignmentId: string | null;
};

type PlayableKujiFixtureRow = {
  product_id: string;
  ip_id: string;
  on_hand: number | string;
  prize_name: string;
  prize_image_url: string | null;
  prize_sku: string;
  prize_ip_id: string;
  prize_category: "gacha" | "figure" | "kuji" | "tcg";
};

export function developmentSessionEnabled(input: {
  environment: "development" | "test" | "production";
  explicitFlag?: string | undefined;
}): boolean {
  return input.environment === "test"
    || (input.environment === "development" && input.explicitFlag === "true");
}

export function mobileTestFixturesEnabled(input: {
  environment: "development" | "test" | "production";
  databaseUrl: string;
  explicitFlag?: string | undefined;
  expectedProjectRef?: string | undefined;
}): boolean {
  if (input.environment === "production" || input.explicitFlag !== "true") return false;
  const expected = input.expectedProjectRef?.trim();
  if (!expected) return false;
  try {
    const database = new URL(input.databaseUrl);
    if (expected === "local") {
      return ["127.0.0.1", "localhost", "::1"].includes(database.hostname)
        && database.pathname === "/dabboba";
    }
    const sessionPoolerMatches = database.hostname.endsWith(".supabase.com")
      && database.username.split(".").at(-1) === expected;
    const directConnectionMatches = database.hostname === `db.${expected}.supabase.co`;
    return sessionPoolerMatches || directConnectionMatches;
  } catch {
    return false;
  }
}

export async function provisionMobileTestAccount(
  client: DatabaseClient,
  input: { userId: string; email: string },
): Promise<void> {
  if (input.email !== MOBILE_TEST_EMAIL) return;

  await client.query(
    `INSERT INTO default_shipping_addresses(
       user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note
     ) VALUES($1,'모찌수집가','01000000000','10888','경기도 파주시 테스트로 1','다뽀바 테스트 배송지','개발 테스트 주문입니다')
     ON CONFLICT (user_id) DO NOTHING`,
    [input.userId],
  );

  const wishlistProductIds = STORAGE_FIXTURES.slice(0, 2).map((item) => item.templateProductId);
  await client.query(
    `INSERT INTO wishlist_items(user_id,product_id)
     SELECT $1,product.id
     FROM catalog_products product
     WHERE product.id=ANY($2::text[]) AND product.is_active=true AND product.is_prize_only=false
     ON CONFLICT (user_id,product_id) DO NOTHING`,
    [input.userId, wishlistProductIds],
  );

  await provisionWelcomePoints(client, input.userId);
  await provisionStoredDraws(client, input.userId);
  await provisionPlayableKujiCatalog(client, input.userId);
}

async function provisionWelcomePoints(client: DatabaseClient, userId: string): Promise<void> {
  await client.query(
    "INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
  const inserted = await client.query(
    `INSERT INTO point_ledger_entries(
       user_id,entry_type,amount,reference_type,reference_id,reason
     ) VALUES($1,'EARN',$2,'DEVELOPMENT_FIXTURE',$3,'테스트 계정 시작 포인트')
     ON CONFLICT (user_id,entry_type,reference_type,reference_id) DO NOTHING
     RETURNING id`,
    [userId, FIXTURE_POINT_AMOUNT, FIXTURE_POINT_REFERENCE],
  );
  if (inserted.rowCount) {
    await client.query(
      "UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",
      [userId, FIXTURE_POINT_AMOUNT],
    );
  }
}

async function provisionStoredDraws(client: DatabaseClient, userId: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`${FIXTURE_KEY}:${userId}`],
  );
  const fixtures: DrawFixture[] = [];
  for (const fixture of STORAGE_FIXTURES) {
    const existing = await client.query(
      `SELECT 1
       FROM draw_results result
       JOIN inventory_units inventory ON inventory.id=result.prize_inventory_unit_id
       WHERE result.user_id=$1
         AND result.product_id IN ($2,$3)
         AND result.prize_product_id=$4
         AND inventory.owner_id=$1
         AND inventory.status='OWNED'
       LIMIT 1`,
      [userId, fixture.drawProductId, fixture.templateProductId, fixture.prizeProductId],
    );
    if (existing.rowCount) continue;

    const source = await client.query<SourceProductRow>(
      `SELECT id,ip_id,category,price,image_url
       FROM catalog_products
       WHERE id=$1 AND is_active=true AND is_prize_only=false AND category IN ('gacha','kuji')
       FOR SHARE`,
      [fixture.templateProductId],
    );
    if (!source.rowCount) continue;

    const sourceRow = source.rows[0]!;
    await client.query(
      `INSERT INTO catalog_products(
         id,sku,ip_id,category,name,price,image_url,metadata,is_active,is_prize_only
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,true)
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.prizeProductId,
        fixture.prizeSku,
        sourceRow.ip_id,
        sourceRow.category,
        fixture.prizeName,
        Number(sourceRow.price),
        sourceRow.image_url,
        { developmentFixture: FIXTURE_KEY, templateProductId: sourceRow.id },
      ],
    );
    const prize = await client.query(
      `SELECT 1 FROM catalog_products
       WHERE id=$1 AND sku=$2 AND ip_id=$3 AND category=$4 AND name=$5
         AND image_url IS NOT DISTINCT FROM $6::text
         AND is_prize_only=true
         AND metadata->>'developmentFixture'=$7
         AND metadata->>'templateProductId'=$8`,
      [
        fixture.prizeProductId,
        fixture.prizeSku,
        sourceRow.ip_id,
        sourceRow.category,
        fixture.prizeName,
        sourceRow.image_url,
        FIXTURE_KEY,
        sourceRow.id,
      ],
    );
    if (!prize.rowCount) {
      throw new Error(`Development prize product is missing or invalid: ${fixture.prizeProductId}`);
    }

    await client.query(
      `INSERT INTO catalog_products(
         id,sku,ip_id,category,name,price,image_url,metadata,is_active,is_prize_only
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,false)
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.drawProductId,
        fixture.drawSku,
        sourceRow.ip_id,
        sourceRow.category,
        fixture.drawName,
        Number(sourceRow.price),
        sourceRow.image_url,
        { developmentFixture: FIXTURE_KEY, templateProductId: sourceRow.id },
      ],
    );
    const drawSource = await client.query<SourceProductRow>(
      `SELECT id,ip_id,category,price,image_url
       FROM catalog_products
       WHERE id=$1 AND is_prize_only=false AND category IN ('gacha','kuji')
         AND metadata->>'developmentFixture'=$2
         AND metadata->>'templateProductId'=$3
         AND ip_id=$4 AND category=$5
         AND image_url IS NOT DISTINCT FROM $6::text
       FOR UPDATE`,
      [
        fixture.drawProductId,
        FIXTURE_KEY,
        fixture.templateProductId,
        sourceRow.ip_id,
        sourceRow.category,
        sourceRow.image_url,
      ],
    );
    if (!drawSource.rowCount) {
      throw new Error(`Development draw source is missing or invalid: ${fixture.drawProductId}`);
    }

    const drawConfiguration = await ensureDevelopmentDrawConfiguration(
      client,
      fixture,
      drawSource.rows[0]!,
      userId,
    );
    fixtures.push({ ...fixture, source: drawSource.rows[0]!, ...drawConfiguration });
  }

  for (const fixture of fixtures) {
    const price = Number(fixture.source.price);
    const order = await client.query<{ id: string }>(
      `INSERT INTO orders(user_id,status,subtotal,total,paid_at)
       VALUES($1,'FULFILLED',$2,$2,now()) RETURNING id`,
      [userId, price],
    );
    const orderId = order.rows[0]!.id;
    const payment = await client.query<{ id: string }>(
      `INSERT INTO payments(order_id,provider,provider_payment_id,status,amount,paid_at)
       VALUES($1,'DEV_FIXTURE',$2,'PAID',$3,now()) RETURNING id`,
      [orderId, `${FIXTURE_KEY}:${orderId}`, price],
    );
    await client.query(
      `INSERT INTO payment_ledger_entries(
         payment_id,order_id,entry_type,amount,reference_id,reason
       ) VALUES($1,$2,'PAYMENT',$3,$4,'개발 테스트 계정 보관함 준비')`,
      [payment.rows[0]!.id, orderId, price, `${FIXTURE_KEY}:${orderId}`],
    );
    const orderLine = await client.query<{ id: string }>(
      `INSERT INTO order_lines(
         order_id,product_id,product_name_snapshot,category_snapshot,probability_version_id,
         unit_price,quantity,line_total
       ) VALUES($1,$2,$3,$4,$5,$6,1,$6) RETURNING id`,
      [
        orderId,
        fixture.source.id,
        `${fixture.prizeName} 추첨권`,
        fixture.source.category,
        fixture.probabilityVersionId,
        price,
      ],
    );
    const entitlement = await client.query<{ id: string }>(
      `INSERT INTO draw_entitlements(
         order_line_id,user_id,product_id,probability_version_id,status
       ) VALUES($1,$2,$3,$4,'AVAILABLE') RETURNING id`,
      [orderLine.rows[0]!.id, userId, fixture.source.id, fixture.probabilityVersionId],
    );
    const inventory = await client.query<{ id: string }>(
      `INSERT INTO inventory_units(owner_id,product_id,source_type,source_id,status)
       VALUES($1,$2,$3,$4,'OWNED') RETURNING id`,
      [userId, fixture.prizeProductId, fixture.sourceType, entitlement.rows[0]!.id],
    );
    let selectionAlgorithm = "SHA256_REJECTION_V1";
    let entropyHex: string | null;
    let entropyDigest: string | null;
    let rollValue: number | null = 0;
    let totalWeight: number | null = 1;
    let selectionSnapshot: Array<Record<string, unknown>>;
    let kujiSlotBindingId: string | null = null;
    if (fixture.kujiSlotAssignmentId) {
      await client.query(
        "INSERT INTO kuji_rooms(product_id) VALUES($1) ON CONFLICT (product_id) DO NOTHING",
        [fixture.source.id],
      );
      const roomEntry = await client.query<{ id: string }>(
        `INSERT INTO kuji_room_entries(product_id,user_id,order_id,state,resolved_at)
         VALUES($1,$2,$3,'EXPIRED',now()) RETURNING id`,
        [fixture.source.id, userId, orderId],
      );
      const binding = await client.query<{ id: string }>(
        `INSERT INTO kuji_slot_bindings(slot_assignment_id,entitlement_id,room_entry_id)
         VALUES($1,$2,$3) RETURNING id`,
        [fixture.kujiSlotAssignmentId, entitlement.rows[0]!.id, roomEntry.rows[0]!.id],
      );
      const decremented = await client.query(
        `UPDATE draw_pool_entries
         SET remaining_quantity=remaining_quantity-1
         WHERE id=$1 AND remaining_quantity>0 RETURNING id`,
        [fixture.poolEntryId],
      );
      if (decremented.rowCount !== 1) {
        throw new Error(`Development kuji prize pool is exhausted: ${fixture.source.id}`);
      }
      selectionAlgorithm = "KUJI_SEALED_SLOT_V1";
      entropyHex = null;
      entropyDigest = null;
      rollValue = null;
      totalWeight = null;
      kujiSlotBindingId = binding.rows[0]!.id;
      selectionSnapshot = [{ slotId: fixture.kujiSlotAssignmentId, slotNumber: 1 }];
    } else {
      const marker = `${FIXTURE_KEY}:${userId}:${fixture.slot}`;
      entropyHex = createHash("sha256").update(marker).digest("hex");
      entropyDigest = createHash("sha256").update(Buffer.from(entropyHex, "hex")).digest("hex");
      selectionSnapshot = [{ poolEntryId: fixture.poolEntryId, effectiveWeight: 1 }];
    }
    await client.query(
      `INSERT INTO draw_results(
         entitlement_id,user_id,product_id,pool_entry_id,prize_product_id,prize_inventory_unit_id,
         probability_version,selection_algorithm,entropy_hex,entropy_digest,roll_value,total_weight,
         selection_snapshot,kuji_slot_binding_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        entitlement.rows[0]!.id,
        userId,
        fixture.source.id,
        fixture.poolEntryId,
        fixture.prizeProductId,
        inventory.rows[0]!.id,
        fixture.probabilityVersion,
        selectionAlgorithm,
        entropyHex,
        entropyDigest,
        rollValue,
        totalWeight,
        JSON.stringify(selectionSnapshot),
        kujiSlotBindingId,
      ],
    );
    await client.query(
      "UPDATE draw_entitlements SET status='CONSUMED',consumed_at=now() WHERE id=$1",
      [entitlement.rows[0]!.id],
    );
  }
}

async function ensureDevelopmentDrawConfiguration(
  client: DatabaseClient,
  fixture: (typeof STORAGE_FIXTURES)[number],
  source: SourceProductRow,
  userId: string,
): Promise<{
  probabilityVersionId: string;
  probabilityVersion: number;
  poolEntryId: string;
  kujiSlotAssignmentId: string | null;
}> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`${FIXTURE_KEY}:${source.id}`],
  );
  const existing = await client.query<{
    probability_version_id: string;
    probability_version: number;
    pool_entry_id: string;
    kuji_deck_id: string | null;
    kuji_slot_assignment_id: string | null;
  }>(
    `SELECT version.id AS probability_version_id,version.version AS probability_version,
       entry.id AS pool_entry_id,deck.probability_version_id AS kuji_deck_id,
       assignment.id AS kuji_slot_assignment_id
     FROM draw_probability_versions version
     JOIN draw_pool_entries entry ON entry.probability_version_id=version.id
     LEFT JOIN kuji_decks deck ON deck.probability_version_id=version.id
     LEFT JOIN kuji_slot_assignments assignment
       ON assignment.probability_version_id=version.id
      AND assignment.pool_entry_id=entry.id
     WHERE version.product_id=$1 AND version.status='ACTIVE' AND entry.rarity=$2
       AND entry.prize_product_id=$3
       AND entry.prize_name_snapshot=$4
       AND entry.prize_image_url_snapshot IS NOT DISTINCT FROM $5::text
       AND entry.prize_sku_snapshot=$6
       AND entry.prize_ip_id_snapshot=$7
       AND entry.prize_category_snapshot=$8
     ORDER BY version.version DESC,assignment.slot_number LIMIT 1`,
    [
      source.id,
      fixtureRarity(fixture.slot),
      fixture.prizeProductId,
      fixture.prizeName,
      source.image_url,
      fixture.prizeSku,
      source.ip_id,
      source.category,
    ],
  );
  if (existing.rowCount) {
    const row = existing.rows[0]!;
    if (row.kuji_deck_id && !row.kuji_slot_assignment_id) {
      throw new Error(`Development kuji deck has no usable slot assignment: ${source.id}`);
    }
    await client.query(
      `UPDATE catalog_products SET is_active=false,updated_at=now()
       WHERE id=$1 AND metadata->>'developmentFixture'=$2`,
      [source.id, FIXTURE_KEY],
    );
    return {
      probabilityVersionId: row.probability_version_id,
      probabilityVersion: Number(row.probability_version),
      poolEntryId: row.pool_entry_id,
      kujiSlotAssignmentId: row.kuji_slot_assignment_id,
    };
  }

  await client.query(
    `UPDATE catalog_products SET is_active=true,updated_at=now()
     WHERE id=$1 AND metadata->>'developmentFixture'=$2`,
    [source.id, FIXTURE_KEY],
  );

  const nextVersion = await client.query<{ version: number }>(
    "SELECT COALESCE(MAX(version),0)::integer+1 AS version FROM draw_probability_versions WHERE product_id=$1",
    [source.id],
  );
  const probabilityVersion = Number(nextVersion.rows[0]!.version);
  const version = await client.query<{ id: string }>(
    `INSERT INTO draw_probability_versions(product_id,version,status)
     VALUES($1,$2,'DRAFT') RETURNING id`,
    [source.id, probabilityVersion],
  );
  const poolEntry = await client.query<{ id: string }>(
    `INSERT INTO draw_pool_entries(
       probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
       prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
       initial_quantity,remaining_quantity
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9) RETURNING id`,
    [
      version.rows[0]!.id,
      fixture.prizeProductId,
      fixture.prizeName,
      source.image_url,
      fixture.prizeSku,
      source.ip_id,
      source.category,
      fixtureRarity(fixture.slot),
      source.category === "kuji" ? 1 : null,
    ],
  );
  let kujiSlotAssignmentId: string | null = null;
  if (source.category === "kuji") {
    await client.query(
      "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,1)",
      [version.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank)
       VALUES($1,$2,$3,0)`,
      [version.rows[0]!.id, poolEntry.rows[0]!.id, fixtureRarity(fixture.slot)],
    );
    const assignment = await client.query<{ id: string }>(
      `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
       VALUES($1,1,$2) RETURNING id`,
      [version.rows[0]!.id, poolEntry.rows[0]!.id],
    );
    kujiSlotAssignmentId = assignment.rows[0]!.id;
  }
  const activated = await client.query(
    `UPDATE draw_probability_versions
     SET status='ACTIVE',published_by=$2,published_at=now()
     WHERE id=$1 AND status='DRAFT' RETURNING id`,
    [version.rows[0]!.id, userId],
  );
  if (activated.rowCount !== 1) {
    throw new Error(`Development draw version could not be activated: ${source.id}`);
  }
  await client.query(
    `UPDATE catalog_products SET is_active=false,updated_at=now()
     WHERE id=$1 AND metadata->>'developmentFixture'=$2`,
    [source.id, FIXTURE_KEY],
  );
  return {
    probabilityVersionId: version.rows[0]!.id,
    probabilityVersion,
    poolEntryId: poolEntry.rows[0]!.id,
    kujiSlotAssignmentId,
  };
}

async function provisionPlayableKujiCatalog(client: DatabaseClient, userId: string): Promise<void> {
  for (const fixture of STORAGE_FIXTURES.filter((item) => item.sourceType === "KUJI")) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`${FIXTURE_KEY}:playable-kuji:${fixture.templateProductId}`],
    );
    const product = await client.query<PlayableKujiFixtureRow>(
      `SELECT product.id AS product_id,product.ip_id,stock.on_hand,
              prize.name AS prize_name,prize.image_url AS prize_image_url,
              prize.sku AS prize_sku,prize.ip_id AS prize_ip_id,
              prize.category AS prize_category
       FROM catalog_products product
       JOIN product_stock stock ON stock.product_id=product.id
       JOIN catalog_products prize ON prize.id=$2
       WHERE product.id=$1
         AND product.category='kuji'
         AND product.is_active=true
         AND product.is_prize_only=false
         AND stock.on_hand>0
         AND prize.is_active=true
         AND prize.is_prize_only=true
         AND prize.ip_id=product.ip_id
         AND prize.sku=$3
         AND prize.name=$4
         AND prize.metadata->>'developmentFixture'=$5
         AND COALESCE(
           prize.metadata->>'templateProductId',
           prize.metadata->>'sourceProductId'
         )=$1
       FOR UPDATE OF product,stock,prize`,
      [
        fixture.templateProductId,
        fixture.prizeProductId,
        fixture.prizeSku,
        fixture.prizeName,
        FIXTURE_KEY,
      ],
    );
    if (!product.rowCount) continue;

    const active = await client.query<{ id: string; kuji_deck_id: string | null }>(
      `SELECT version.id,deck.probability_version_id AS kuji_deck_id
       FROM draw_probability_versions version
       LEFT JOIN kuji_decks deck ON deck.probability_version_id=version.id
       WHERE version.product_id=$1 AND version.status='ACTIVE'
       ORDER BY version.version DESC LIMIT 1
       FOR UPDATE OF version`,
      [fixture.templateProductId],
    );
    if (active.rows[0]?.kuji_deck_id) continue;
    if (active.rowCount) {
      const retired = await client.query(
        `UPDATE draw_probability_versions SET status='RETIRED'
         WHERE id=$1 AND status='ACTIVE' RETURNING id`,
        [active.rows[0]!.id],
      );
      if (retired.rowCount !== 1) {
        throw new Error(`Legacy development kuji version could not be retired: ${fixture.templateProductId}`);
      }
    }

    const row = product.rows[0]!;
    const quantity = Number(row.on_hand);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`Development kuji stock is invalid: ${fixture.templateProductId}`);
    }
    const nextVersion = await client.query<{ version: number }>(
      "SELECT COALESCE(MAX(version),0)::integer+1 AS version FROM draw_probability_versions WHERE product_id=$1",
      [fixture.templateProductId],
    );
    const versionNumber = Number(nextVersion.rows[0]!.version);
    const version = await client.query<{ id: string }>(
      `INSERT INTO draw_probability_versions(product_id,version,status)
       VALUES($1,$2,'DRAFT') RETURNING id`,
      [fixture.templateProductId, versionNumber],
    );
    const poolEntry = await client.query<{ id: string }>(
      `INSERT INTO draw_pool_entries(
         probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
         prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,
         initial_quantity,remaining_quantity
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9) RETURNING id`,
      [
        version.rows[0]!.id,
        fixture.prizeProductId,
        row.prize_name,
        row.prize_image_url,
        row.prize_sku,
        row.prize_ip_id,
        row.prize_category,
        `${fixtureRarity(fixture.slot)}_PLAYABLE`,
        quantity,
      ],
    );
    await client.query(
      "INSERT INTO kuji_decks(probability_version_id,total_slots) VALUES($1,$2)",
      [version.rows[0]!.id, quantity],
    );
    await client.query(
      `INSERT INTO kuji_deck_tiers(probability_version_id,pool_entry_id,tier_code,tier_rank)
       VALUES($1,$2,$3,0)`,
      [version.rows[0]!.id, poolEntry.rows[0]!.id, `${fixtureRarity(fixture.slot)}_PLAYABLE`],
    );
    await client.query(
      `INSERT INTO kuji_slot_assignments(probability_version_id,slot_number,pool_entry_id)
       SELECT $1,slot_number,$2
       FROM generate_series(1,$3) AS slot_number`,
      [version.rows[0]!.id, poolEntry.rows[0]!.id, quantity],
    );
    const activated = await client.query(
      `UPDATE draw_probability_versions
       SET status='ACTIVE',published_by=$2,published_at=now()
       WHERE id=$1 AND status='DRAFT' RETURNING id`,
      [version.rows[0]!.id, userId],
    );
    if (activated.rowCount !== 1) {
      throw new Error(`Development kuji version could not be activated: ${fixture.templateProductId}`);
    }
  }
}

function fixtureRarity(slot: string): string {
  return `DEV_FIXTURE_${slot.toUpperCase()}`;
}
