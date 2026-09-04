import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import {
  assertDisposableIntegrationDatabaseTarget,
  assertProductionMigrationDatabaseTarget,
  assertProductionRuntimeDatabaseRole,
  createDatabasePool,
  databaseConnectionConfig,
  databaseSslConfig,
} from "./index.js";
import { WORKER_DATABASE_ROLE } from "./runtime-role.js";

test("production Supabase runtime connections require the restricted database role", () => {
  const pooler = "aws-0-ap-northeast-2.pooler.supabase.com";
  assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
    `postgresql://dabboba_runtime.abcdefghijklmnopqrst:p%40ss%3Aword@${pooler}:5432/postgres`,
    "production",
  ));
  assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
    "postgresql://dabboba_runtime:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "production",
  ));

  for (const databaseUrl of [
    `postgresql://postgres.abcdefghijklmnopqrst:secret@${pooler}:5432/postgres`,
    "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    `postgresql://dabboba_runtime:secret@${pooler}:5432/postgres`,
  ]) {
    assert.throws(
      () => assertProductionRuntimeDatabaseRole(databaseUrl, "production"),
      /restricted dabboba_runtime database role/,
    );
  }
});

test("database target guards do not constrain non-production databases", () => {
  for (const databaseUrl of [
    "postgresql://postgres:secret@localhost:55433/dabboba",
    "postgresql://postgres:secret@127.0.0.1:55433/dabboba",
    "postgresql://postgres:secret@[::1]:55433/dabboba",
  ]) {
    assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
      databaseUrl,
      "test",
    ));
    assert.doesNotThrow(() => assertProductionMigrationDatabaseTarget(databaseUrl, "test"));
  }
  assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
    "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
    "development",
  ));
});

test("production database target guards fail closed for invalid and non-Supabase URLs", () => {
  for (const databaseUrl of [
    "not-a-database-url",
    "https://dabboba_runtime:secret@db.project.supabase.co/postgres",
  ]) {
    assert.throws(
      () => assertProductionRuntimeDatabaseRole(databaseUrl, "production"),
      /valid PostgreSQL URL|postgres:\/\/ or postgresql:\/\//,
    );
    assert.throws(
      () => assertProductionMigrationDatabaseTarget(databaseUrl, "production"),
      /valid PostgreSQL URL|postgres:\/\/ or postgresql:\/\//,
    );
  }

  for (const [databaseUrl, expectedRole] of [
    ["postgresql://postgres:secret@localhost:5432/postgres", undefined],
    ["postgresql://postgres:secret@127.0.0.1:5432/postgres", undefined],
    ["postgresql://postgres:secret@db.example.test:5432/postgres", undefined],
    ["postgresql://dabboba_runtime:secret@host.docker.internal:5432/postgres", undefined],
    ["postgresql://dabboba_worker:secret@database.internal:5432/postgres", WORKER_DATABASE_ROLE],
  ] as const) {
    assert.throws(
      () => assertProductionRuntimeDatabaseRole(databaseUrl, "production", expectedRole),
      /approved Supabase hostname/,
    );
    assert.throws(
      () => assertProductionMigrationDatabaseTarget(databaseUrl, "production"),
      /approved Supabase hostname/,
    );
  }
});

test("production migration target accepts verified Supabase endpoints without requiring a runtime role", () => {
  assert.doesNotThrow(() => assertProductionMigrationDatabaseTarget(
    "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
    "production",
  ));
  assert.doesNotThrow(() => assertProductionMigrationDatabaseTarget(
    "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "production",
  ));
});

test("production worker connections require the worker role and Session pooler", () => {
  const pooler = "aws-0-ap-northeast-2.pooler.supabase.com";
  assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
    `postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@${pooler}:5432/postgres`,
    "production",
    WORKER_DATABASE_ROLE,
  ));
  assert.doesNotThrow(() => assertProductionRuntimeDatabaseRole(
    "postgresql://dabboba_worker:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "production",
    WORKER_DATABASE_ROLE,
  ));
  assert.throws(() => assertProductionRuntimeDatabaseRole(
    `postgresql://dabboba_runtime.abcdefghijklmnopqrst:secret@${pooler}:5432/postgres`,
    "production",
    WORKER_DATABASE_ROLE,
  ), /restricted dabboba_worker database role/);
  assert.throws(() => assertProductionRuntimeDatabaseRole(
    `postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@${pooler}:6543/postgres`,
    "production",
    WORKER_DATABASE_ROLE,
  ), /Session mode.*5432.*session advisory lock/);
  assert.throws(() => assertProductionRuntimeDatabaseRole(
    `postgresql://dabboba_worker.abcdefghijklmnopqrst:secret@${pooler}/postgres`,
    "production",
    WORKER_DATABASE_ROLE,
  ), /Session mode.*5432/);
});

test("runtime pool operation timeouts are bounded", async () => {
  assert.throws(() => createDatabasePool(
    "postgresql://dabboba_runtime:secret@127.0.0.1:55433/dabboba",
    "dabboba-timeout-test",
    { connectionTimeoutMs: 0 },
  ), /connectionTimeoutMs/);
  assert.throws(() => createDatabasePool(
    "postgresql://dabboba_runtime:secret@127.0.0.1:55433/dabboba",
    "dabboba-timeout-test",
    { queryTimeoutMs: 60_001 },
  ), /queryTimeoutMs/);
  assert.throws(() => createDatabasePool(
    "postgresql://dabboba_runtime:secret@127.0.0.1:55433/dabboba",
    "dabboba-timeout-test",
    { statementTimeoutMs: 0 },
  ), /statementTimeoutMs/);

  const pool = createDatabasePool(
    "postgresql://dabboba_runtime:secret@127.0.0.1:55433/dabboba",
    "dabboba-timeout-test",
    { connectionTimeoutMs: 5_000, queryTimeoutMs: 30_000, statementTimeoutMs: 30_000 },
  );
  await pool.end();
});

test("integration pools reject the application database target", () => {
  assert.throws(
    () => assertDisposableIntegrationDatabaseTarget(
      "postgresql://test:test@127.0.0.1:55433/dabboba?sslmode=disable",
      "postgres://app:app@127.0.0.1:55433/dabboba",
      "dabboba-exchange-integration",
    ),
    /별도의 DABBOBA_DISPOSABLE_TEST_DATABASE_URL/,
  );
});

test("non-integration pools and disposable database targets are allowed", () => {
  assert.doesNotThrow(() => assertDisposableIntegrationDatabaseTarget(
    "postgresql://test:test@127.0.0.1:55434/dabboba_test",
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "dabboba-exchange-integration",
  ));
  assert.doesNotThrow(() => assertDisposableIntegrationDatabaseTarget(
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "postgresql://app:app@127.0.0.1:55433/dabboba",
    "dabboba-api",
  ));
});

test("Supabase database connections verify TLS certificates", () => {
  const poolerSsl = databaseSslConfig(
    "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  );
  const directSsl = databaseSslConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
  );

  for (const ssl of [poolerSsl, directSsl]) {
    assert.ok(ssl && typeof ssl === "object");
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(String(ssl.ca), /^-----BEGIN CERTIFICATE-----/);
  }
});

test("Supabase root certificate is the expected CA", () => {
  const ssl = databaseSslConfig(
    "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  );
  assert.ok(ssl && typeof ssl === "object");
  const certificate = new X509Certificate(String(ssl.ca));

  assert.equal(certificate.ca, true);
  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(
    certificate.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  const now = Date.now();

  assert.ok(Number.isFinite(validFrom));
  assert.ok(Number.isFinite(validTo));
  assert.ok(validFrom <= now, `Supabase CA is not valid before ${certificate.validFrom}`);
  assert.ok(now < validTo, `Supabase CA expired at ${certificate.validTo}`);
});

test("Supabase connection URL options cannot bypass the verified TLS target", () => {
  const connection = databaseConnectionConfig(
    "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=disable&host=attacker.example",
  );
  const parsed = new URL(connection.connectionString ?? "");

  assert.equal(parsed.hostname, "aws-0-ap-northeast-2.pooler.supabase.com");
  assert.equal(parsed.search, "");
  assert.ok(connection.ssl && typeof connection.ssl === "object");
  assert.equal(connection.ssl.rejectUnauthorized, true);
  assert.match(String(connection.ssl.ca), /^-----BEGIN CERTIFICATE-----/);
});

test("Supabase fully qualified hostnames keep verified TLS enabled", () => {
  const connection = databaseConnectionConfig(
    "postgresql://postgres.project:secret@aws-0-ap-northeast-2.pooler.supabase.com.:5432/postgres",
  );
  const parsed = new URL(connection.connectionString ?? "");

  assert.equal(parsed.hostname, "aws-0-ap-northeast-2.pooler.supabase.com");
  assert.ok(connection.ssl && typeof connection.ssl === "object");
  assert.equal(connection.ssl.rejectUnauthorized, true);
});

test("local database connections remain compatible without TLS", () => {
  assert.equal(
    databaseSslConfig("postgresql://dabboba:secret@127.0.0.1:55433/dabboba"),
    undefined,
  );
  assert.equal(
    databaseSslConfig("postgresql://dabboba:secret@localhost:55433/dabboba"),
    undefined,
  );
});
