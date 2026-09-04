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
      if (sql.includes("FROM draw_probability_versions") && sql.includes("status='ACTIVE'")) {
        return { rowCount: 1, rows: [{ exists: 1 }] };
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

test("mobile test fixtures create four provenance-linked stored draws", async () => {
  const observed: ObservedQuery[] = [];
  let versionSequence = 0;
  let poolSequence = 0;
  let lineSequence = 0;
  let entitlementSequence = 0;
  let inventorySequence = 0;
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
      if (sql.includes("SET status='ACTIVE'") && sql.includes("RETURNING id")) {
        return { rowCount: 1, rows: [{ id: String(params[0]) }] };
      }
      if (sql.includes("INSERT INTO orders")) return { rowCount: 1, rows: [{ id: "fixture-order" }] };
      if (sql.includes("INSERT INTO payments")) return { rowCount: 1, rows: [{ id: "fixture-payment" }] };
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
  assert.ok(drawWrites.every(({ params }) => {
    const snapshot = JSON.parse(String(params[9])) as Array<{ poolEntryId?: string; effectiveWeight?: number }>;
    return typeof snapshot[0]?.poolEntryId === "string" && snapshot[0]?.effectiveWeight === 1;
  }));
  const orderWrite = observed.find(({ sql }) => sql.includes("INSERT INTO orders"));
  assert.equal(orderWrite?.params[1], 35_800);
  assert.equal(observed.filter(({ sql }) => sql.includes("UPDATE point_accounts")).length, 1);
  assert.equal(observed.filter(({ sql }) => sql.includes("SET status='ACTIVE'")).length, 6);
  assert.equal(observed.filter(({ sql }) => sql.includes("SET is_active=false")).length, 4);
  const finiteKujiPools = observed.filter(({ sql, params }) => (
    sql.includes("initial_quantity,remaining_quantity") && params.length === 9
  ));
  assert.deepEqual(finiteKujiPools.map(({ params }) => params[8]), [30, 36]);
});
