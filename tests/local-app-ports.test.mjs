import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('every DABBOBA mobile entry goes through its isolated launcher', () => {
  const mobile = manifest('apps/mobile/package.json').scripts;
  assert.equal(mobile.start, 'node ../../scripts/dabboba-mobile-launch.mjs');
  assert.equal(mobile.ios, 'node ../../scripts/dabboba-mobile-launch.mjs --ios');
  assert.equal(mobile.android, 'node ../../scripts/dabboba-mobile-launch.mjs --android');
  assert.equal(manifest('package.json').scripts['ios:local'], 'corepack pnpm mobile:ios');
  assert.equal(mobile.preios, 'corepack pnpm run prepare:workspace');
});

test('DABBOBA development ports cannot inherit FINDE API port or Vite fallback', () => {
  assert.equal(manifest('apps/api/package.json').scripts.dev, 'PORT=8788 tsx watch src/index.ts');
  assert.equal(manifest('apps/admin/package.json').scripts.dev, 'next dev --port 4180');
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
