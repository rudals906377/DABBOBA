import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTestBackendEnvironment } from '../scripts/check-test-backend-env.mjs';

test('test preflight accepts absent or loopback-only backend settings', () => {
  assert.doesNotThrow(() => assertTestBackendEnvironment({}));
  assert.doesNotThrow(() => assertTestBackendEnvironment({
    DABBOBA_ENVIRONMENT_TIER: 'TEST',
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
  }));
});

test('required integration preflight refuses missing role databases and accepts one isolated local database', () => {
  assert.throws(
    () => assertTestBackendEnvironment({}, { requireIntegrationDatabase: true }),
    /DABBOBA_TEST_DATABASE_URL/,
  );
  assert.throws(
    () => assertTestBackendEnvironment({
      DABBOBA_ENVIRONMENT_TIER: 'TEST',
      DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
    }, { requireIntegrationDatabase: true }),
    /DABBOBA_RUNTIME_TEST_DATABASE_URL/,
  );
  assert.throws(
    () => assertTestBackendEnvironment({
      DABBOBA_ENVIRONMENT_TIER: 'TEST',
      DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
      DABBOBA_RUNTIME_TEST_DATABASE_URL: 'postgresql://runtime:fixture@127.0.0.1:55433/dabboba_test',
      DABBOBA_WORKER_TEST_DATABASE_URL: 'postgresql://worker:fixture@127.0.0.1:55433/dabboba_test',
    }, { requireIntegrationDatabase: true }),
    /DATABASE_MIGRATION_URL/,
  );
  assert.doesNotThrow(() => assertTestBackendEnvironment({
    DABBOBA_ENVIRONMENT_TIER: 'TEST',
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_RUNTIME_TEST_DATABASE_URL: 'postgresql://runtime:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_WORKER_TEST_DATABASE_URL: 'postgresql://worker:fixture@127.0.0.1:55433/dabboba_test',
    DATABASE_MIGRATION_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
  }, { requireIntegrationDatabase: true }));
  assert.throws(() => assertTestBackendEnvironment({
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_RUNTIME_TEST_DATABASE_URL: 'postgresql://runtime:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_WORKER_TEST_DATABASE_URL: 'postgresql://worker:fixture@127.0.0.1:55433/dabboba_test',
    DATABASE_MIGRATION_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
  }, { requireIntegrationDatabase: true }), /DABBOBA_ENVIRONMENT_TIER=TEST/);
});

test('test preflight rejects remote, query-overridden, mixed-database, and production settings', () => {
  assert.throws(() => assertTestBackendEnvironment({
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:secret@db.example.test/dabboba',
  }), /loopback/);
  assert.throws(() => assertTestBackendEnvironment({
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:secret@127.0.0.1/dabboba?host=db.example.test',
  }), /query-free/);
  assert.throws(() => assertTestBackendEnvironment({ DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION' }), /TEST/);
  assert.throws(() => assertTestBackendEnvironment({
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:secret@localhost:55433/dabboba_one_test',
    DABBOBA_RUNTIME_TEST_DATABASE_URL: 'postgresql://runtime:secret@127.0.0.1:55433/dabboba_two_test',
    DABBOBA_WORKER_TEST_DATABASE_URL: 'postgresql://worker:secret@localhost:55433/dabboba_one_test',
  }), /same local database/);
  assert.throws(() => assertTestBackendEnvironment({
    DABBOBA_ENVIRONMENT_TIER: 'TEST',
    DABBOBA_TEST_DATABASE_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_RUNTIME_TEST_DATABASE_URL: 'postgresql://runtime:fixture@127.0.0.1:55433/dabboba_test',
    DABBOBA_WORKER_TEST_DATABASE_URL: 'postgresql://worker:fixture@127.0.0.1:55433/dabboba_test',
    DATABASE_MIGRATION_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_other_test',
  }, { requireIntegrationDatabase: true }), /same local database/);
});

test('integration suites may only target a disposable test database, even on loopback', () => {
  for (const name of ['dabboba_ci', 'dabboba_test', 'dabboba_edge_test', 'dabboba_flow_test_20260924']) {
    assert.doesNotThrow(() => assertTestBackendEnvironment({
      DABBOBA_ENVIRONMENT_TIER: 'TEST',
      DABBOBA_TEST_DATABASE_URL: `postgresql://owner:fixture@127.0.0.1:55433/${name}`,
      DABBOBA_RUNTIME_TEST_DATABASE_URL: `postgresql://runtime:fixture@127.0.0.1:55433/${name}`,
      DABBOBA_WORKER_TEST_DATABASE_URL: `postgresql://worker:fixture@127.0.0.1:55433/${name}`,
      DATABASE_MIGRATION_URL: `postgresql://owner:fixture@127.0.0.1:55433/${name}`,
    }, { requireIntegrationDatabase: true }), name);
  }
  for (const name of ['dabboba_development', 'dabboba', 'postgres', 'dabboba_testing_copy', 'production_test']) {
    assert.throws(() => assertTestBackendEnvironment({
      DABBOBA_ENVIRONMENT_TIER: 'TEST',
      DABBOBA_TEST_DATABASE_URL: `postgresql://owner:fixture@127.0.0.1:55433/${name}`,
      DABBOBA_RUNTIME_TEST_DATABASE_URL: `postgresql://runtime:fixture@127.0.0.1:55433/${name}`,
      DABBOBA_WORKER_TEST_DATABASE_URL: `postgresql://worker:fixture@127.0.0.1:55433/${name}`,
      DATABASE_MIGRATION_URL: `postgresql://owner:fixture@127.0.0.1:55433/${name}`,
    }, { requireIntegrationDatabase: true }), /disposable test database/, name);
  }
  assert.throws(() => assertTestBackendEnvironment({
    DATABASE_MIGRATION_URL: 'postgresql://owner:fixture@127.0.0.1:55433/dabboba_development',
  }), /DATABASE_MIGRATION_URL must name a disposable test database/);
});

test('test preflight rejects inherited remote provider configuration', () => {
  assert.throws(() => assertTestBackendEnvironment({ SUPABASE_URL: 'https://project.supabase.co' }), /loopback/);
  assert.throws(() => assertTestBackendEnvironment({ GOOGLE_APPLICATION_CREDENTIALS: '/private/key.json' }), /not allowed/);
  assert.throws(() => assertTestBackendEnvironment({
    PAYMENT_RECONCILIATION_PROVIDER: 'KG_INICIS',
  }), /MANUAL_REVIEW/);
  for (const key of [
    'KG_INICIS_ENVIRONMENT', 'KG_INICIS_MID', 'KG_INICIS_INIAPI_KEY', 'KG_INICIS_CLIENT_IP',
  ]) {
    const value = key === 'KG_INICIS_INIAPI_KEY' ? 'provider-secret-must-not-leak' : 'configured';
    assert.throws(
      () => assertTestBackendEnvironment({ [key]: value }),
      (error) => error instanceof Error && /not allowed/.test(error.message) && !error.message.includes(value),
    );
  }
});
