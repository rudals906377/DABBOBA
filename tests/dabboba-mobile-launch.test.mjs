import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import {
  HOSTED_AUTH_API_URL, HOSTED_AUTH_PROFILE, HOSTED_AUTH_PROJECT_REF, MOBILE_ROOT, METRO_PORT, assertLaunchUrl,
  assertMetroProcessEnvironment, buildExpoCommand, buildMobileEnvironment,
  buildHostedAuthMobileEnvironment, ensureAndroidReverse, inspectMetro,
  launchMobile, parseLaunchOptions, readMetroProcessEnvironment, selectIosSimulator,
} from '../scripts/dabboba-mobile-launch.mjs';
import { LOCAL_BACKEND_ENVIRONMENT_TIER, LOCAL_BACKEND_PROFILE } from '../scripts/local-backend-profile.mjs';

const owner = [{ pid: 321, cwd: MOBILE_ROOT }];
const own = { state: 'ready', owners: owner };
const absent = { state: 'absent', owners: [] };
const expectedEnvironment = buildMobileEnvironment({});
const environmentLine = environment => `/installed/node /installed/expo start ${Object.entries(environment).map(([key, value]) => `${key}=${value}`).join(' ')}`;
const attestation = { expectedEnvironment, environment: async () => environmentLine(expectedEnvironment) };

test('arguments keep the DABBOBA port and Expo Go mode fixed', () => {
  assert.deepEqual(parseLaunchOptions([]), { platform: null, clear: false, device: null, hostedAuth: false, help: false });
  assert.equal(parseLaunchOptions(['--ios', '--port', '8084', '--go', '--localhost']).platform, 'ios');
  assert.equal(parseLaunchOptions(['--android']).platform, 'android');
  assert.equal(parseLaunchOptions(['--web', '--clear']).clear, true);
  assert.equal(parseLaunchOptions(['--ios', '--hosted-auth']).hostedAuth, true);
  assert.equal(parseLaunchOptions(['--ios', '--demo-commerce']).backendProfile, 'supabase-demo');
  assert.equal(parseLaunchOptions(['--android', '--demo-commerce']).backendProfile, 'supabase-demo');
  for (const args of [['--port', '8081'], ['--port', '0'], ['--lan'], ['--tunnel'], ['--dev-client'], ['--ios', '--android'], ['--device']]) {
    assert.throws(() => parseLaunchOptions(args));
  }
  for (const args of [['--demo-commerce'], ['--web', '--demo-commerce'], ['--ios', '--hosted-auth', '--demo-commerce']]) {
    assert.throws(() => parseLaunchOptions(args), /isolated local/);
  }
});

test('new command runs the installed CLI from exactly apps/mobile without automatic native host management', () => {
  const command = buildExpoCommand('/installed/expo/bin/cli', parseLaunchOptions(['--ios', '--clear']), {});
  assert.deepEqual(command.args, ['--dns-result-order=ipv4first', '/installed/expo/bin/cli', 'start', '--go', '--localhost', '--port', '8084', '--clear']);
  assert.equal(command.options.cwd, MOBILE_ROOT);
  assert.equal(command.options.env.CI, undefined);
  assert.equal(command.options.env.RCT_METRO_PORT, '8084');
  assert.equal(command.options.stdio[0], 'ignore');
  assert.equal(command.options.stdio[1], 'pipe');
  const redirected = buildExpoCommand('/cli', parseLaunchOptions([]), { EXPO_PACKAGER_PROXY_URL: 'http://localhost:8081', REACT_NATIVE_PACKAGER_HOSTNAME: 'wrong.test' });
  assert.equal(redirected.options.env.EXPO_PACKAGER_PROXY_URL, 'http://127.0.0.1:8084');
  assert.equal(redirected.options.env.REACT_NATIVE_PACKAGER_HOSTNAME, '127.0.0.1');
});

test('listener absence permits startup without requesting unrelated HTTP services', async () => {
  assert.deepEqual(await inspectMetro({ listeners: async () => [], status: () => assert.fail('HTTP queried without owner') }), absent);
});

test('healthy exact mobile cwd is reusable but parent and similarly named checkouts are foreign', async () => {
  assert.deepEqual(await inspectMetro({ ...attestation, listeners: async () => owner, status: async () => 'packager-status:running' }), own);
  for (const cwd of [MOBILE_ROOT + '-copy', MOBILE_ROOT + '/src', MOBILE_ROOT.replace('/apps/mobile', ''), '/Users/test/FINDE', null]) {
    const result = await inspectMetro({ listeners: async () => [{ pid: 222, cwd }], status: () => assert.fail('queried foreign process') });
    assert.equal(result.state, 'foreign');
  }
});

test('same app with wrong or unreachable status is not reused', async () => {
  for (const status of [async () => 'OK', async () => '<html>running</html>', async () => { throw new Error('timeout'); }]) {
    assert.equal((await inspectMetro({ ...attestation, listeners: async () => owner, status })).state, 'unhealthy');
  }
});

test('ownership is checked again after Metro health to detect replacement', async () => {
  let reads = 0;
  const result = await inspectMetro({ ...attestation, listeners: async () => ++reads === 1 ? owner : [{ pid: 777, cwd: '/foreign' }], status: async () => 'packager-status:running' });
  assert.equal(result.state, 'foreign');
});

test('URLs are restricted to the selected platform and fixed app port', () => {
  assert.equal(METRO_PORT, 8084);
  assertLaunchUrl('exp://127.0.0.1:8084', 'ios');
  assertLaunchUrl('exp://127.0.0.1:8084', 'android');
  assertLaunchUrl('http://127.0.0.1:8084', 'web');
  for (const url of ['exp://127.0.0.1:8081', 'exp://evil.test:8084', 'exp://user@127.0.0.1:8084', 'exp://127.0.0.1:8084/other', 'exp://127.0.0.1:8084?url=exp://localhost:8081']) {
    assert.throws(() => assertLaunchUrl(url, 'ios'));
  }
  assert.throws(() => assertLaunchUrl('exp://10.0.2.2:8084', 'android'));
});

test('Android reverse mapping touches only this emulator and 8084, and never replaces a foreign mapping', async () => {
  const target = { adb: '/sdk/adb', serial: 'emulator-5554' };
  for (const output of ['', 'host tcp:8081 tcp:8081\n', 'host tcp:8084 tcp:8084\n']) {
    const calls = [];
    await ensureAndroidReverse(target, async (command, args) => { calls.push([command, args]); return { stdout: output }; });
    assert.deepEqual(calls[0], ['/sdk/adb', ['-s', 'emulator-5554', 'reverse', '--list']]);
    if (output.includes('tcp:8084')) assert.equal(calls.length, 1);
    else assert.deepEqual(calls[1], ['/sdk/adb', ['-s', 'emulator-5554', 'reverse', '--no-rebind', 'tcp:8084', 'tcp:8084']]);
  }
  const calls = [];
  await assert.rejects(ensureAndroidReverse(target, async (_command, args) => { calls.push(args); return { stdout: 'host tcp:8084 tcp:8081\n' }; }), /another service/);
  assert.equal(calls.length, 1);
});

test('Simulator selection uses installed SDK evidence rather than a misleading SDK54 name', () => {
  const devices = [
    { udid: 'wrong', name: 'DABBOBA SDK54', sdkVersion: '57.0.0', state: 'Booted', isAvailable: true },
    { udid: 'compatible', name: 'iPhone', sdkVersion: '54.0.0', state: 'Booted', isAvailable: true },
    { udid: 'preferred', name: 'DABBOBA iPhone', sdkVersion: '54.0.0', state: 'Shutdown', isAvailable: true },
  ];
  assert.equal(selectIosSimulator(devices, null, '54.0.0').udid, 'preferred');
  assert.equal(selectIosSimulator(devices, 'compatible', '54.0.0').udid, 'compatible');
  assert.throws(() => selectIosSimulator(devices, 'wrong', '54.0.0'), /SDK 54/);
  assert.throws(() => selectIosSimulator(devices.slice(0, 1), null, '54.0.0'), /installed.*SDK 54/);
  assert.throws(() => selectIosSimulator([{ ...devices[1], sdkVersion: null }], null, '54.0.0'), /SDK 54/);
  assert.equal(selectIosSimulator(devices, null, '57.0.0').udid, 'wrong');
  assert.throws(() => selectIosSimulator(devices, 'preferred', '57.0.0'), /SDK 57/);
});

test('default SDK57 selection never borrows a compatible non-DABBOBA Simulator', () => {
  const other = { udid: 'other', name: 'FINDE iPhone', sdkVersion: '57.0.0', state: 'Booted', isAvailable: true };
  const ownDevice = { ...other, udid: 'ours', name: 'DABBOBA SDK57', state: 'Shutdown' };
  assert.throws(() => selectIosSimulator([other], null, '57.0.0'), /dedicated DABBOBA/);
  assert.equal(selectIosSimulator([other, ownDevice], null, '57.0.0').udid, 'ours');
});

function fakeLaunch(states, overrides = {}) {
  const actions = [];
  let index = 0;
  const child = new EventEmitter();
  child.pid = 9123;
  child.exitCode = null;
  child.signalCode = null;
  const deps = {
    inspect: async () => states[Math.min(index++, states.length - 1)],
    resolveCli: () => '/installed/expo/bin/cli',
    prepareTarget: async options => { actions.push('prepare'); return { platform: options.platform, udid: 'compatible' }; },
    spawn: () => { actions.push('spawn'); return child; },
    openTarget: async (_target, url) => actions.push(['open', url]),
    stopChild: async () => actions.push('stop'),
    waitForChild: async () => { actions.push('wait'); return 0; },
    sleep: async () => {},
    log: () => {},
    env: {},
    ...overrides,
  };
  return { deps, actions };
}

test('healthy server is reused and the correct URL reopened without spawning or stopping it', async () => {
  const f = fakeLaunch([own]);
  const result = await launchMobile(parseLaunchOptions(['--ios']), f.deps);
  assert.equal(result.reused, true);
  assert.deepEqual(f.actions, ['prepare', ['open', 'exp://127.0.0.1:8084']]);
});

test('absent Metro starts once, verifies readiness, opens target, and owns only its child lifecycle', async () => {
  const f = fakeLaunch([absent, absent, own]);
  const result = await launchMobile(parseLaunchOptions(['--android']), f.deps);
  assert.equal(result.reused, false);
  assert.deepEqual(f.actions, ['prepare', 'spawn', ['open', 'exp://127.0.0.1:8084'], 'wait', 'stop']);
});

test('foreign and unhealthy owners fail without spawning, opening, or killing any process', async () => {
  for (const state of ['foreign', 'unhealthy', 'incompatible']) {
    const f = fakeLaunch([{ state, owners: owner }]);
    await assert.rejects(launchMobile(parseLaunchOptions(['--ios']), f.deps), /8084/);
    assert.deepEqual(f.actions, []);
  }
});

test('mobile environment admits only safe shell values and fixed local public settings', () => {
  const environment = buildMobileEnvironment({
    PATH: '/fixture/bin', CI: '1', DATABASE_URL: 'private', DATABASE_MIGRATION_URL: 'private-admin',
    NODE_OPTIONS: '--require=foreign-loader', SESSION_TOKEN_PEPPER: 'private',
    EXPO_PUBLIC_SUPABASE_URL: 'https://foreign.supabase.co',
    EXPO_PUBLIC_DABBOBA_API_URL: 'http://127.0.0.1:8787', EXPO_PUBLIC_TEST_LOGIN: 'true',
  });
  assert.deepEqual(environment, { PATH: '/fixture/bin', ...expectedEnvironment });
  assert.equal(environment.DABBOBA_ENVIRONMENT_TIER, LOCAL_BACKEND_ENVIRONMENT_TIER);
  assert.equal(environment.DABBOBA_LOCAL_BACKEND_PROFILE, LOCAL_BACKEND_PROFILE);
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined);
  assert.equal(environment.EXPO_NO_DOTENV, '1');
  assert.equal(environment.EXPO_PUBLIC_COMMERCE_CAPABILITY, 'PRELAUNCH');
});

test('only an explicitly selected internal demo profile enables development commerce screens', () => {
  const demo = buildMobileEnvironment({ EXPO_PUBLIC_COMMERCE_CAPABILITY: 'LIVE' }, { backendProfile: 'supabase-demo' });
  assert.equal(demo.EXPO_PUBLIC_COMMERCE_CAPABILITY, 'LIVE');
  assert.equal(buildMobileEnvironment({ EXPO_PUBLIC_COMMERCE_CAPABILITY: 'LIVE' }).EXPO_PUBLIC_COMMERCE_CAPABILITY, 'PRELAUNCH');
  assert.equal(buildMobileEnvironment({}, { backendProfile: 'supabase-integration' }).EXPO_PUBLIC_COMMERCE_CAPABILITY, 'PRELAUNCH');
  assert.equal(buildExpoCommand('/cli', parseLaunchOptions(['--ios', '--demo-commerce']), {}).options.env.EXPO_PUBLIC_COMMERCE_CAPABILITY, 'LIVE');
  assert.throws(() => buildMobileEnvironment({}, { backendProfile: 'production' }));
  assert.doesNotThrow(() => assertMetroProcessEnvironment(environmentLine(demo), demo));
  assert.throws(() => assertMetroProcessEnvironment(environmentLine(expectedEnvironment), demo));
});

test('hosted auth environment uses only the approved project public values and deployed API', () => {
  const source = [
    `EXPO_PUBLIC_SUPABASE_URL=https://${HOSTED_AUTH_PROJECT_REF}.supabase.co`,
    `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_${'a'.repeat(40)}`,
    '',
  ].join('\n');
  const environment = buildHostedAuthMobileEnvironment({
    PATH: '/fixture/bin',
    DATABASE_URL: 'must-not-leak',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
    EXPO_PUBLIC_DABBOBA_API_URL: 'https://foreign.invalid',
  }, source);
  assert.equal(environment.PATH, '/fixture/bin');
  assert.equal(environment.DABBOBA_LOCAL_BACKEND_PROFILE, HOSTED_AUTH_PROFILE);
  assert.equal(environment.DABBOBA_ENVIRONMENT_TIER, 'PRODUCTION');
  assert.equal(environment.EXPO_PUBLIC_DABBOBA_API_URL, HOSTED_AUTH_API_URL);
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_URL, `https://${HOSTED_AUTH_PROJECT_REF}.supabase.co`);
  assert.match(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.doesNotThrow(() => assertMetroProcessEnvironment(environmentLine(environment), environment));

  for (const invalid of [
    source.replace(HOSTED_AUTH_PROJECT_REF, 'abcdefghijklmnopqrst'),
    source.replace('sb_publishable_', 'sb_secret_'),
    `${source}DATABASE_URL=private\n`,
  ]) {
    assert.throws(() => buildHostedAuthMobileEnvironment({}, invalid));
  }
});

test('process attestation checks exact complete fields and rejects unknown, duplicate and stale config', () => {
  const valid = environmentLine(expectedEnvironment);
  assert.doesNotThrow(() => assertMetroProcessEnvironment(valid, expectedEnvironment));
  for (const invalid of [
    valid.replace('EXPO_PUBLIC_DABBOBA_API_URL=', 'PREFIX_EXPO_PUBLIC_DABBOBA_API_URL='),
    valid.replace(':8788', ':8787'), valid.replace(':8788', ':8788/foreign'),
    valid.replace('EXPO_NO_DOTENV=1', ''), valid + ' EXPO_NO_DOTENV=1',
    valid + ' EXPO_PUBLIC_TEST_LOGIN=true', valid + ' CI=1', valid + ' DATABASE_URL=private-sentinel',
    valid + ' EXPO_PUBLIC_SUPABASE_URL=https://foreign.supabase.co',
    valid + ' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=foreign-fixture',
    valid.replace('DABBOBA_LOCAL_BACKEND_PROFILE=local-development', 'DABBOBA_LOCAL_BACKEND_PROFILE=release'),
    '',
  ]) {
    assert.throws(() => assertMetroProcessEnvironment(invalid, expectedEnvironment), error => {
      assert.doesNotMatch(error.message, /private-sentinel|foreign-fixture|sb_publishable_fixture/);
      return true;
    });
  }
});

test('healthy same-cwd Metro is not contacted or reused without matching process configuration', async () => {
  for (const environment of [async () => '', async () => environmentLine({ ...expectedEnvironment, EXPO_PUBLIC_DABBOBA_API_URL: 'http://127.0.0.1:8787' }), async () => { throw new Error('private-output'); }]) {
    const result = await inspectMetro({ expectedEnvironment, environment, listeners: async () => owner, status: () => assert.fail('unverified server contacted') });
    assert.equal(result.state, 'incompatible');
    assert.doesNotMatch(JSON.stringify(result), /private-output|8787/);
  }
});

test('macOS process reader verifies only a newly created fixture child without printing its environment', { skip: process.platform !== 'darwin' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: expectedEnvironment, stdio: 'ignore' });
  try {
    await once(child, 'spawn');
    assertMetroProcessEnvironment(await readMetroProcessEnvironment(child.pid), expectedEnvironment);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
});

test('a race for the port is rechecked before spawning', async () => {
  const f = fakeLaunch([absent, { state: 'foreign', owners: owner }]);
  await assert.rejects(launchMobile(parseLaunchOptions(['--ios']), f.deps), /8084/);
  assert.deepEqual(f.actions, ['prepare']);
});

test('incompatible host fails before a new server starts', async () => {
  const f = fakeLaunch([absent], { prepareTarget: async () => { throw new Error('No SDK 54 host'); } });
  await assert.rejects(launchMobile(parseLaunchOptions(['--ios']), f.deps), /SDK 54/);
  assert.deepEqual(f.actions, []);
});

test('launch failure cleans up only the server created by this invocation', async () => {
  const f = fakeLaunch([absent, absent, own], { openTarget: async () => { throw new Error('open failed'); } });
  await assert.rejects(launchMobile(parseLaunchOptions(['--ios']), f.deps), /open failed/);
  assert.deepEqual(f.actions, ['prepare', 'spawn', 'stop']);
});

test('clear cannot silently restart an existing server', async () => {
  const f = fakeLaunch([own]);
  await assert.rejects(launchMobile(parseLaunchOptions(['--clear']), f.deps), /clear/);
  assert.deepEqual(f.actions, []);
});
