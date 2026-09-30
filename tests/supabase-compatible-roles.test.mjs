import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Migration 0066 is applied in production and checksum-locked, so it cannot be
// edited. When pgmq ships the timestamp set_vt overload it revokes from anon,
// authenticated and service_role unconditionally; every non-Supabase database
// path therefore creates all three NOLOGIN roles before migrating.
test('CI and local preparation create every Supabase role that migration 0066 revokes from', () => {
  const migration = read('packages/db/migrations/0066_worker_pgmq_set_vt_dependency.sql');
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role, dabboba_runtime;/);

  const ci = read('.github/workflows/ci.yml');
  const provision = ci.indexOf('Provision Supabase-compatible roles in disposable PostgreSQL');
  const migrate = ci.indexOf('Apply migrations to disposable PostgreSQL');
  assert.ok(provision > 0 && migrate > provision);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(ci.slice(provision, migrate).includes(`CREATE ROLE ${role} NOLOGIN`), `CI creates ${role}`);
  }

  const local = read('scripts/prepare-local-backend.mjs');
  const roles = local.indexOf('DO $roles$');
  const localMigrate = local.indexOf("'@dabboba/db', 'migrate'");
  assert.ok(roles > 0 && localMigrate > roles);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(local.slice(roles, localMigrate).includes(`CREATE ROLE ${role} NOLOGIN`), `local setup creates ${role}`);
  }
});
