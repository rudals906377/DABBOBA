import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertPreservedPrelaunch, assertUnchangedSecrets } from '../scripts/deploy-supabase-preserved-prelaunch.mjs';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const known = { DABBOBA_API_COMMERCE_MODE: 'PRELAUNCH', DABBOBA_API_DATABASE_URL: 'pinned-runtime-fixture' };
const opaque = ['DABBOBA_API_SESSION_TOKEN_PEPPER', 'DABBOBA_STORAGE_S3_ACCESS_KEY_ID', 'DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY', 'DABBOBA_API_SUPABASE_PUBLISHABLE_KEY', 'DABBOBA_ADMIN_PROXY_IDENTITY_SECRET', 'DABBOBA_ADMIN_SERVICE_SECRET'];
const fixture = () => Object.fromEntries([...Object.entries(known), ...opaque.map((k) => [k, `fixture-${k}`])].map(([k, v]) => [k, hash(v)]));

test('preserved deployment refuses changed targets, missing storage credentials and payment/reviewer activation', () => {
  assert.doesNotThrow(() => assertPreservedPrelaunch(fixture(), known));
  assert.throws(() => assertPreservedPrelaunch({ ...fixture(), DABBOBA_API_DATABASE_URL: hash('different-target') }, known), /does not match/);
  const missing = fixture(); delete missing.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY;
  assert.throws(() => assertPreservedPrelaunch(missing, known), /Missing/);
  for (const key of ['DABBOBA_API_PORTONE_API_SECRET', 'DABBOBA_API_PAYMENT_REVIEW_LOGIN_ENABLED', 'DABBOBA_API_STORE_REVIEW_LOGIN_ENABLED']) {
    assert.throws(() => assertPreservedPrelaunch({ ...fixture(), [key]: hash('fixture') }, known), /full deployment profile/);
  }
});

test('preserved deployment refuses active workers, automatic conversion and retention', () => {
  for (const [key, off, on] of [
    ['DABBOBA_ENABLE_PRODUCTION_WORKER', 'false', 'true'],
    ['WORKER_INVENTORY_STORAGE_EXPIRY_MODE', 'DISABLED', 'ENABLED'],
    ['WORKER_COMMERCE_RETENTION_MODE', 'DISABLED', 'EXECUTE'],
  ]) {
    assert.doesNotThrow(() => assertPreservedPrelaunch({ ...fixture(), [key]: hash(off) }, known));
    assert.throws(() => assertPreservedPrelaunch({ ...fixture(), [key]: hash(on) }, known), /cannot enable/);
  }
});

test('secret preservation catches rotation, deletion and addition while ignoring platform-owned secret refresh', () => {
  const before = fixture();
  assert.doesNotThrow(() => assertUnchangedSecrets(before, { SUPABASE_ANON_KEY: hash('refreshed-platform'), ...before }));
  assert.throws(() => assertUnchangedSecrets(before, { ...before, DABBOBA_API_SESSION_TOKEN_PEPPER: hash('rotated') }), /changed/);
  assert.throws(() => assertUnchangedSecrets(before, { ...before, NEW_SECRET: hash('added') }), /changed/);
  const missing = { ...before }; delete missing.DABBOBA_API_SESSION_TOKEN_PEPPER;
  assert.throws(() => assertUnchangedSecrets(before, missing), /changed/);
});
