import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "@dabboba/db";
import {
  developmentSessionEnabled,
  mobileTestFixturesEnabled,
  MOBILE_TEST_EMAIL,
  provisionMobileTestAccount,
} from "./development-fixtures.js";

type ObservedQuery = { sql: string; params: unknown[] };

test("development session requires an explicit local opt-in outside tests", () => {
  assert.equal(developmentSessionEnabled({ environment: "test" }), true);
  assert.equal(developmentSessionEnabled({ environment: "development" }), false);
  assert.equal(developmentSessionEnabled({ environment: "development", explicitFlag: "true" }), true);
  assert.equal(developmentSessionEnabled({ environment: "production", explicitFlag: "true" }), false);
});

test("mobile fixtures require the exact opted-in database project", () => {
  const poolerUrl = "postgresql://postgres.project-ref:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";
  const directUrl = "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres";
  assert.equal(mobileTestFixturesEnabled({
    environment: "development",
    databaseUrl: poolerUrl,
    explicitFlag: "true",
    expectedProjectRef: "project-ref",
  }), true);
  assert.equal(mobileTestFixturesEnabled({
    environment: "development",
    databaseUrl: directUrl,
    explicitFlag: "true",
    expectedProjectRef: "project-ref",
  }), true);
  assert.equal(mobileTestFixturesEnabled({
    environment: "development",
    databaseUrl: poolerUrl,
    explicitFlag: "true",
    expectedProjectRef: "another-project",
  }), false);
  assert.equal(mobileTestFixturesEnabled({
    environment: "development",
    databaseUrl: poolerUrl,
    explicitFlag: "false",
    expectedProjectRef: "project-ref",
  }), false);
  assert.equal(mobileTestFixturesEnabled({
    environment: "production",
    databaseUrl: poolerUrl,
    explicitFlag: "true",
    expectedProjectRef: "project-ref",
  }), false);
  assert.equal(mobileTestFixturesEnabled({
    environment: "development",
    databaseUrl: "postgresql://dabboba:secret@127.0.0.1:55433/dabboba",
    explicitFlag: "true",
    expectedProjectRef: "local",
  }), true);
});

test("development fixtures never run for another account", async () => {
  const client = {
    async query() {
      throw new Error("non-test accounts must not touch fixture tables");
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "customer@example.test",
  });
});

test("mobile test fixtures are idempotent when all durable draws already exist", async () => {
  const observed: ObservedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM draw_results result")) return { rowCount: 1, rows: [{ exists: 1 }] };
      if (sql.includes("FROM catalog_products product") && sql.includes("JOIN product_stock stock")) {
        return {
          rowCount: 1,
          rows: [{
            product_id: String(params[0]),
            ip_id: "fixture-ip",
            on_hand: 50,
            prize_name: "기존 경품",
            prize_image_url: null,
            prize_sku: "EXISTING-PRIZE",
            prize_ip_id: "fixture-ip",
            prize_category: "kuji",
          }],
        };
      }
      if (sql.includes("FROM draw_probability_versions version") && sql.includes("LEFT JOIN kuji_decks")) {
        return { rowCount: 1, rows: [{ id: "sealed-version", kuji_deck_id: "sealed-version" }] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: MOBILE_TEST_EMAIL,
  });

  assert.equal(observed.filter(({ sql }) => sql.includes("FROM draw_results result")).length, 4);
  assert.equal(observed.some(({ sql }) => sql.includes("INSERT INTO orders")), false);
  assert.equal(observed.some(({ sql }) => sql.includes("INSERT INTO draw_probability_versions")), false);
  assert.equal(observed.some(({ sql }) => sql.includes("UPDATE point_accounts")), false);
  assert.ok(observed.every(({ sql }) => !sql.includes("DELETE FROM")));
});

test("playable fixtures retire a legacy deckless active KUJI before publishing a sealed deck", async () => {
  const observed: ObservedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM draw_results result")) return { rowCount: 1, rows: [{ exists: 1 }] };
      if (sql.includes("FROM catalog_products product") && sql.includes("JOIN product_stock stock")) {
        return {
          rowCount: 1,
          rows: [{
            product_id: String(params[0]),
            ip_id: "fixture-ip",
            on_hand: 12,
            prize_name: "기존 경품",
            prize_image_url: null,
            prize_sku: "EXISTING-PRIZE",
            prize_ip_id: "fixture-ip",
            prize_category: "kuji",
          }],
        };
      }
      if (sql.includes("FROM draw_probability_versions version") && sql.includes("LEFT JOIN kuji_decks")) {
        return params[0] === "mobile-suit-gundam-kuji"
          ? { rowCount: 1, rows: [{ id: "legacy-active", kuji_deck_id: null }] }
          : { rowCount: 1, rows: [{ id: "sealed-active", kuji_deck_id: "sealed-active" }] };
      }
      if (sql.includes("SET status='RETIRED'")) {
        return { rowCount: 1, rows: [{ id: String(params[0]) }] };
      }
      if (sql.includes("MAX(version)")) return { rowCount: 1, rows: [{ version: 2 }] };
      if (sql.includes("INSERT INTO draw_probability_versions")) {
        return { rowCount: 1, rows: [{ id: "replacement-version" }] };
      }
      if (sql.includes("INSERT INTO draw_pool_entries")) {
        return { rowCount: 1, rows: [{ id: "replacement-pool" }] };
      }
      if (sql.includes("SET status='ACTIVE'") && sql.includes("RETURNING id")) {
        return { rowCount: 1, rows: [{ id: String(params[0]) }] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: MOBILE_TEST_EMAIL,
  });

  const retired = observed.filter(({ sql }) => sql.includes("SET status='RETIRED'"));
  assert.equal(retired.length, 1);
  assert.equal(retired[0]?.params[0], "legacy-active");
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_decks")).length, 1);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_deck_tiers")).length, 1);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_slot_assignments")).length, 1);
  const deckIndex = observed.findIndex(({ sql }) => sql.includes("INSERT INTO kuji_decks"));
  const tierIndex = observed.findIndex(({ sql }) => sql.includes("INSERT INTO kuji_deck_tiers"));
  const assignmentIndex = observed.findIndex(({ sql }) => sql.includes("INSERT INTO kuji_slot_assignments"));
  const activationIndex = observed.findIndex(({ sql }) => sql.includes("SET status='ACTIVE'"));
  assert.ok(deckIndex < tierIndex && tierIndex < assignmentIndex && assignmentIndex < activationIndex);
  assert.equal(observed.some(({ sql }) => sql.includes("INSERT INTO orders")), false);
});

test("mobile test fixtures create four provenance-linked stored draws", async () => {
  const observed: ObservedQuery[] = [];
  let versionSequence = 0;
  let poolSequence = 0;
  let assignmentSequence = 0;
  let orderSequence = 0;
  let paymentSequence = 0;
  let lineSequence = 0;
  let entitlementSequence = 0;
  let inventorySequence = 0;
  let roomSequence = 0;
  let bindingSequence = 0;
  const sources = new Map([
    ["spy-x-family-gacha", { id: "spy-x-family-gacha", ip_id: "spy-x-family", category: "gacha", price: 9_000, image_url: "/spy.jpg" }],
    ["blue-lock-gacha", { id: "blue-lock-gacha", ip_id: "blue-lock", category: "gacha", price: 6_000, image_url: "/blue.jpg" }],
    ["mobile-suit-gundam-kuji", { id: "mobile-suit-gundam-kuji", ip_id: "gundam", category: "kuji", price: 10_900, image_url: "/gundam.jpg" }],
    ["evangelion-kuji", { id: "evangelion-kuji", ip_id: "evangelion", category: "kuji", price: 9_900, image_url: "/eva.jpg" }],
  ]);
  const drawSources = new Map([
    ["dev-draw-spy-family-gacha", { id: "dev-draw-spy-family-gacha", ip_id: "spy-x-family", category: "gacha", price: 9_000, image_url: "/spy.jpg" }],
    ["dev-draw-blue-lock-gacha", { id: "dev-draw-blue-lock-gacha", ip_id: "blue-lock", category: "gacha", price: 6_000, image_url: "/blue.jpg" }],
    ["dev-draw-gundam-kuji", { id: "dev-draw-gundam-kuji", ip_id: "gundam", category: "kuji", price: 10_900, image_url: "/gundam.jpg" }],
    ["dev-draw-evangelion-kuji", { id: "dev-draw-evangelion-kuji", ip_id: "evangelion", category: "kuji", price: 9_900, image_url: "/eva.jpg" }],
  ]);
  const playableKuji = new Map([
    ["mobile-suit-gundam-kuji", {
      product_id: "mobile-suit-gundam-kuji",
      ip_id: "gundam",
      on_hand: 30,
      prize_name: "건담 아크릴 스탠드 (테스트)",
      prize_image_url: "/gundam.jpg",
      prize_sku: "DEV-PRIZE-GUNDAM-ACRYLIC",
      prize_ip_id: "gundam",
      prize_category: "kuji",
    }],
    ["evangelion-kuji", {
      product_id: "evangelion-kuji",
      ip_id: "evangelion",
      on_hand: 36,
      prize_name: "에반게리온 30주년 마스코트 (테스트)",
      prize_image_url: "/eva.jpg",
      prize_sku: "DEV-PRIZE-EVANGELION-MASCOT",
      prize_ip_id: "evangelion",
      prize_category: "kuji",
    }],
  ]);
  const client = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 1, rows: [{ id: "point-ledger" }] };
      if (sql.includes("FROM draw_results result")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM catalog_products") && sql.includes("FOR SHARE")) {
        const source = sources.get(String(params[0]));
        return { rowCount: source ? 1 : 0, rows: source ? [source] : [] };
      }
      if (sql.includes("SELECT 1 FROM catalog_products") && sql.includes("is_prize_only=true")) {
        return { rowCount: 1, rows: [{ exists: 1 }] };
      }
      if (sql.includes("FROM catalog_products product") && sql.includes("JOIN product_stock stock")) {
        const source = playableKuji.get(String(params[0]));
        return { rowCount: source ? 1 : 0, rows: source ? [source] : [] };
      }
      if (sql.includes("FROM catalog_products") && sql.includes("FOR UPDATE")) {
        const source = drawSources.get(String(params[0]));
        return { rowCount: source ? 1 : 0, rows: source ? [source] : [] };
      }
      if (sql.includes("JOIN draw_pool_entries entry")) return { rowCount: 0, rows: [] };
      if (sql.includes("MAX(version)")) return { rowCount: 1, rows: [{ version: 1 }] };
      if (sql.includes("INSERT INTO draw_probability_versions")) {
        versionSequence += 1;
        return { rowCount: 1, rows: [{ id: `version-${versionSequence}` }] };
      }
      if (sql.includes("INSERT INTO draw_pool_entries")) {
        poolSequence += 1;
        return { rowCount: 1, rows: [{ id: `pool-${poolSequence}` }] };
      }
      if (sql.includes("INSERT INTO kuji_slot_assignments")) {
        assignmentSequence += 1;
        return { rowCount: 1, rows: [{ id: `assignment-${assignmentSequence}` }] };
      }
      if (sql.includes("SET status='ACTIVE'") && sql.includes("RETURNING id")) {
        return { rowCount: 1, rows: [{ id: String(params[0]) }] };
      }
      if (sql.includes("INSERT INTO orders")) {
        orderSequence += 1;
        return { rowCount: 1, rows: [{ id: `fixture-order-${orderSequence}` }] };
      }
      if (sql.includes("INSERT INTO payments")) {
        paymentSequence += 1;
        return { rowCount: 1, rows: [{ id: `fixture-payment-${paymentSequence}` }] };
      }
      if (sql.includes("INSERT INTO order_lines")) {
        lineSequence += 1;
        return { rowCount: 1, rows: [{ id: `line-${lineSequence}` }] };
      }
      if (sql.includes("INSERT INTO draw_entitlements")) {
        entitlementSequence += 1;
        return { rowCount: 1, rows: [{ id: `entitlement-${entitlementSequence}` }] };
      }
      if (sql.includes("INSERT INTO inventory_units")) {
        inventorySequence += 1;
        return { rowCount: 1, rows: [{ id: `inventory-${inventorySequence}` }] };
      }
      if (sql.includes("INSERT INTO kuji_room_entries")) {
        roomSequence += 1;
        return { rowCount: 1, rows: [{ id: `room-${roomSequence}` }] };
      }
      if (sql.includes("INSERT INTO kuji_slot_bindings")) {
        bindingSequence += 1;
        return { rowCount: 1, rows: [{ id: `binding-${bindingSequence}` }] };
      }
      if (sql.includes("UPDATE draw_pool_entries") && sql.includes("remaining_quantity-1")) {
        return { rowCount: 1, rows: [{ id: String(params[0]) }] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: MOBILE_TEST_EMAIL,
  });

  const inventoryWrites = observed.filter(({ sql }) => sql.includes("INSERT INTO inventory_units"));
  const drawWrites = observed.filter(({ sql }) => sql.includes("INSERT INTO draw_results"));
  assert.equal(inventoryWrites.length, 4);
  assert.equal(drawWrites.length, 4);
  assert.deepEqual(inventoryWrites.map(({ params }) => params[2]), ["GACHA", "GACHA", "KUJI", "KUJI"]);
  assert.deepEqual(drawWrites.map(({ params }) => params[7]), [
    "SHA256_REJECTION_V1",
    "SHA256_REJECTION_V1",
    "KUJI_SEALED_SLOT_V1",
    "KUJI_SEALED_SLOT_V1",
  ]);
  assert.ok(drawWrites.slice(0, 2).every(({ params }) => {
    const snapshot = JSON.parse(String(params[12])) as Array<{ poolEntryId?: string; effectiveWeight?: number }>;
    return typeof snapshot[0]?.poolEntryId === "string" && snapshot[0]?.effectiveWeight === 1;
  }));
  assert.ok(drawWrites.slice(2).every(({ params }) => {
    const snapshot = JSON.parse(String(params[12])) as Array<{ slotId?: string; slotNumber?: number }>;
    return typeof snapshot[0]?.slotId === "string"
      && snapshot[0]?.slotNumber === 1
      && params.slice(8, 12).every((value) => value === null)
      && typeof params[13] === "string";
  }));
  const orderWrites = observed.filter(({ sql }) => sql.includes("INSERT INTO orders"));
  assert.deepEqual(orderWrites.map(({ params }) => params[1]), [9_000, 6_000, 10_900, 9_900]);
  assert.equal(observed.filter(({ sql }) => sql.includes("UPDATE point_accounts")).length, 1);
  assert.equal(observed.filter(({ sql }) => sql.includes("SET status='ACTIVE'")).length, 6);
  assert.equal(observed.filter(({ sql }) => sql.includes("SET is_active=false")).length, 4);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_rooms")).length, 2);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_room_entries")).length, 2);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_slot_bindings")).length, 2);
  assert.equal(observed.filter(({ sql }) => sql.includes("UPDATE draw_entitlements SET status='CONSUMED'")).length, 4);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_decks")).length, 4);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_deck_tiers")).length, 4);
  assert.equal(observed.filter(({ sql }) => sql.includes("INSERT INTO kuji_slot_assignments")).length, 4);
  const finiteKujiPools = observed.filter(({ sql, params }) => (
    sql.includes("initial_quantity,remaining_quantity") && params[8] !== null
  ));
  assert.deepEqual(finiteKujiPools.map(({ params }) => params[8]), [1, 1, 30, 36]);
});
