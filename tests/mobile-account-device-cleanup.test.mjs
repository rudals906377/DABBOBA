import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import * as cleanup from '../apps/mobile/src/features/profile/account-device-cleanup.ts';

const requireFromMobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const ts = requireFromMobile('typescript');

test('logout clears account-local data before removing the login identity', async () => {
  assert.equal(typeof cleanup.clearAccountDeviceState, 'function');
  const order = [];
  await cleanup.clearAccountDeviceState({
    clearLocalData: async () => { order.push('local-data'); },
    clearBrokerSession: async () => { order.push('broker'); },
    clearAuthTokens: async () => { order.push('auth-tokens'); },
  });
  assert.deepEqual(order, ['local-data', 'broker', 'auth-tokens']);
});

test('failed local cleanup retains the login identity so a later account cannot inherit stale data', async () => {
  assert.equal(typeof cleanup.clearAccountDeviceState, 'function');
  const order = [];
  await assert.rejects(cleanup.clearAccountDeviceState({
    clearLocalData: async () => { order.push('local-data'); throw new Error('database unavailable'); },
    clearBrokerSession: async () => { order.push('broker'); },
    clearAuthTokens: async () => { order.push('auth-tokens'); },
  }), /database unavailable/);
  assert.deepEqual(order, ['local-data']);
});

test('a new customer token is not stored until the previous customer cache is cleared', async () => {
  assert.equal(typeof cleanup.commitAccountSessionAfterCleanup, 'function');
  const order = [];
  await cleanup.commitAccountSessionAfterCleanup({
    clearLocalData: async () => { order.push('local-data'); },
    writeAuthTokens: async () => { order.push('new-token'); },
  });
  assert.deepEqual(order, ['local-data', 'new-token']);

  order.length = 0;
  await assert.rejects(cleanup.commitAccountSessionAfterCleanup({
    clearLocalData: async () => { order.push('local-data'); throw new Error('database unavailable'); },
    writeAuthTokens: async () => { order.push('new-token'); },
  }), /database unavailable/);
  assert.deepEqual(order, ['local-data']);
});

test('native logout waits for device cleanup before navigating and reports uncertain server revocation', () => {
  const screen = readFileSync(new URL('../apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx', import.meta.url), 'utf8');
  const logout = screen.slice(screen.indexOf('  const logout = () => {'), screen.indexOf('  const requestDeletion = async () =>'));
  assert.match(logout, /await clearAccountDeviceState\(\{/);
  assert.ok(logout.indexOf('await clearAccountDeviceState') < logout.indexOf('router.replace("\/(tabs)\/profile")'));
  assert.match(logout, /기기 로그아웃을 완료하지 못했어요/);
  assert.match(logout, /서버 로그아웃 상태를 확인하지 못했어요/);
  assert.doesNotMatch(logout, /Promise\.all\(/);
});

test('phone and both social callback paths clear previous-customer data before storing new tokens', () => {
  const authApi = readFileSync(new URL('../apps/mobile/src/features/auth/auth-api.ts', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../apps/mobile/src/features/auth/LoginScreen.tsx', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../apps/mobile/app/auth/callback.tsx', import.meta.url), 'utf8');
  assert.match(authApi, /await commitAccountSessionAfterCleanup\(\{[\s\S]*?clearLocalData: clearPreviousCustomerData,[\s\S]*?writeAuthTokens: \(\) => writeAuthTokens\(/);
  assert.match(login, /exchangeBrokerSession\([^;]*"PHONE", \(\) => clearUserScopedLocalData\(db\)\)/);
  assert.match(login, /completeSocialCustomerLogin\([^;]*\(\) => clearUserScopedLocalData\(db\)\)/);
  assert.match(callback, /completeSocialCustomerLogin\([^;]*\(\) => clearUserScopedLocalData\(db\)\)/);
});

test('an accepted deletion never reports that the server request failed when local cleanup fails', () => {
  const screen = readFileSync(new URL('../apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx', import.meta.url), 'utf8');
  const start = screen.indexOf('  const finalizeAcceptedDeletion = async (result: AccountDeletionReceipt) =>');
  const deletion = screen.slice(start, screen.indexOf('  return (', start));
  assert.match(deletion, /탈퇴 요청은 서버에 접수됐어요/);
  assert.match(deletion, /await clearAccountDeviceState\(\{/);
  assert.doesNotMatch(deletion, /Promise\.all\(/);
});

test('internal customer session clears previous-customer data before storing a new identity', async () => {
  const source = readFileSync(new URL('../apps/mobile/src/features/demo/demo-api.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'demo-api.ts',
  }).outputText;
  const module = { exports: {} };
  const events = [];
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    __DEV__: true,
    AbortController,
    Date,
    URL,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (new URL(url).pathname === '/v1/demo/capabilities') return {
        status: 200,
        ok: true,
        json: async () => ({
          enabled: true,
          profile: 'supabase-demo',
          paymentProvider: 'TEST_PG',
          actions: ['approve', 'fail', 'cancel', 'refund'],
        }),
      };
      if (new URL(url).pathname === '/v1/demo/session') return {
        status: 201,
        ok: true,
        json: async () => ({
          token: 'new-token',
          expiresAt: '2026-10-24T00:00:00.000Z',
          actor: {
            userId: 'da000000-0000-4000-8000-00000000000a',
            email: 'member01@dabboba.local',
            nickname: '고객',
            role: 'USER',
            status: 'ACTIVE',
            sessionId: 'da000000-0000-4000-8000-00000000000c',
          },
        }),
      };
      throw new Error(`Unexpected path: ${new URL(url).pathname}`);
    },
    require(specifier) {
      if (specifier === '@/lib/session-store') return {
        readAuthTokens: async () => null,
        clearAuthTokens: async () => { events.push('clear-old-token'); },
        writeAuthTokens: async () => { events.push('write-new-token'); },
      };
      if (specifier === '@/features/profile/account-device-cleanup') return cleanup;
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });

  await module.exports.ensureInternalCustomerSession(
    'http://127.0.0.1:8788',
    async () => { events.push('clear-old-data'); },
  );
  assert.deepEqual(events, ['clear-old-data', 'write-new-token']);

  events.length = 0;
  await assert.rejects(
    module.exports.ensureInternalCustomerSession(
      'http://127.0.0.1:8788',
      async () => {
        events.push('clear-old-data');
        throw new Error('database unavailable');
      },
    ),
    /이전 계정의 기기 데이터를 정리하지 못했습니다/,
  );
  assert.deepEqual(events, ['clear-old-data']);
});

test('every automatic internal session entry has the local database available for cleanup', () => {
  const layout = readFileSync(new URL('../apps/mobile/app/_layout.tsx', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../apps/mobile/src/features/auth/LoginScreen.tsx', import.meta.url), 'utf8');
  const checkout = readFileSync(new URL('../apps/mobile/src/features/checkout/CheckoutScreen.tsx', import.meta.url), 'utf8');
  assert.ok(layout.indexOf('<SQLiteProvider') < layout.indexOf('<InternalCustomerSessionBootstrap'));
  assert.match(layout, /ensureInternalCustomerSession\(runtime\.apiBaseUrl, \(\) => clearUserScopedLocalData\(db\)/);
  assert.match(login, /ensureInternalCustomerSession\(runtime\.apiBaseUrl, \(\) => clearUserScopedLocalData\(db\)/);
  assert.match(checkout, /ensureInternalCustomerSession\(runtime\.apiBaseUrl, \(\) => clearUserScopedLocalData\(db\)/);
  assert.doesNotMatch(checkout, /ensureInternalCustomerSession\([^;]*\.catch\(\(\) => null\)/);
});
