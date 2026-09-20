import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "./index.js";
import { checkDatabaseRelease, databaseTargetIdentity } from "./check-release.js";

const projectReference = "abcdefghijklmnopqrst";

test("release target fingerprints match direct and pooler URLs only for the same Supabase project", () => {
  const direct = databaseTargetIdentity(
    `postgresql://postgres:secret@db.${projectReference}.supabase.co:5432/postgres`,
  );
  const pooler = databaseTargetIdentity(
    `postgresql://dabboba_runtime.${projectReference}:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  );
  const otherProject = databaseTargetIdentity(
    "postgresql://postgres:secret@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres",
  );

  assert.ok(direct && pooler && otherProject);
  assert.equal(direct.hash, pooler.hash);
  assert.notEqual(direct.hash, otherProject.hash);
  assert.equal(direct.hash.includes(projectReference), false);
});

test("release target fingerprints reject local URL overrides and keep loopback hosts distinct", () => {
  assert.equal(
    databaseTargetIdentity("postgresql://app:secret@127.0.0.1:55439/test?host=remote.example"),
    null,
  );
  const numeric = databaseTargetIdentity("postgresql://app:secret@127.0.0.1:55439/test");
  const hostname = databaseTargetIdentity("postgresql://app:secret@localhost:55439/test");

  assert.ok(numeric && hostname);
  assert.notEqual(numeric.hash, hostname.hash);
});

test("release checker blocks missing inputs without constructing a pool", async () => {
  let poolCreated = false;
  const report = await checkDatabaseRelease(
    {},
    { createPool() { poolCreated = true; throw new Error("must not connect"); } },
  );

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, [
    "missing_migration_database_url",
    "missing_runtime_database_url",
    "missing_worker_database_url",
  ]);
  assert.equal(poolCreated, false);
});

test("release checker sanitizes an invalid environment tier", async () => {
  const pooler = "aws-0-ap-northeast-2.pooler.supabase.com";
  const report = await checkDatabaseRelease({
    environmentTier: "secret=must-not-be-reported",
    migrationDatabaseUrl: `postgresql://postgres.${projectReference}:secret@${pooler}:6543/postgres`,
    runtimeDatabaseUrl: `postgresql://dabboba_runtime.${projectReference}:secret@${pooler}:6543/postgres`,
    workerDatabaseUrl: `postgresql://dabboba_worker.${projectReference}:secret@${pooler}:6543/postgres`,
  });

  assert.equal(report.environmentTier, "UNKNOWN");
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("environment_tier_invalid"));
  assert.equal(JSON.stringify(report).includes("must-not-be-reported"), false);
});

test("release checker requires Session pooler port 5432 for migration and worker inputs", async () => {
  const pooler = "aws-0-ap-northeast-2.pooler.supabase.com";
  const report = await checkDatabaseRelease({
    environmentTier: "UNKNOWN",
    migrationDatabaseUrl: `postgresql://postgres.${projectReference}:secret@${pooler}:6543/postgres`,
    runtimeDatabaseUrl: `postgresql://dabboba_runtime.${projectReference}:secret@${pooler}:6543/postgres`,
    workerDatabaseUrl: `postgresql://dabboba_worker.${projectReference}:secret@${pooler}:6543/postgres`,
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("migration_session_pooler_5432_required"));
  assert.ok(report.blockers.includes("worker_session_pooler_5432_required"));
});

function fakeReleasePool(kind: "migration" | "runtime" | "worker", blank = false): DatabasePool {
  const role = kind === "migration"
    ? "migration_admin"
    : kind === "runtime"
      ? "dabboba_runtime"
      : "dabboba_worker";
  const restricted = {
    rolbypassrls: true,
    rolcanlogin: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolreplication: false,
    rolsuper: false,
  };
  const client = {
    async query(sql: string) {
      if (sql === "SELECT current_user::text AS current_role") {
        return { rowCount: 1, rows: [{ current_role: role }] };
      }
      if (sql.includes("FROM public.schema_migrations")) {
        if (blank) throw new Error("relation does not exist");
        return { rowCount: 1, rows: [{ version: "0000_test.sql", checksum: "disk-checksum" }] };
      }
      if (sql.includes("FROM pg_catalog.pg_roles") && sql.includes("rolbypassrls")) {
        return {
          rowCount: 3,
          rows: [
            { rolname: "migration_admin", ...restricted, rolbypassrls: false, rolinherit: true, rolsuper: true },
            { rolname: "dabboba_runtime", ...restricted },
            { rolname: "dabboba_worker", ...restricted },
          ],
        };
      }
      if (sql.includes("FROM pg_catalog.pg_auth_members")) {
        return { rowCount: 1, rows: [{ edge_count: "0" }] };
      }
      if (sql.includes("WITH app_tables AS")) {
        return {
          rowCount: 1,
          rows: [{
            anon_role_count: "1",
            anon_exposed_count: "0",
            authenticated_role_count: "1",
            authenticated_exposed_count: "0",
            rls_disabled_count: "0",
            rls_enabled_count: "1",
            total_count: "1",
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  return {
    async connect() { return client; },
    async end() {},
  } as unknown as DatabasePool;
}

const localReleaseInputs = {
  environmentTier: "TEST",
  migrationDatabaseUrl: "postgresql://migration:secret@127.0.0.1:55439/release_fixture",
  runtimeDatabaseUrl: "postgresql://runtime:secret@127.0.0.1:55439/release_fixture",
  workerDatabaseUrl: "postgresql://worker:secret@127.0.0.1:55439/release_fixture",
};

test("release checker passes only its bounded database evidence with all three identities", async () => {
  const report = await checkDatabaseRelease(localReleaseInputs, {
    createPool: (kind) => fakeReleasePool(kind),
    loadDiskChecksums: async () => new Map([["0000_test.sql", "disk-checksum"]]),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.scope, "database-release-check/v1");
  assert.equal(report.sameTarget, true);
  const identityHashes = Object.values(report.connections)
    .map((item) => item?.actualRoleHash)
    .filter((hash): hash is string => typeof hash === "string");
  assert.equal(new Set(identityHashes).size, 3);
});

test("release checker blocks an empty database instead of reporting zero-count success", async () => {
  const report = await checkDatabaseRelease(localReleaseInputs, {
    createPool: (kind) => fakeReleasePool(kind, kind === "migration"),
    loadDiskChecksums: async () => new Map([["0000_test.sql", "disk-checksum"]]),
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("migration_readonly_snapshot_failed"));
  assert.ok(report.blockers.includes("database_aggregate_unavailable"));
});
