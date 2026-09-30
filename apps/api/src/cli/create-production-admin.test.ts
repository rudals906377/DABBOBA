import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionAdminDatabaseTarget } from "./create-production-admin.js";

const ref = "rconfxsykttfvznakile";
const url = (user: string) => `postgresql://${user}:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;

test("production admin creation accepts only the exact pooler identities of the expected project", () => {
  assert.doesNotThrow(() => assertProductionAdminDatabaseTarget(url(`postgres.${ref}`), ref));
  assert.doesNotThrow(() => assertProductionAdminDatabaseTarget(url(`dabboba_runtime.${ref}`), ref));
  assert.doesNotThrow(() => assertProductionAdminDatabaseTarget(url(`dabboba_runtime%2E${ref}`), ref));
});

test("production admin creation rejects substring and other-project matches", () => {
  for (const user of [
    `x${ref}`,
    `${ref}`,
    `postgres.${ref}x`,
    `evil_postgres.${ref}`,
    `dabboba_worker.${ref}`,
    "postgres.yxkmvgfruphgghowzvmo",
    `postgres.yxkmvgfruphgghowzvmo${ref}`,
    "postgres",
  ]) {
    assert.throws(
      () => assertProductionAdminDatabaseTarget(url(user), ref),
      /does not match the expected production project/,
      user,
    );
  }
  assert.throws(() => assertProductionAdminDatabaseTarget("not a url", ref), /does not match/);
  assert.throws(() => assertProductionAdminDatabaseTarget(url(`postgres.${ref}`), "short"), /reference is invalid/);
});
