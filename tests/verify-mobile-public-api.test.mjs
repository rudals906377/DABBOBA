import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyMobilePublicApiFromEnvironment } from '../scripts/verify-mobile-public-api.mjs';

const product = (category) => ({
  id: `${category}-1`, category, saleStatus: 'ON_SALE', purchasable: true,
  price: 5500, availableQuantity: 80, imageUrl: `https://cdn.dabboba.net/${category}.jpg`,
});

function fixtureFetch({ commerceMode, paymentProvider } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.hostname);
    const mode = commerceMode;
    const bodies = {
      '/v1/public/config': {
        commerceMode: mode,
        requiredPolicyVersions: { terms: '2026-09-24', privacy: '2026-09-24' },
        ...(paymentProvider === undefined ? {} : { paymentProvider }),
      },
      '/v1/catalog/recent-draws': { serverNow: '2026-09-24T00:00:00.000Z', items: [] },
      '/v1/catalog/home-sections': { configured: false, items: [] },
      '/v1/auth/providers': mode === 'LIVE'
        ? { methods: ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE'], brokerExchangeConfigured: true }
        : { methods: [], brokerExchangeConfigured: false },
      '/v1/catalog/ips': { items: [], nextCursor: null },
    };
    let body = bodies[parsed.pathname];
    if (parsed.pathname === '/v1/catalog/products') {
      body = mode === 'LIVE'
        ? { items: [product(parsed.searchParams.get('category'))], nextCursor: null }
        : { items: [{ id: 'p', category: 'gacha', availableQuantity: 0, totalQuantity: null }], nextCursor: null };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
}

const env = (overrides = {}) => ({
  EXPO_PUBLIC_DABBOBA_API_URL: 'https://api.dabboba.net',
  EXPO_PUBLIC_COMMERCE_CAPABILITY: 'LIVE',
  DABBOBA_COMMERCE_MODE: 'LIVE',
  PAYMENT_PROVIDER: 'PORTONE_V2_INICIS',
  ...overrides,
});

test('commerce mode is attested against the server; provider is reported as unattested when not exposed', async () => {
  const { fetchImpl, calls } = fixtureFetch({ commerceMode: 'LIVE' });
  const result = await verifyMobilePublicApiFromEnvironment({ environment: env(), fetchImpl });
  assert.equal(result.commerceModeAttested, true);
  assert.equal(result.paymentProviderAttested, false);
  assert.equal(calls.every((host) => host === 'api.dabboba.net'), true);

  const prelaunch = fixtureFetch({ commerceMode: 'PRELAUNCH' });
  const prelaunchResult = await verifyMobilePublicApiFromEnvironment({
    environment: env({
      EXPO_PUBLIC_COMMERCE_CAPABILITY: 'PRELAUNCH',
      DABBOBA_COMMERCE_MODE: 'PRELAUNCH',
      PAYMENT_PROVIDER: 'UNCONFIGURED',
    }),
    fetchImpl: prelaunch.fetchImpl,
  });
  assert.equal(prelaunchResult.observed.commerceMode, 'PRELAUNCH');
});

test('a server commerce mode that differs from the build declaration fails', async () => {
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env(),
    fetchImpl: fixtureFetch({ commerceMode: 'PRELAUNCH' }).fetchImpl,
  }), /commerceMode must be LIVE/);
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env({ DABBOBA_COMMERCE_MODE: 'PRELAUNCH' }),
    fetchImpl: fixtureFetch({ commerceMode: 'LIVE' }).fetchImpl,
  }), /DABBOBA_COMMERCE_MODE=PRELAUNCH does not match/);
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env({ DABBOBA_COMMERCE_MODE: '' }),
    fetchImpl: fixtureFetch({ commerceMode: 'LIVE' }).fetchImpl,
  }), /DABBOBA_COMMERCE_MODE must be declared/);
});

test('an exposed server payment provider must equal the build PAYMENT_PROVIDER', async () => {
  const matched = await verifyMobilePublicApiFromEnvironment({
    environment: env(),
    fetchImpl: fixtureFetch({ commerceMode: 'LIVE', paymentProvider: 'PORTONE_V2_INICIS' }).fetchImpl,
  });
  assert.equal(matched.paymentProviderAttested, true);
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env(),
    fetchImpl: fixtureFetch({ commerceMode: 'LIVE', paymentProvider: 'UNCONFIGURED' }).fetchImpl,
  }), /paymentProvider=UNCONFIGURED; build declares PAYMENT_PROVIDER=PORTONE_V2_INICIS/);
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env({ PAYMENT_PROVIDER: '' }),
    fetchImpl: fixtureFetch({ commerceMode: 'LIVE', paymentProvider: 'PORTONE_V2_INICIS' }).fetchImpl,
  }), /build declares no PAYMENT_PROVIDER/);
});

test('an unapproved API host is rejected before any request', async () => {
  const { fetchImpl, calls } = fixtureFetch({ commerceMode: 'LIVE' });
  await assert.rejects(verifyMobilePublicApiFromEnvironment({
    environment: env({ EXPO_PUBLIC_DABBOBA_API_URL: 'https://yxkmvgfruphgghowzvmo.supabase.co/functions/v1/dabboba-api' }),
    fetchImpl,
  }), /not an approved production API host/);
  assert.equal(calls.length, 0);
});
