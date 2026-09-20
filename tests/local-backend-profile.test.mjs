import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_BACKEND_DATABASE,
  assertLocalBackendProfileEnv,
  sanitizeLocalMobileEnvironment,
} from '../scripts/local-backend-profile.mjs';

const localProfile = {
  DABBOBA_LOCAL_BACKEND_PROFILE: 'local-development',
  DABBOBA_ENVIRONMENT_TIER: 'LOCAL',
  DABBOBA_RELEASE_ENVIRONMENT_TIER: 'DEVELOPMENT',
  NODE_ENV: 'development',
  PAYMENT_PROVIDER: 'UNCONFIGURED',
  DATABASE_MIGRATION_URL: `postgresql://dabboba:owner-secret@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`,
  DATABASE_URL: `postgresql://dabboba_runtime:runtime-secret@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`,
  WORKER_DATABASE_URL: `postgresql://dabboba_worker:worker-secret@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`,
  SESSION_TOKEN_PEPPER: 'a'.repeat(32),
  ADMIN_PROXY_IDENTITY_SECRET: '',
};

test('local backend profile accepts only its dedicated loopback database and roles', () => {
  assert.equal(assertLocalBackendProfileEnv(localProfile), localProfile);
  assert.throws(() => assertLocalBackendProfileEnv({
    ...localProfile,
    DATABASE_URL: 'postgresql://dabboba_runtime:secret@remote.example/dabboba_development',
  }), /DATABASE_URL/);
});

test('local mobile environment is built from a host allowlist and fixed public local values', () => {
  const result = sanitizeLocalMobileEnvironment({
    PATH: '/bin',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-pass',
    EXPO_PUBLIC_SUPABASE_URL: 'https://production.supabase.co',
    FUTURE_SMS_PROVIDER_KEY: 'must-not-pass',
  });
  assert.equal(result.PATH, '/bin');
  assert.equal(result.EXPO_PUBLIC_DABBOBA_API_URL, 'http://127.0.0.1:8788');
  assert.equal(result.EXPO_NO_DOTENV, '1');
  assert.equal(result.RCT_METRO_PORT, '8084');
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in result, false);
  assert.equal('EXPO_PUBLIC_SUPABASE_URL' in result, false);
  assert.equal('FUTURE_SMS_PROVIDER_KEY' in result, false);
});
