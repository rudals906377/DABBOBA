#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMigrationDatabasePool } from "../packages/db/dist/index.js";
import { loadApiConfig } from "../packages/config/dist/index.js";
import { readLocalBackendProfileEnv } from "./local-backend-profile.mjs";
import { assertFreshDemoFixture, assertIsolatedDemoDatabaseUrl } from "./seed-local-demo-commerce.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const TEST_DATABASE = "dabboba_flow_test_20260924";
const REQUIRED_MIGRATION = "0066_worker_pgmq_set_vt_dependency.sql";

export function repositoryMigrations(
  directory = new URL("../packages/db/migrations/", import.meta.url),
) {
  return readdirSync(directory).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
}

/**
 * The fixture is current only when every repository migration has been applied,
 * which also covers the minimum TEST_PG schema; a later migration is not stale.
 */
export function pendingIsolatedDemoMigrations(appliedVersions, migrations = repositoryMigrations()) {
  const applied = new Set(appliedVersions);
  if (!applied.has(REQUIRED_MIGRATION)) return [REQUIRED_MIGRATION];
  return migrations.filter((file) => !applied.has(file));
}

export function isolatedDemoDatabaseUrl(sourceUrl) {
  const source = new URL(sourceUrl);
  if (
    source.protocol !== "postgresql:"
    || source.hostname !== "127.0.0.1"
    || source.port !== "55433"
    || source.pathname !== "/dabboba_development"
    || decodeURIComponent(source.username) !== "dabboba"
    || !source.password || source.search || source.hash
  ) throw new Error("The approved local migration connection is required.");
  source.pathname = `/${TEST_DATABASE}`;
  return assertIsolatedDemoDatabaseUrl(source.toString());
}

export function isolatedDemoApiEnvironment(databaseUrl, systemEnv = process.env) {
  assertIsolatedDemoDatabaseUrl(databaseUrl);
  const environment = {
    ...Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
        .filter((key) => typeof systemEnv[key] === "string")
        .map((key) => [key, systemEnv[key]]),
    ),
    NODE_ENV: "test",
    DABBOBA_ENVIRONMENT_TIER: "TEST",
    DABBOBA_RELEASE_ENVIRONMENT_TIER: "TEST",
    DABBOBA_BACKEND_PROFILE: "supabase-demo",
    DABBOBA_ENABLE_DEMO_TESTING: "true",
    DABBOBA_DEMO_FIXTURE_TAG: "supabase-demo-v1",
    DABBOBA_COMMERCE_MODE: "LIVE",
    PAYMENT_PROVIDER: "TEST_PG",
    PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    SESSION_TOKEN_PEPPER: randomBytes(32).toString("hex"),
    API_HOST: "127.0.0.1",
    API_PORT: "8788",
    API_SURFACE: "customer",
    DATABASE_URL: databaseUrl,
  };
  const config = loadApiConfig(environment);
  if (
    config.environment !== "test"
    || config.environmentTier !== "TEST"
    || config.host !== "127.0.0.1"
    || config.port !== 8788
    || config.commerceMode !== "LIVE"
    || config.paymentProvider !== "TEST_PG"
  ) throw new Error("The isolated demo API configuration is invalid.");
  return environment;
}

export async function assertReadyIsolatedDemoDatabase(databaseUrl) {
  assertIsolatedDemoDatabaseUrl(databaseUrl);
  const pool = createMigrationDatabasePool(databaseUrl, "dabboba-isolated-demo-preflight");
  try {
    const result = await pool.query(`SELECT
      current_database() AS database,
      (SELECT array_agg(version ORDER BY version) FROM schema_migrations) AS applied_migrations,
      (SELECT count(*)::integer FROM users WHERE id='da000000-0000-4000-8000-00000000000a'
        AND email='member01@dabboba.local' AND status='ACTIVE') AS account_count,
      (SELECT count(*)::integer FROM catalog_products WHERE
        ((id='gacha-demon-slayer-onemutan-13' AND name='예시상품 A (가챠)' AND category='gacha') OR
         (id='kuji-sylvanian-adventure' AND name='예시상품 B (쿠지)' AND category='kuji'))
        AND sale_status='ON_SALE' AND metadata->>'dabbobaFixture'='supabase-demo-v1') AS product_count,
      (SELECT count(*)::integer FROM draw_probability_versions WHERE product_id IN
        ('gacha-demon-slayer-onemutan-13','kuji-sylvanian-adventure')
        AND status='ACTIVE') AS active_draws,
      (SELECT count(*)::integer FROM home_catalog_sections WHERE id IN
        ('local-example-gacha','local-example-kuji') AND is_active=true) AS home_sections`);
    const row = result.rows[0];
    if (
      row?.database !== TEST_DATABASE
      || pendingIsolatedDemoMigrations(row.applied_migrations ?? []).length > 0
      || row.account_count !== 1
      || row.product_count !== 2
      || row.active_draws !== 2
      || row.home_sections !== 2
    ) throw new Error("The isolated example fixture is incomplete.");
    await assertFreshDemoFixture(pool);
  } finally {
    await pool.end();
  }
}

export async function runIsolatedDemoApi(argv = process.argv.slice(2), env = process.env) {
  const hostClockDatabase = argv.length === 2 && argv[0] === "--run" && argv[1] === "--host-clock-db";
  if (!hostClockDatabase && (argv.length !== 1 || argv[0] !== "--run")) {
    throw new Error("Explicit --run is required for the isolated TEST_PG API.");
  }
  const databaseUrl = hostClockDatabase
    ? assertIsolatedDemoDatabaseUrl(env.DABBOBA_LOCAL_DEMO_DATABASE_URL)
    : isolatedDemoDatabaseUrl(readLocalBackendProfileEnv().DATABASE_MIGRATION_URL);
  if (hostClockDatabase && (
    new URL(databaseUrl).port !== "55441"
    || new URL(databaseUrl).pathname !== `/${TEST_DATABASE}`
  )) throw new Error("The host-clock TEST_PG API requires the exact isolated fixture database on port 55441.");
  await assertReadyIsolatedDemoDatabase(databaseUrl);
  const environment = isolatedDemoApiEnvironment(databaseUrl);
  process.stdout.write("Starting isolated TEST_PG API on 127.0.0.1:8788; no real charges.\n");
  const child = spawn("corepack", ["pnpm", "--filter", "@dabboba/api", "exec", "tsx", "src/index.ts"], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIsolatedDemoApi().catch(() => {
    process.stderr.write("Isolated TEST_PG API could not start; no connection details were printed.\n");
    process.exitCode = 1;
  });
}
