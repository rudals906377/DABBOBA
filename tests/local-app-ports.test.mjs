import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every DABBOBA mobile entry goes through its isolated launcher', () => {
  const mobile = manifest('apps/mobile/package.json').scripts;
  assert.equal(mobile.start, 'node ../../scripts/dabboba-mobile-launch.mjs');
  assert.equal(mobile.ios, 'node ../../scripts/dabboba-mobile-launch.mjs --ios');
  assert.equal(mobile.android, 'node ../../scripts/dabboba-mobile-launch.mjs --android');
  assert.equal(manifest('package.json').scripts['ios:local'], 'corepack pnpm mobile:ios');
  assert.equal(mobile.preios, 'corepack pnpm run prepare:workspace');
});

test('DABBOBA development ports go through the local profile and cannot inherit FINDE ports or Vite fallback', () => {
  assert.equal(manifest('apps/api/package.json').scripts.dev, 'node ../../scripts/run-local-backend.mjs api');
  assert.equal(manifest('apps/admin/package.json').scripts.dev, 'node ../../scripts/run-local-backend.mjs admin');
  assert.equal(manifest('package.json').scripts['dev:api'], 'node scripts/run-local-backend.mjs api');
  assert.equal(manifest('package.json').scripts['dev:admin'], 'node scripts/run-local-backend.mjs admin');

  const runner = source('scripts/run-local-backend.mjs');
  assert.match(runner, /api:\s*\(\)\s*=>[\s\S]*?env:\s*selectedApiEnvironment\(process\.env\)/u);
  assert.match(runner, /admin:\s*\(\)\s*=>[\s\S]*?'next',\s*'dev',\s*'--hostname',\s*'127\.0\.0\.1',\s*'--port',\s*'4180'[\s\S]*?env:\s*selectedAdminEnvironment\(process\.env\)/u);

  const selector = source('scripts/supabase-integration-profile.mjs');
  assert.match(selector, /selectedApiEnvironment[\s\S]*?return localApiEnvironment\(hostEnv\)/u);
  assert.match(selector, /selectedAdminEnvironment[\s\S]*?return localAdminEnvironment\(hostEnv\)/u);

  const profile = source('scripts/local-backend-profile.mjs');
  assert.match(profile, /api:\s*8788/u);
  assert.match(profile, /API_PORT:\s*String\(LOCAL_BACKEND_PORTS\.api\)/u);
  assert.match(profile, /PORT:\s*String\(LOCAL_BACKEND_PORTS\.api\)/u);
  const inheritedKeys = profile.match(/const SYSTEM_ENV_ALLOWLIST = \[([\s\S]*?)\];/u)?.[1];
  assert.ok(inheritedKeys, 'local profile must keep an explicit parent environment allowlist');
  assert.doesNotMatch(inheritedKeys, /['"](?:PORT|API_PORT|NEXT_PUBLIC_DABBOBA_API_URL)['"]/u);

  for (const name of ['dev', 'dev:lan']) {
    assert.match(manifest('package.json').scripts[name], /--port 4174 --strictPort$/u);
  }
});

test('native identifiers remain DABBOBA-specific without replacing app data', () => {
  const { expo } = manifest('apps/mobile/app.json');
  assert.equal(expo.ios.bundleIdentifier, 'com.dabboba.mobile');
  assert.equal(expo.android.package, 'com.dabboba.mobile');
  assert.equal(expo.scheme, 'dabboba');
});
