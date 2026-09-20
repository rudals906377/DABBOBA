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

test("mobile test account provisioning does not create sample catalog or inventory records", async () => {
  const observed: ObservedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: MOBILE_TEST_EMAIL,
  });

  assert.equal(observed.some(({ sql }) => /catalog_products|inventory_units|draw_results|orders/.test(sql)), false);
  assert.equal(observed.some(({ sql }) => sql.includes("default_shipping_addresses")), true);
  assert.equal(observed.some(({ sql }) => sql.includes("point_accounts")), true);
  assert.equal(observed.some(({ sql }) => sql.includes("point_ledger_entries")), true);
});

test("mobile test welcome points remain idempotent", async () => {
  const observed: ObservedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      observed.push({ sql, params });
      if (sql.includes("INSERT INTO point_ledger_entries")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  } as unknown as DatabaseClient;

  await provisionMobileTestAccount(client, {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: MOBILE_TEST_EMAIL,
  });

  assert.equal(observed.some(({ sql }) => sql.includes("UPDATE point_accounts")), false);
  assert.ok(observed.every(({ sql }) => !sql.includes("DELETE FROM")));
});
