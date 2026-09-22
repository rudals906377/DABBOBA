import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "./index.js";
import { databaseTargetIdentity } from "./check-release.js";
import {
  assertWorkerProvisioningTarget,
  parseProvisionWorkerRoleArguments,
  safeProvisioningErrorMessage,
} from "./provision-worker-role.js";
import { provisionWorkerDatabaseRole } from "./role-provisioning.js";

const password = "worker-password-with-more-than-32-bytes";
const projectReference = "abcdefghijklmnopqrst";
const sessionPoolerUrl = `postgresql://postgres.${projectReference}:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;

function fakePool(canLogin: boolean, failOnAlter = false) {
  const queries: string[] = [];
  let releases = 0;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("FROM pg_roles") && sql.includes("rolcanlogin")) {
        return {
          rowCount: 1,
          rows: [{
            rolbypassrls: true,
            rolcanlogin: canLogin,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: false,
            rolreplication: false,
            rolsuper: false,
          }],
        };
      }
      if (sql.includes("FROM pg_auth_members")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT format")) {
        return { rowCount: 1, rows: [{ sql: "ALTER ROLE dabboba_worker WITH LOGIN PASSWORD 'redacted'" }] };
      }
      if (sql.startsWith("ALTER ROLE") && failOnAlter) {
        throw Object.assign(new Error("credential and SQL must not be printed"), {
          code: "XX000",
          detail: "postgresql://worker:raw-secret@db.example/postgres",
        });
      }
      return { rowCount: 0, rows: [] };
    },
    release() { releases += 1; },
  };
  return {
    pool: { async connect() { return client; } } as unknown as DatabasePool,
    queries,
    releases: () => releases,
  };
}

test("worker provisioning arguments require password stdin and explicit rotation syntax", () => {
  assert.deepEqual(parseProvisionWorkerRoleArguments(["--password-stdin"]), {
    allowExistingLoginRotation: false,
    expectedTargetHash: null,
  });
  assert.deepEqual(parseProvisionWorkerRoleArguments([
    "--password-stdin",
    "--expected-target-hash",
    "a".repeat(64),
    "--authorize-existing-login-rotation",
  ]), {
    allowExistingLoginRotation: true,
    expectedTargetHash: "a".repeat(64),
  });
  assert.throws(() => parseProvisionWorkerRoleArguments([]), /Usage/);
  assert.throws(() => parseProvisionWorkerRoleArguments([
    "--password-stdin", "--expected-target-hash", "not-a-hash",
  ]), /64 lowercase/);
});

test("remote provisioning requires exact target, explicit remote tier, Session 5432, and verified TLS", () => {
  const identity = databaseTargetIdentity(sessionPoolerUrl);
  assert.ok(identity);
  assert.doesNotThrow(() => assertWorkerProvisioningTarget(sessionPoolerUrl, "STAGING", identity.hash));
  assert.throws(() => assertWorkerProvisioningTarget(sessionPoolerUrl, "PRODUCTION", null), /approved target hash/);
  assert.throws(() => assertWorkerProvisioningTarget(sessionPoolerUrl, undefined, identity.hash), /explicit STAGING or PRODUCTION/);
  assert.throws(() => assertWorkerProvisioningTarget(sessionPoolerUrl, "LOCAL", identity.hash), /explicit STAGING or PRODUCTION/);
  assert.throws(() => assertWorkerProvisioningTarget(sessionPoolerUrl, "TEST", identity.hash), /explicit STAGING or PRODUCTION/);
  assert.throws(() => assertWorkerProvisioningTarget(sessionPoolerUrl, "PRODUCTION", "a".repeat(64)), /approved target hash/);
  assert.throws(() => assertWorkerProvisioningTarget(
    sessionPoolerUrl.replace(":5432/", ":6543/"), "PRODUCTION", identity.hash,
  ), /Session pooler/);
});

test("local provisioning accepts only an explicit local tier and query-free loopback target", () => {
  const local = "postgresql://dabboba:secret@127.0.0.1:55433/dabboba_development";
  const identity = databaseTargetIdentity(local);
  assert.ok(identity);
  assert.doesNotThrow(() => assertWorkerProvisioningTarget(local, "LOCAL", null));
  assert.doesNotThrow(() => assertWorkerProvisioningTarget(local, "TEST", identity.hash));
  assert.throws(() => assertWorkerProvisioningTarget(local, "LOCAL", "a".repeat(64)), /approved target hash/);
  assert.throws(() => assertWorkerProvisioningTarget(local, "PRODUCTION", null), /explicit LOCAL or TEST/);
  assert.throws(() => assertWorkerProvisioningTarget(`${local}?host=remote.example`, "LOCAL", null), /not approved/);
});

test("first-time provisioning refuses an existing LOGIN before ALTER and rolls back", async () => {
  const fixture = fakePool(true);
  await assert.rejects(
    provisionWorkerDatabaseRole(fixture.pool, password),
    /explicit rotation authorization/,
  );
  assert.equal(fixture.queries.some((sql) => sql.startsWith("ALTER ROLE")), false);
  assert.deepEqual(fixture.queries.filter((sql) => sql === "BEGIN" || sql === "ROLLBACK"), ["BEGIN", "ROLLBACK"]);
  assert.equal(fixture.releases(), 1);
});

test("NOLOGIN first-time setup and explicitly authorized LOGIN rotation can ALTER", async () => {
  for (const [canLogin, allowExistingLoginRotation] of [[false, false], [true, true]] as const) {
    const fixture = fakePool(canLogin);
    await provisionWorkerDatabaseRole(fixture.pool, password, { allowExistingLoginRotation });
    assert.equal(fixture.queries.some((sql) => sql.startsWith("ALTER ROLE")), true);
    assert.equal(fixture.queries.at(-1), "COMMIT");
    assert.equal(fixture.releases(), 1);
  }
});

test("SQL failures roll back and release while CLI reporting hides credentials and database detail", async () => {
  const fixture = fakePool(false, true);
  let failure: unknown;
  try {
    await provisionWorkerDatabaseRole(fixture.pool, password);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
  assert.equal(fixture.releases(), 1);
  const reported = safeProvisioningErrorMessage(failure);
  assert.equal(reported, "Worker database role provisioning failed; inspect the database state privately.");
  assert.doesNotMatch(reported, /raw-secret|postgresql|ALTER ROLE|credential/);
});
