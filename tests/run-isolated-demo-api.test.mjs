import assert from "node:assert/strict";
import test from "node:test";

import {
  isolatedDemoApiEnvironment,
  isolatedDemoDatabaseUrl,
  pendingIsolatedDemoMigrations,
  repositoryMigrations,
  runIsolatedDemoApi,
} from "../scripts/run-isolated-demo-api.mjs";
import { assertFreshDemoFixture } from "../scripts/seed-local-demo-commerce.mjs";

test("isolated demo API accepts only the approved local owner connection", () => {
  const source = "postgresql://dabboba:secret@127.0.0.1:55433/dabboba_development";
  assert.equal(
    isolatedDemoDatabaseUrl(source),
    "postgresql://dabboba:secret@127.0.0.1:55433/dabboba_flow_test_20260924",
  );
  for (const unsafe of [
    source.replace("127.0.0.1", "db.example.test"),
    source.replace("55433", "5432"),
    source.replace("dabboba_development", "postgres"),
    source.replace("dabboba:secret", "postgres:secret"),
    `${source}?sslmode=require`,
  ]) assert.throws(() => isolatedDemoDatabaseUrl(unsafe));
});

test("isolated demo API passes only local TEST_PG settings to the child", () => {
  const databaseUrl = isolatedDemoDatabaseUrl(
    "postgresql://dabboba:secret@127.0.0.1:55433/dabboba_development",
  );
  const environment = isolatedDemoApiEnvironment(databaseUrl, {
    PATH: "/usr/bin",
    HOME: "/tmp/dabboba-test-home",
    DATABASE_URL: "postgresql://owner:secret@db.example.test:5432/production",
    PORTONE_API_SECRET: "must-not-be-inherited",
  });
  assert.equal(environment.DATABASE_URL, databaseUrl);
  assert.equal(environment.NODE_ENV, "test");
  assert.equal(environment.DABBOBA_ENVIRONMENT_TIER, "TEST");
  assert.equal(environment.PAYMENT_PROVIDER, "TEST_PG");
  assert.equal(environment.DABBOBA_COMMERCE_MODE, "LIVE");
  assert.equal(environment.API_HOST, "127.0.0.1");
  assert.equal(environment.API_PORT, "8788");
  assert.equal(environment.PORTONE_API_SECRET, undefined);
  assert.notEqual(environment.SESSION_TOKEN_PEPPER, environment.PAYMENT_WEBHOOK_SECRET);
  assert.throws(() => isolatedDemoApiEnvironment(
    "postgresql://owner:secret@db.example.test:5432/production",
  ));
});

test("isolated demo API needs an explicit run flag before reading a database", async () => {
  await assert.rejects(runIsolatedDemoApi([]), /Explicit --run/);
  await assert.rejects(runIsolatedDemoApi(["--host-clock-db"]), /Explicit --run/);
  await assert.rejects(runIsolatedDemoApi(["--run", "--host-clock-db"], {
    DABBOBA_LOCAL_DEMO_DATABASE_URL: "postgresql://tester:secret@127.0.0.1:55433/dabboba_flow_test_20260924",
  }), /exact isolated fixture database on port 55441/);
});

test("isolated demo preflight accepts a fully migrated fixture and names pending migrations", () => {
  const migrations = repositoryMigrations();
  assert.ok(migrations.includes("0066_worker_pgmq_set_vt_dependency.sql"));
  assert.ok(migrations.at(-1) > "0066_worker_pgmq_set_vt_dependency.sql", "later migrations exist");
  assert.deepEqual(pendingIsolatedDemoMigrations(migrations), [], "every current migration applied is ready");
  assert.deepEqual(pendingIsolatedDemoMigrations(migrations.slice(0, -1)), [migrations.at(-1)]);
  assert.deepEqual(
    pendingIsolatedDemoMigrations(migrations.filter((file) => !file.startsWith("0066_"))),
    ["0066_worker_pgmq_set_vt_dependency.sql"],
  );
});

test("a fixture with consumed draws or bound kuji slots is refused instead of approved", async () => {
  const queryable = (row) => ({ query: async () => ({ rows: [row] }) });
  await assertFreshDemoFixture(queryable({ consumed_pool_entries: 0, used_kuji_slots: 0 }));
  await assert.rejects(assertFreshDemoFixture(queryable({ consumed_pool_entries: 2, used_kuji_slots: 0 })), /consumed draws/);
  await assert.rejects(assertFreshDemoFixture(queryable({ consumed_pool_entries: 0, used_kuji_slots: 1 })), /recreate the dabboba_flow_test database/);
});
