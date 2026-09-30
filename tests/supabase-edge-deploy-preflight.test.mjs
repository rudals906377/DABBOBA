import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultReleaseCheck, runSupabaseEdgeReleasePreflight } from '../scripts/supabase-edge-release-preflight.mjs';
import {
  deploySupabaseEdge,
  supabaseCommandArgs,
  verifySupabaseTargetProjectAccess,
} from '../scripts/deploy-supabase-edge.mjs';
import {
  assertProductionWorkerCredential,
  assertSupabaseEdgeReleaseConfiguration,
  edgeExternalValuesFromSource,
  serializeSupabaseEdgeProfile,
  SUPABASE_EDGE_EXTERNAL_OPTIONAL_KEYS,
  SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS,
  SUPABASE_EDGE_PROFILE_FILE,
} from '../scripts/prepare-supabase-edge-profile.mjs';

const edgeProfile = {
  DABBOBA_ENVIRONMENT_TIER: 'PRODUCTION',
  DABBOBA_API_DATABASE_URL: 'postgresql://runtime:secret@runtime.example.test/postgres',
  DABBOBA_API_PAYMENT_PROVIDER: 'UNCONFIGURED',
  DABBOBA_API_COMMERCE_MODE: 'PRELAUNCH',
  DABBOBA_API_SUPABASE_JWT_AUDIENCE: 'authenticated',
  DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE',
  DABBOBA_WORKER_DATABASE_URL: 'postgresql://worker:secret@worker.example.test/postgres',
  DABBOBA_STORAGE_S3_ACCESS_KEY_ID: 'fixture-access',
  DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret',
};

const completeAppleProfile = {
  ...edgeProfile,
  DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE,APPLE',
  DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: '1',
  DABBOBA_WORKER_APPLE_CLIENT_ID: 'com.dabboba.app',
  DABBOBA_WORKER_APPLE_CLIENT_SECRET: 'signed-client-secret-value-that-is-long-enough',
  DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: '1',
};

const liveEdgeProfile = {
  ...completeAppleProfile,
  DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE,KAKAO,NAVER,GOOGLE,APPLE',
  DABBOBA_API_COMMERCE_MODE: 'LIVE',
  DABBOBA_API_PAYMENT_PROVIDER: 'PORTONE_V2_INICIS',
  DABBOBA_API_PAYMENT_WEBHOOK_SECRET: 'normalized-payment-webhook-secret-for-tests',
  DABBOBA_API_PAYMENT_RECONCILIATION_WORKER_SECRET: 'separate-worker-requery-secret-for-tests',
  DABBOBA_API_PORTONE_API_SECRET: 'portone-api-secret-for-tests',
  DABBOBA_API_PORTONE_MERCHANT_ID: 'merchant-live-fixture',
  DABBOBA_API_PORTONE_STORE_ID: 'store-live-fixture',
  DABBOBA_API_PORTONE_CHANNEL_KEY: 'channel-live-fixture',
  DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT: 'LIVE',
  DABBOBA_API_PORTONE_WEBHOOK_SECRET: 'portone-webhook-secret-for-tests',
  PAYMENT_RECONCILIATION_PROVIDER: 'PORTONE_API',
  PORTONE_RECONCILIATION_API_BASE_URL: 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api',
  PAYMENT_RECONCILIATION_WORKER_SECRET: 'separate-worker-requery-secret-for-tests',
};

const fullLiveEdgeProfile = {
  ...liveEdgeProfile,
  DABBOBA_API_DATABASE_URL: 'postgresql://dabboba_runtime.rconfxsykttfvznakile:runtime-fixture@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
  DABBOBA_WORKER_DATABASE_URL: 'postgresql://dabboba_worker.rconfxsykttfvznakile:worker-fixture@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
  DABBOBA_API_SESSION_TOKEN_PEPPER: 'unique-session-pepper-for-live-fixture',
  DABBOBA_API_WEB_ORIGINS: 'https://rconfxsykttfvznakile.supabase.co',
  DABBOBA_API_LOG_LEVEL: 'info',
  DABBOBA_API_CATALOG_MEDIA_BASE_URL: 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api',
  DABBOBA_WORKER_INVOKE_SECRET: 'unique-worker-invoke-secret-for-live-fixture',
  DABBOBA_ENABLE_PRODUCTION_WORKER: 'true',
  DABBOBA_STORAGE_BUCKET: 'dabboba-media',
  DABBOBA_STORAGE_S3_ENDPOINT: 'https://rconfxsykttfvznakile.storage.supabase.co/storage/v1/s3',
  DABBOBA_STORAGE_S3_REGION: 'ap-northeast-2',
  DABBOBA_STORAGE_S3_ACCESS_KEY_ID: 's3-live-fixture-access',
  DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY: 's3-live-fixture-secret',
};

test('production Edge profile is isolated from historical QA credentials', () => {
  assert.match(SUPABASE_EDGE_PROFILE_FILE, /supabase-edge-production\.env$/);
  const source = 'postgresql://dabboba_runtime.rconfxsykttfvznakile:source@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
  const credential = {
    DABBOBA_SUPABASE_PROJECT_REF: 'rconfxsykttfvznakile',
    DABBOBA_WORKER_CREDENTIAL_STATUS: 'VERIFIED',
    DABBOBA_WORKER_DATABASE_URL: 'postgresql://dabboba_worker.rconfxsykttfvznakile:worker@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    DABBOBA_WORKER_INVOKE_SECRET: 'fixture-invoke-secret-longer-than-32-characters',
  };
  assert.equal(assertProductionWorkerCredential(credential, source).DABBOBA_WORKER_DATABASE_URL, credential.DABBOBA_WORKER_DATABASE_URL);
  assert.throws(() => assertProductionWorkerCredential({ ...credential, DABBOBA_WORKER_CREDENTIAL_STATUS: 'PENDING' }, source));
  assert.throws(() => assertProductionWorkerCredential({
    ...credential,
    DABBOBA_WORKER_DATABASE_URL: credential.DABBOBA_WORKER_DATABASE_URL.replace('rconfxsykttfvznakile', 'yxkmvgfruphgghowzvmo'),
  }, source));
});

test('database release preflight can execute the installed checker and return a JSON report', () => {
  const result = defaultReleaseCheck({
    repositoryRoot: fileURLToPath(new URL('../', import.meta.url)),
    environment: {
      DABBOBA_RELEASE_ENVIRONMENT_TIER: 'TEST',
      DATABASE_MIGRATION_URL: '',
      DATABASE_URL: '',
      WORKER_DATABASE_URL: '',
    },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scope, 'database-release-check/v1');
  assert.equal(report.status, 'blocked');
  assert.ok(report.blockers.includes('missing_migration_database_url'));
});

test('production Edge deployment uses an explicit project ref without mistaking CLI backend profiles for logins', () => {
  assert.deepEqual(
    supabaseCommandArgs('functions', 'deploy', 'dabboba-api', '--project-ref', 'rconfxsykttfvznakile'),
    [
      '--yes',
      'supabase@2.117.0',
      'functions',
      'deploy',
      'dabboba-api',
      '--project-ref',
      'rconfxsykttfvznakile',
    ],
  );
});

test('production Edge deployment checks CLI access to the exact active target project', () => {
  const expected = { ref: 'rconfxsykttfvznakile', status: 'ACTIVE_HEALTHY' };
  const runCommand = (_command, args) => {
    assert.deepEqual(args, supabaseCommandArgs('projects', 'list', '--output', 'json'));
    return { status: 0, stdout: JSON.stringify([expected]) };
  };
  assert.doesNotThrow(() => verifySupabaseTargetProjectAccess({ runCommand }));
  assert.throws(() => verifySupabaseTargetProjectAccess({
    runCommand: () => ({ status: 0, stdout: JSON.stringify([{ ...expected, ref: 'another-project' }]) }),
  }), /expected active production project/);
  assert.throws(() => verifySupabaseTargetProjectAccess({
    runCommand: () => ({ status: 0, stdout: JSON.stringify([{ ...expected, status: 'PAUSED' }]) }),
  }), /expected active production project/);
  assert.throws(() => verifySupabaseTargetProjectAccess({
    runCommand: () => ({ status: 1, stdout: 'not-json' }),
  }), /project access could not be verified/);
});

test('Supabase Edge release profile distinguishes required auth from optional remote push', () => {
  assert.deepEqual(SUPABASE_EDGE_EXTERNAL_REQUIRED_KEYS, [
    'DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS',
  ]);
  assert.equal(SUPABASE_EDGE_EXTERNAL_OPTIONAL_KEYS.includes('DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN'), true);
  const result = assertSupabaseEdgeReleaseConfiguration(edgeProfile);
  assert.deepEqual(result, {
    customerAuthProviders: ['PHONE'],
    appleRevocationConfigured: false,
    remotePushConfigured: false,
  });
  assert.equal(assertSupabaseEdgeReleaseConfiguration({
    ...edgeProfile,
    DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: 'expo-server-access-token-for-tests',
  }).remotePushConfigured, true);
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...edgeProfile,
      DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: 'short',
    }),
    /EXPO_PUSH_ACCESS_TOKEN is invalid/,
  );
});

test('Supabase Edge profile serializer preserves reviewed optional server keys only', () => {
  const serialized = serializeSupabaseEdgeProfile({
    ...completeAppleProfile,
    DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: 'expo-server-access-token-for-tests',
    UNREVIEWED_SECRET: 'must-not-be-serialized',
  });
  for (const key of [
    'DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS',
    'DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY',
    'DABBOBA_WORKER_APPLE_CLIENT_SECRET',
    'DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN',
  ]) {
    assert.match(serialized, new RegExp(`^${key}=`, 'm'));
  }
  assert.doesNotMatch(serialized, /UNREVIEWED_SECRET/);
});

test('generic private auth settings map onto the dedicated Edge allowlist', () => {
  const encryptionKey = Buffer.alloc(32, 9).toString('base64url');
  assert.deepEqual(edgeExternalValuesFromSource({
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture-key-value',
    CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE,APPLE',
    APPLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    APPLE_TOKEN_ENCRYPTION_KEY_VERSION: '2',
    APPLE_CLIENT_ID: 'com.dabboba.app',
    APPLE_CLIENT_SECRET: 'signed-client-secret-value-that-is-long-enough',
    EXPO_PUSH_ACCESS_TOKEN: 'expo-server-access-token-for-tests',
    UNREVIEWED_SECRET: 'ignored',
  }), {
    DABBOBA_API_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture-key-value',
    DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE,APPLE',
    DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: '2',
    DABBOBA_WORKER_APPLE_CLIENT_ID: 'com.dabboba.app',
    DABBOBA_WORKER_APPLE_CLIENT_SECRET: 'signed-client-secret-value-that-is-long-enough',
    DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY_VERSION: '2',
    DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN: 'expo-server-access-token-for-tests',
  });
});

test('Supabase Edge release profile rejects missing customer auth and non-PRELAUNCH commerce', () => {
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...edgeProfile,
      DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: '',
    }),
    /externally verified DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS/,
  );
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...edgeProfile,
      DABBOBA_API_COMMERCE_MODE: 'LIVE',
    }),
    /reviewed PRELAUNCH authentication and payment boundary/,
  );
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...edgeProfile,
      DABBOBA_API_PAYMENT_PROVIDER: 'PORTONE_V2_INICIS',
    }),
    /reviewed PRELAUNCH authentication and payment boundary/,
  );
});

test('LIVE Edge candidate requires matched PortOne and canonical worker requery settings', () => {
  const result = assertSupabaseEdgeReleaseConfiguration(liveEdgeProfile, { expectedCommerceMode: 'LIVE' });
  assert.deepEqual(result.customerAuthProviders, ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE']);
  for (const key of [
    'DABBOBA_API_PAYMENT_WEBHOOK_SECRET',
    'DABBOBA_API_PAYMENT_RECONCILIATION_WORKER_SECRET',
    'DABBOBA_API_PORTONE_API_SECRET',
    'DABBOBA_API_PORTONE_MERCHANT_ID',
    'DABBOBA_API_PORTONE_STORE_ID',
    'DABBOBA_API_PORTONE_CHANNEL_KEY',
    'DABBOBA_API_PORTONE_WEBHOOK_SECRET',
    'PAYMENT_RECONCILIATION_WORKER_SECRET',
  ]) {
    assert.throws(() => assertSupabaseEdgeReleaseConfiguration({ ...liveEdgeProfile, [key]: '' }, { expectedCommerceMode: 'LIVE' }));
  }
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...liveEdgeProfile, DABBOBA_API_PORTONE_CHANNEL_ENVIRONMENT: 'TEST',
  }, { expectedCommerceMode: 'LIVE' }), /LIVE channel/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...liveEdgeProfile, PAYMENT_RECONCILIATION_PROVIDER: 'MANUAL_REVIEW',
  }, { expectedCommerceMode: 'LIVE' }), /PORTONE_API/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...liveEdgeProfile, PAYMENT_RECONCILIATION_WORKER_SECRET: 'different-worker-secret-for-tests',
  }, { expectedCommerceMode: 'LIVE' }), /matching worker requery secret/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...liveEdgeProfile, PORTONE_RECONCILIATION_API_BASE_URL: 'https://other.example.com/functions/v1/dabboba-api',
  }, { expectedCommerceMode: 'LIVE' }), /production API route/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...liveEdgeProfile, DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'PHONE,GOOGLE',
  }, { expectedCommerceMode: 'LIVE' }), /all requested customer login methods/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration(liveEdgeProfile), /PRELAUNCH/);
  assert.throws(() => assertSupabaseEdgeReleaseConfiguration({
    ...edgeProfile, DABBOBA_API_PORTONE_API_SECRET: 'dormant-live-secret',
  }), /PRELAUNCH/);
});

test('LIVE Edge preflight refuses incomplete payment configuration before source or database access', async () => {
  let sourceCalled = false;
  let databaseCalled = false;
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile: { ...liveEdgeProfile, PAYMENT_RECONCILIATION_PROVIDER: 'MANUAL_REVIEW' },
    expectedCommerceMode: 'LIVE',
    checkSource() { sourceCalled = true; },
    runReleaseCheck() { databaseCalled = true; },
  }), /PORTONE_API/);
  assert.equal(sourceCalled, false);
  assert.equal(databaseCalled, false);
});

test('LIVE Edge preflight requires complete isolated roles and migration 0076 before database access', async () => {
  let databaseCalled = false;
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile: { ...fullLiveEdgeProfile, DABBOBA_ENABLE_PRODUCTION_WORKER: '' },
    expectedCommerceMode: 'LIVE',
    checkSource: () => ({ status: 'pass', head: 'a'.repeat(40), latestMigration: '0076_legal_policy_business_phone.sql', worktreeClean: true }),
    runReleaseCheck() { databaseCalled = true; },
  }), /DABBOBA_ENABLE_PRODUCTION_WORKER/);
  assert.equal(databaseCalled, false);
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile: fullLiveEdgeProfile,
    expectedCommerceMode: 'LIVE',
    checkSource: () => ({ status: 'pass', head: 'a'.repeat(40), latestMigration: '0075_shipping_request_retry_after_cancellation.sql', worktreeClean: true }),
    runReleaseCheck() { databaseCalled = true; },
  }), /migration 0076/);
  assert.equal(databaseCalled, false);
});

test('complete LIVE Edge candidate reaches the read-only target database release check', async () => {
  const result = await runSupabaseEdgeReleasePreflight({
    edgeProfile: fullLiveEdgeProfile,
    expectedCommerceMode: 'LIVE',
    sourceEnvironment: { DATABASE_MIGRATION_URL: 'postgresql://migration:fixture@migration.example.test/postgres' },
    checkSource: () => ({
      status: 'pass', head: 'a'.repeat(40),
      latestMigration: '0076_legal_policy_business_phone.sql', worktreeClean: true,
    }),
    runReleaseCheck: () => ({ status: 0, stdout: JSON.stringify({
      scope: 'database-release-check/v1', status: 'pass',
      environmentTier: 'PRODUCTION', targetHash: 'b'.repeat(64),
    }) }),
  });
  assert.equal(result.latestMigration, '0076_legal_policy_business_phone.sql');
  assert.equal(result.targetHash, 'b'.repeat(64));
  assert.deepEqual(result.releaseConfiguration.customerAuthProviders, ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE']);
});

test('APPLE login requires matching API encryption and worker revocation settings', () => {
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...edgeProfile,
      DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: 'APPLE,PHONE',
    }),
    /APPLE customer login requires complete API encryption and worker revocation settings/,
  );
  const configured = assertSupabaseEdgeReleaseConfiguration(completeAppleProfile);
  assert.equal(configured.appleRevocationConfigured, true);
  assert.throws(
    () => assertSupabaseEdgeReleaseConfiguration({
      ...completeAppleProfile,
      DABBOBA_WORKER_APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64url'),
    }),
    /encryption keys and versions must be valid and identical/,
  );
});

test('Supabase Edge release preflight requires a committed source and a passing database release report', async () => {
  const calls = [];
  const result = await runSupabaseEdgeReleasePreflight({
    edgeProfile,
    sourceEnvironment: {
      DATABASE_MIGRATION_URL: 'postgresql://migration:secret@migration.example.test/postgres',
    },
    checkSource() {
      calls.push('source');
      return { status: 'pass', head: 'a'.repeat(40), latestMigration: '0076_legal_policy_business_phone.sql', worktreeClean: true, blockers: [] };
    },
    runReleaseCheck({ environment }) {
      calls.push('database');
      assert.equal(environment.DABBOBA_RELEASE_ENVIRONMENT_TIER, 'PRODUCTION');
      assert.equal(environment.DATABASE_MIGRATION_URL.includes('migration.example.test'), true);
      assert.equal(environment.DATABASE_URL, edgeProfile.DABBOBA_API_DATABASE_URL);
      assert.equal(environment.WORKER_DATABASE_URL, edgeProfile.DABBOBA_WORKER_DATABASE_URL);
      return {
        status: 0,
        stdout: JSON.stringify({
          scope: 'database-release-check/v1',
          status: 'pass',
          environmentTier: 'PRODUCTION',
          targetHash: 'b'.repeat(64),
        }),
      };
    },
  });

  assert.deepEqual(calls, ['source', 'database']);
  assert.equal(result.targetHash, 'b'.repeat(64));
  assert.equal(result.sourceHead, 'a'.repeat(40));
  assert.deepEqual(result.releaseConfiguration, {
    customerAuthProviders: ['PHONE'],
    appleRevocationConfigured: false,
    remotePushConfigured: false,
  });
});

test('Supabase Edge release preflight rejects missing external auth before source or database checks', async () => {
  let sourceCalled = false;
  let databaseCalled = false;
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile: { ...edgeProfile, DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS: '' },
    checkSource() { sourceCalled = true; },
    runReleaseCheck() { databaseCalled = true; },
  }), /externally verified DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS/);
  assert.equal(sourceCalled, false);
  assert.equal(databaseCalled, false);
});

test('Supabase Edge release preflight rejects a dirty worktree attestation before a database connection', async () => {
  let databaseCalled = false;
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile,
    sourceEnvironment: { DATABASE_MIGRATION_URL: 'postgresql://fixture' },
    checkSource: () => ({
      status: 'pass',
      head: 'a'.repeat(40),
      latestMigration: '0067_catalog_media_project_rebase.sql',
      worktreeClean: false,
      blockers: [],
    }),
    runReleaseCheck() { databaseCalled = true; },
  }), /source is not a reviewed Git commit/);
  assert.equal(databaseCalled, false);
});

test('Supabase Edge release preflight fails before a database connection when Git source is blocked', async () => {
  let databaseCalled = false;
  await assert.rejects(runSupabaseEdgeReleasePreflight({
    edgeProfile,
    sourceEnvironment: { DATABASE_MIGRATION_URL: 'postgresql://fixture' },
    checkSource: () => ({ status: 'blocked', head: null, latestMigration: null, blockers: ['required_migration_not_committed:0067_catalog_media_project_rebase.sql'] }),
    runReleaseCheck() { databaseCalled = true; },
  }), /source is not a reviewed Git commit/);
  assert.equal(databaseCalled, false);
});

test('Supabase Edge deployment performs both preflights before build, secret, or deploy commands', async () => {
  const calls = [];
  await deploySupabaseEdge({
    prepareProfile() { calls.push('profile'); return edgeProfile; },
    readEdgeProfile() { calls.push('profile-read'); return {}; },
    async preflight({ edgeProfile: suppliedProfile }) {
      calls.push('preflight');
      assert.equal(suppliedProfile, edgeProfile);
      return {
        sourceHead: 'a'.repeat(40),
        targetHash: 'b'.repeat(64),
        releaseConfiguration: assertSupabaseEdgeReleaseConfiguration(suppliedProfile),
      };
    },
    verifyProjectAccess() { calls.push('project-access'); },
    run(command, args) { calls.push(`${command}:${args.join(' ')}`); },
    supabase(...args) { calls.push(`supabase:${args.join(' ')}`); },
    verifyPublicSurface() { calls.push('public-smoke'); },
  });
  assert.deepEqual(calls.slice(0, 4), ['profile', 'profile-read', 'preflight', 'project-access']);
  assert.equal(calls.some((call) => call.includes('build:supabase')), true);
  assert.equal(calls.some((call) => call.includes('functions deploy dabboba-api')), true);
  assert.ok(calls.indexOf('public-smoke') > calls.findIndex((call) => call.includes('functions deploy dabboba-worker')));
});

test('a failed database preflight leaves build, secrets, and functions untouched', async () => {
  const commands = [];
  await assert.rejects(deploySupabaseEdge({
    prepareProfile: () => edgeProfile,
    readEdgeProfile: () => ({}),
    preflight: async () => { throw new Error('database release blocked'); },
    verifyProjectAccess: () => commands.push('project-access'),
    run: (...args) => commands.push(args),
    supabase: (...args) => commands.push(args),
    verifyPublicSurface: () => commands.push('public-smoke'),
  }), /database release blocked/);
  assert.deepEqual(commands, []);
});

test('missing target project access leaves builds, secrets, and functions untouched', async () => {
  const commands = [];
  await assert.rejects(deploySupabaseEdge({
    prepareProfile: () => edgeProfile,
    readEdgeProfile: () => ({}),
    preflight: async () => ({ sourceHead: 'a'.repeat(40), targetHash: 'b'.repeat(64) }),
    verifyProjectAccess: () => { throw new Error('wrong Supabase account'); },
    run: (...args) => commands.push(args),
    supabase: (...args) => commands.push(args),
  }), /wrong Supabase account/);
  assert.deepEqual(commands, []);
});

test('deployment cannot report success when the mobile public API smoke fails', async () => {
  const calls = [];
  await assert.rejects(deploySupabaseEdge({
    prepareProfile: () => edgeProfile,
    readEdgeProfile: () => ({}),
    preflight: async () => ({
      sourceHead: 'a'.repeat(40),
      targetHash: 'b'.repeat(64),
      releaseConfiguration: assertSupabaseEdgeReleaseConfiguration(edgeProfile),
    }),
    verifyProjectAccess: () => calls.push('project-access'),
    run: (command, args) => calls.push(`${command}:${args.join(' ')}`),
    supabase: (...args) => calls.push(`supabase:${args.join(' ')}`),
    verifyPublicSurface: async () => { throw new Error('Public config returned HTTP 404'); },
  }), /Public config returned HTTP 404/);
  assert.ok(calls.some((call) => call.includes('functions deploy dabboba-api')));
  assert.ok(calls.some((call) => call.includes('functions deploy dabboba-worker')));
});
