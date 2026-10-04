import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectMobileArtifactStrings, resolveArtifactHermesCompiler, verifyMobileArtifactConfig } from '../scripts/verify-mobile-artifact-config.mjs';
import { scanMobileProductionBundle } from '../scripts/check-mobile-production-bundle.mjs';

const environment = {
  EXPO_PUBLIC_DABBOBA_API_URL: 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api',
  EXPO_PUBLIC_SUPABASE_URL: 'https://rconfxsykttfvznakile.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_artifact_regression_fixture',
  EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL: 'https://dabboba.net/privacy',
  EXPO_PUBLIC_DABBOBA_TERMS_URL: 'https://dabboba.net/terms',
  EXPO_PUBLIC_DABBOBA_SUPPORT_URL: 'https://dabboba.net/support',
  EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL: 'https://dabboba.net/account-deletion',
  EXPO_PUBLIC_COMMERCE_CAPABILITY: 'PRELAUNCH',
};
const literals = Object.values(environment);
const source = (values = literals) => `globalThis.artifactConfiguration = ${JSON.stringify(values)};`;
const codes = (result) => new Set(result.errors.map((error) => error.code));

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dabboba-artifact-config-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function exportBundle(directory, values = literals) {
  const entry = '_expo/static/js/ios/entry.js';
  mkdirSync(path.join(directory, path.dirname(entry)), { recursive: true });
  writeFileSync(path.join(directory, entry), source(values));
  writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { ios: { bundle: entry } } }));
  return entry;
}

test('exact expected literals pass without claiming runtime, signing, authentication or submission', async (t) => {
  const directory = fixture(t);
  exportBundle(directory);
  const report = await verifyMobileArtifactConfig({ artifactPath: directory, environment });
  assert.equal(report.status, 'pass');
  assert.equal(report.bundles[0].comparisons.length, 8);
  assert.equal(report.bundles[0].format, 'javascript-literals');
  assert.equal(report.bundles[0].sha256.length, 64);
  for (const name of ['runtimeConfigurationVerified', 'commerceCapabilityAttested', 'signingVerified', 'authenticationVerified', 'storeSubmissionReady']) assert.equal(report[name], false);
  assert.ok(!JSON.stringify(report).includes(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
});

test('old approved API passes the existing marker scan but fails exact compiled configuration comparison', async (t) => {
  const directory = fixture(t);
  exportBundle(directory, literals.map((value) => value === environment.EXPO_PUBLIC_DABBOBA_API_URL ? 'https://api.dabboba.net' : value));
  assert.deepEqual(scanMobileProductionBundle(directory), []);
  const report = await verifyMobileArtifactConfig({ artifactPath: directory, environment });
  assert.equal(report.status, 'fail');
  assert.ok(report.bundles[0].errors.some((error) => error.code === 'COMPILED_VALUE_MISSING' && error.variable === 'EXPO_PUBLIC_DABBOBA_API_URL'));
  assert.ok(codes(report.bundles[0]).has('STALE_OR_ALTERNATIVE_API_LITERAL'));
});

test('required values in comments, maps or longer URL strings cannot conceal missing compiled values', async (t) => {
  const directory = fixture(t);
  const entry = exportBundle(directory, [environment.EXPO_PUBLIC_DABBOBA_API_URL + '-old']);
  writeFileSync(path.join(directory, entry), `/* ${source()} */\n${source([environment.EXPO_PUBLIC_DABBOBA_API_URL + '-old'])}`);
  writeFileSync(path.join(directory, entry + '.map'), source());
  const report = await verifyMobileArtifactConfig({ artifactPath: directory, environment });
  assert.equal(report.status, 'fail');
  assert.ok(report.bundles[0].comparisons.every((comparison) => comparison.exactLiteralPresent === false));
});

test('missing public auth key remains a failure even when API and policy URLs are present', () => {
  const { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _omitted, ...missingKeyEnvironment } = environment;
  assert.ok(codes(inspectMobileArtifactStrings(literals, missingKeyEnvironment)).has('EXPECTED_VARIABLE_MISSING'));
  const report = inspectMobileArtifactStrings(literals.filter((value) => value !== environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), environment);
  assert.ok(report.errors.some((error) => error.code === 'COMPILED_VALUE_MISSING' && error.variable === 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
  assert.equal(report.publicAuthKeyLiteralPresent, false);
  assert.ok(codes(report).has('PUBLIC_AUTH_KEY_LITERAL_MISSING'));
});

test('foreign Supabase, privileged key and concrete local customer API literals fail closed without echoing values', () => {
  const privateKey = 'sb_secret_must_not_appear_in_report';
  const result = inspectMobileArtifactStrings([...literals, 'https://yxkmvgfruphgghowzvmo.supabase.co', privateKey, 'http://192.168.1.5:8788/v1/orders'], environment);
  assert.deepEqual(codes(result), new Set(['FOREIGN_SUPABASE_PROJECT_LITERAL', 'PRIVILEGED_KEY_LITERAL', 'LOCAL_CUSTOMER_API_LITERAL']));
  assert.ok(!JSON.stringify(result).includes(privateKey));
  assert.deepEqual(inspectMobileArtifactStrings([...literals, 'sb_secret_', 'sb_publishable_', 'http://localhost:9999', 'localhost', 'https://rconfxsykttfvznakile.supabase.co/auth/v1'], environment).errors, []);
});

test('LIVE comparison also requires the exact PortOne public identifiers', () => {
  const liveEnvironment = { ...environment, EXPO_PUBLIC_COMMERCE_CAPABILITY: 'LIVE' };
  const missing = inspectMobileArtifactStrings([...literals, 'LIVE'], liveEnvironment);
  for (const variable of ['EXPO_PUBLIC_PORTONE_STORE_ID', 'EXPO_PUBLIC_PORTONE_CHANNEL_KEY']) assert.ok(missing.errors.some((error) => error.code === 'EXPECTED_VARIABLE_MISSING' && error.variable === variable));
});

test('expected declarations reject credentials in URLs, a foreign backend and a server-only key', () => {
  const invalid = inspectMobileArtifactStrings(literals, { ...environment,
    EXPO_PUBLIC_DABBOBA_API_URL: 'https://user:password@api.dabboba.net?token=value',
    EXPO_PUBLIC_SUPABASE_URL: 'https://yxkmvgfruphgghowzvmo.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_must_never_be_a_public_declaration',
  });
  for (const code of ['EXPECTED_URL_INVALID', 'EXPECTED_SUPABASE_PROJECT_MISMATCH', 'EXPECTED_PUBLIC_KEY_INVALID']) assert.ok(codes(invalid).has(code));
  assert.ok(!JSON.stringify(invalid).includes('password'));
});

test('extra undeclared bundles and malformed metadata cannot pass', async (t) => {
  const directory = fixture(t);
  exportBundle(directory);
  writeFileSync(path.join(directory, 'old.jsbundle'), source());
  await assert.rejects(verifyMobileArtifactConfig({ artifactPath: directory, environment }), /EXPORT_AMBIGUOUS_NATIVE_BUNDLES/);
  writeFileSync(path.join(directory, 'metadata.json'), '{}');
  await assert.rejects(verifyMobileArtifactConfig({ artifactPath: directory, environment }), /EXPORT_METADATA_UNSUPPORTED/);
});

test('two platforms cannot declare the same bundle and textual decoys cannot masquerade as Hermes', async (t) => {
  const directory = fixture(t);
  const entry = exportBundle(directory);
  writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { ios: { bundle: entry }, android: { bundle: entry } } }));
  await assert.rejects(verifyMobileArtifactConfig({ artifactPath: directory, environment }), /EXPORT_AMBIGUOUS_NATIVE_BUNDLES/);
  const decoy = path.join(directory, 'decoy.hbc');
  writeFileSync(decoy, source());
  await assert.rejects(verifyMobileArtifactConfig({ artifactPath: decoy, platform: 'ios', environment }), /HERMES_HEADER_INVALID/);
});

test('IPA, APK and AAB are inspected through their actual embedded bundle; missing or duplicate bundles fail', async (t) => {
  const directory = fixture(t);
  for (const [extension, entry, platform] of [
    ['ipa', 'Payload/DABBOBA.app/main.jsbundle', 'ios'],
    ['apk', 'assets/index.android.bundle', 'android'],
    ['aab', 'base/assets/index.android.bundle', 'android'],
  ]) {
    const root = path.join(directory, extension);
    mkdirSync(path.join(root, path.dirname(entry)), { recursive: true });
    writeFileSync(path.join(root, entry), source());
    const archive = path.join(directory, `release.${extension}`);
    assert.equal(spawnSync('zip', ['-qr', archive, '.'], { cwd: root }).status, 0);
    const report = await verifyMobileArtifactConfig({ artifactPath: archive, environment });
    assert.equal(report.status, 'pass');
    assert.equal(report.bundles[0].entry, entry);
    assert.equal(report.bundles[0].platform, platform);
    assert.equal(report.artifactSha256.length, 64);
    const duplicate = path.join(root, path.dirname(entry), 'stale.bundle');
    writeFileSync(duplicate, source());
    const ambiguous = path.join(directory, `ambiguous.${extension}`);
    assert.equal(spawnSync('zip', ['-qr', ambiguous, '.'], { cwd: root }).status, 0);
    await assert.rejects(verifyMobileArtifactConfig({ artifactPath: ambiguous, environment }), /ARTIFACT_NATIVE_BUNDLE_MISSING_OR_AMBIGUOUS/);
  }
});

test('real installed Hermes output uses exact string-table entries and detects stale API paths', async (t) => {
  const directory = fixture(t);
  const compiler = resolveArtifactHermesCompiler();
  const input = path.join(directory, 'input.js');
  const hbc = path.join(directory, 'output.hbc');
  writeFileSync(input, source());
  const compiled = spawnSync(compiler, ['-O', '-emit-binary', '-out', hbc, input], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.ok(readFileSync(hbc).subarray(0, 8).equals(Buffer.from('c61fbc03c103191f', 'hex')));
  const report = await verifyMobileArtifactConfig({ artifactPath: hbc, platform: 'ios', environment });
  assert.equal(report.status, 'pass');
  assert.equal(report.bundles[0].format, 'hermes-string-table');
  assert.ok(report.bundles[0].bytecodeVersion > 0);
  writeFileSync(input, source(literals.map((value) => value === environment.EXPO_PUBLIC_DABBOBA_API_URL ? value + '-stale' : value)));
  assert.equal(spawnSync(compiler, ['-O', '-emit-binary', '-out', hbc, input]).status, 0);
  const stale = await verifyMobileArtifactConfig({ artifactPath: hbc, platform: 'ios', environment });
  assert.equal(stale.status, 'fail');
  assert.ok(stale.bundles[0].errors.some((error) => error.code === 'COMPILED_VALUE_MISSING' && error.variable === 'EXPO_PUBLIC_DABBOBA_API_URL'));
});

test('CLI returns nonzero for absent declarations without emitting public keys', (t) => {
  const directory = fixture(t);
  exportBundle(directory);
  const result = spawnSync(process.execPath, ['scripts/verify-mobile-artifact-config.mjs', directory], { env: {}, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
  assert.ok(codes(report.bundles[0]).has('EXPECTED_VARIABLE_MISSING'));
  assert.ok(!result.stdout.includes(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
});
