import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRuntimeDatabasePassword,
  assertWorkerDatabasePassword,
  runtimeDatabaseUrl,
  workerDatabaseUrl,
} from "./role-credentials.js";

const password = "runtime-password-with-more-than-32-bytes";

test("runtime URL preserves the Supabase project while replacing only role and password", () => {
  const result = runtimeDatabaseUrl(
    "postgresql://postgres.abcdefghijklmnopqrst:old@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require",
    "new-p@ssword-that-is-more-than-32-bytes",
  );
  const parsed = new URL(result);

  assert.equal(decodeURIComponent(parsed.username), "dabboba_runtime.abcdefghijklmnopqrst");
  assert.equal(decodeURIComponent(parsed.password), "new-p@ssword-that-is-more-than-32-bytes");
  assert.equal(parsed.hostname, "aws-0-ap-northeast-2.pooler.supabase.com");
  assert.equal(parsed.port, "5432");
  assert.equal(parsed.pathname, "/postgres");
});

test("runtime URL supports direct Supabase and local PostgreSQL connections", () => {
  const direct = new URL(runtimeDatabaseUrl(
    "postgresql://postgres:old@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    password,
  ));
  const local = new URL(runtimeDatabaseUrl(
    "postgresql://owner:old@127.0.0.1:55433/dabboba",
    password,
  ));

  assert.equal(direct.username, "dabboba_runtime");
  assert.equal(local.username, "dabboba_runtime");
});

test("worker URL preserves the target while using a distinct worker login", () => {
  const pooler = new URL(workerDatabaseUrl(
    "postgresql://postgres.abcdefghijklmnopqrst:old@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require",
    "worker-p@ssword-that-is-more-than-32-bytes",
  ));
  const direct = new URL(workerDatabaseUrl(
    "postgresql://postgres:old@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    password,
  ));
  const local = new URL(workerDatabaseUrl(
    "postgresql://owner:old@127.0.0.1:55433/dabboba",
    password,
  ));

  assert.equal(decodeURIComponent(pooler.username), "dabboba_worker.abcdefghijklmnopqrst");
  assert.equal(decodeURIComponent(pooler.password), "worker-p@ssword-that-is-more-than-32-bytes");
  assert.equal(direct.username, "dabboba_worker");
  assert.equal(local.username, "dabboba_worker");
});

test("runtime URL rejects ambiguous Supabase owners and weak passwords", () => {
  assert.throws(
    () => runtimeDatabaseUrl(
      "postgresql://postgres:old@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
      password,
    ),
    /postgres\.<project-ref>/,
  );
  assert.throws(() => assertRuntimeDatabasePassword("too-short"), /32 and 512 bytes/);
  assert.throws(
    () => assertRuntimeDatabasePassword(`${password}\nunsafe`),
    /control character/,
  );
  assert.throws(() => assertWorkerDatabasePassword("too-short"), /DABBOBA_WORKER_DATABASE_PASSWORD/);
  assert.throws(
    () => workerDatabaseUrl(
      "postgresql://postgres:old@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
      password,
    ),
    /postgres\.<project-ref>/,
  );
});
