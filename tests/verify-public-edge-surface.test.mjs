import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyPublicEdgeSurface, waitForPublicEdgeSurface } from '../scripts/verify-public-edge-surface.mjs';
import * as publicApiSmoke from '../scripts/verify-public-edge-surface.mjs';

const policyVersions = { terms: '2026-09-24', privacy: '2026-09-24' };
const responses = {
  '/v1/public/config': { commerceMode: 'PRELAUNCH', requiredPolicyVersions: policyVersions },
  '/v1/catalog/recent-draws': { serverNow: '2026-09-24T00:00:00.000Z', items: [] },
  '/v1/catalog/home-sections': { configured: false, items: [], bestProductId: null, evaluatedAt: '2026-09-24T00:00:00.000Z' },
  '/v1/auth/providers': { methods: [], brokerExchangeConfigured: false, requiredPolicyVersions: policyVersions },
};

function fixtureFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname.replace('/functions/v1/dabboba-api', '');
    calls.push({ path, method: init.method, signal: init.signal });
    const fixture = overrides[path] ?? responses[path];
    if (fixture instanceof Response) return fixture;
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('public Edge smoke verifies the four mobile Home/config/login contracts with GET only', async () => {
  const { calls, fetchImpl } = fixtureFetch();
  const result = await verifyPublicEdgeSurface({ fetchImpl });
  assert.deepEqual(result, {
    commerceMode: 'PRELAUNCH',
    checkedRoutes: Object.keys(responses),
    observed: { commerceMode: 'PRELAUNCH' },
  });
  assert.deepEqual(calls.map((call) => call.path), Object.keys(responses));
  assert.equal(calls.every((call) => call.method === 'GET' && call.signal instanceof AbortSignal), true);
});

test('the deployed old API cannot pass when public config or recent activity is missing', async () => {
  const { fetchImpl } = fixtureFetch({
    '/v1/public/config': new Response('{}', { status: 404 }),
  });
  await assert.rejects(verifyPublicEdgeSurface({ fetchImpl }), /Public config returned HTTP 404/);
  const { fetchImpl: missingRecent } = fixtureFetch({
    '/v1/catalog/recent-draws': new Response('{}', { status: 404 }),
  });
  await assert.rejects(verifyPublicEdgeSurface({ fetchImpl: missingRecent }), /Recent draws returned HTTP 404/);
});

test('a 200 response with stale shape or LIVE commerce fails the PRELAUNCH gate', async () => {
  await assert.rejects(verifyPublicEdgeSurface({
    fetchImpl: fixtureFetch({ '/v1/public/config': { commerceMode: 'LIVE', requiredPolicyVersions: responses['/v1/public/config'].requiredPolicyVersions } }).fetchImpl,
  }), /commerceMode must be PRELAUNCH/);
  await assert.rejects(verifyPublicEdgeSurface({
    fetchImpl: fixtureFetch({ '/v1/catalog/home-sections': { configured: true, items: [{}] } }).fetchImpl,
  }), /Home sections contract is incomplete/);
});

test('deployment retries a briefly unavailable Edge route without hiding a persistent failure', async () => {
  let attempts = 0;
  let pauses = 0;
  const result = await waitForPublicEdgeSurface({
    verify: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary 404');
      return { checkedRoutes: Object.keys(responses) };
    },
    pause: async () => { pauses += 1; },
  });
  assert.deepEqual(result.checkedRoutes, Object.keys(responses));
  assert.equal(attempts, 3);
  assert.equal(pauses, 2);
  await assert.rejects(waitForPublicEdgeSurface({
    verify: async () => { throw new Error('persistent 404'); },
    pause: async () => {},
  }), /persistent 404/);
});

const catalogImage = 'https://cdn.dabboba.net/catalog/gacha.png';
const imageResponse = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
  status: 200,
  headers: { 'content-type': 'image/png' },
});
const prelaunchProduct = (category) => ({
  id: `${category}-1`, name: `${category} 상품`, category, availableQuantity: 0, totalQuantity: null, imageUrl: catalogImage,
});

test('mobile release smoke verifies the configured customer API, not only the Edge default URL', async () => {
  assert.equal(typeof publicApiSmoke.verifyMobilePublicApiSurface, 'function');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, signal: init.signal, redirect: init.redirect });
    if (url === catalogImage) return imageResponse();
    const parsed = new URL(url);
    const body = parsed.pathname === '/v1/catalog/products'
      ? { items: parsed.searchParams.get('category') === 'gacha' ? [prelaunchProduct('gacha')] : [], nextCursor: null }
      : parsed.pathname === '/v1/catalog/ips'
        ? { items: [], nextCursor: null }
        : responses[parsed.pathname];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl,
  });
  assert.equal(result.commerceMode, 'PRELAUNCH');
  assert.equal(result.observed.catalogImageVerified, true);
  const apiCalls = calls.slice(0, -1);
  assert.deepEqual(apiCalls.map(({ url }) => new URL(url).hostname), Array(7).fill('api.dabboba.net'));
  assert.deepEqual(apiCalls.map(({ url }) => `${new URL(url).pathname}${new URL(url).search}`), [
    '/v1/public/config',
    '/v1/catalog/recent-draws',
    '/v1/catalog/home-sections',
    '/v1/auth/providers',
    '/v1/catalog/products?category=gacha&limit=1',
    '/v1/catalog/products?category=kuji&limit=1',
    '/v1/catalog/ips',
  ]);
  // The first catalog image is followed through the media redirect to real image bytes.
  assert.equal(calls.at(-1).url, catalogImage);
  assert.equal(calls.at(-1).redirect, 'follow');
  assert.equal(calls.every(({ method, signal }) => method === 'GET' && signal instanceof AbortSignal), true);
});

test('mobile release smoke rejects a broken catalog image, a mixed category or mismatched policy versions', async () => {
  const fetchWith = ({ image = imageResponse, kujiItems = [], providers = responses['/v1/auth/providers'] } = {}) => async (url) => {
    if (url === catalogImage) return image();
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/catalog/products') {
      const items = parsed.searchParams.get('category') === 'gacha' ? [prelaunchProduct('gacha')] : kujiItems;
      return new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 });
    }
    if (parsed.pathname === '/v1/catalog/ips') return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
    if (parsed.pathname === '/v1/auth/providers') return new Response(JSON.stringify(providers), { status: 200 });
    return new Response(JSON.stringify(responses[parsed.pathname]), { status: 200 });
  };
  const verify = (options) => publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl: fetchWith(options),
  });
  await verify();
  await assert.rejects(verify({ image: () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }) }), /Catalog image returned HTTP 503/);
  await assert.rejects(verify({ image: () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) }), /expected an image/);
  await assert.rejects(verify({ kujiItems: [prelaunchProduct('gacha')] }), /Kuji catalog returned a product outside the kuji category/);
  await assert.rejects(verify({ kujiItems: [{ ...prelaunchProduct('kuji'), availableQuantity: 5 }] }), /Kuji catalog exposes inventory during PRELAUNCH/);
  await assert.rejects(verify({
    providers: { ...responses['/v1/auth/providers'], requiredPolicyVersions: { terms: '2026-09-30', privacy: '2026-09-24' } },
  }), /different policy versions/);
  await assert.rejects(verify({
    providers: { ...responses['/v1/auth/providers'], deletionMethods: ['EMAIL', 'FAX'] },
  }), /Auth providers contract is incomplete/);
  await verify({ providers: { ...responses['/v1/auth/providers'], deletionMethods: ['EMAIL'] } });
});

test('mobile release smoke rejects unsafe origins and broken product catalog routes', async () => {
  assert.equal(typeof publicApiSmoke.verifyMobilePublicApiSurface, 'function');
  for (const apiBaseUrl of [
    'http://api.dabboba.net',
    'https://127.0.0.1:8788',
    'https://api.dabboba.net/?token=secret',
    'https://user:pass@api.dabboba.net',
  ]) {
    await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({ apiBaseUrl }), /HTTPS|public API|origin/i);
  }
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl: async (url) => new URL(url).pathname === '/v1/catalog/products'
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(responses[new URL(url).pathname]), { status: 200 }),
  }), /Products returned HTTP 404/);
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl: async (url) => new Response(JSON.stringify(
      new URL(url).pathname === '/v1/catalog/products'
        ? { items: [], nextCursor: null }
        : new URL(url).pathname === '/v1/catalog/ips'
          ? { items: [], nextCursor: null }
          : responses[new URL(url).pathname],
    ), { status: 200 }),
  }), /Products catalog.*empty/);
});

test('mobile release smoke rejects a prelaunch catalog that exposes invented stock', async () => {
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      const body = pathname === '/v1/catalog/products'
        ? { items: [{ id: 'product-1', category: new URL(url).searchParams.get('category'), availableQuantity: 100, totalQuantity: 100 }], nextCursor: null }
        : pathname === '/v1/catalog/ips'
          ? { items: [], nextCursor: null }
          : responses[pathname];
      return new Response(JSON.stringify(body), { status: 200 });
    },
  }), /Products exposes inventory during PRELAUNCH/);
});

test('LIVE mobile release requires configured login and purchasable gacha and kuji catalogs', async () => {
  const liveResponses = {
    ...responses,
    '/v1/public/config': { ...responses['/v1/public/config'], commerceMode: 'LIVE' },
    '/v1/auth/providers': {
      methods: ['KAKAO', 'NAVER', 'GOOGLE', 'APPLE'],
      brokerExchangeConfigured: true,
      requiredPolicyVersions: policyVersions,
    },
  };
  const product = (category) => ({
    id: `${category}-1`, category, saleStatus: 'ON_SALE', purchasable: true,
    price: 5500, availableQuantity: 80, imageUrl: `https://cdn.dabboba.net/${category}.jpg`,
  });
  const fetchLive = (overrides = {}) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const parsed = new URL(url);
      calls.push({ path: parsed.pathname, search: parsed.search, method: init.method, host: parsed.hostname });
      if (parsed.hostname === 'cdn.dabboba.net') return imageResponse();
      const body = overrides[`${parsed.pathname}${parsed.search}`]
        ?? overrides[parsed.pathname]
        ?? (parsed.pathname === '/v1/catalog/products'
          ? { items: [product(parsed.searchParams.get('category'))], nextCursor: null }
          : parsed.pathname === '/v1/catalog/ips'
            ? { items: [], nextCursor: null }
            : liveResponses[parsed.pathname]);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    return { calls, fetchImpl };
  };

  const valid = fetchLive();
  const result = await publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: valid.fetchImpl,
  });
  assert.equal(result.commerceMode, 'LIVE');
  const apiCalls = valid.calls.filter((call) => call.host === 'api.dabboba.net');
  assert.equal(apiCalls.length, 9);
  assert.deepEqual(valid.calls.filter((call) => call.host === 'cdn.dabboba.net').map((call) => call.path), ['/gacha.jpg']);
  assert.equal(valid.calls.every((call) => call.method === 'GET'), true);
  assert.equal(apiCalls[3].path, '/v1/auth/providers');
  assert.deepEqual(apiCalls.slice(-2).map(({ path, search }) => `${path}${search}`), [
    '/v1/catalog/products?category=gacha&saleStatus=ON_SALE&excludeSoldOut=true&limit=1',
    '/v1/catalog/products?category=kuji&saleStatus=ON_SALE&excludeSoldOut=true&limit=1',
  ]);

  const missingLogin = fetchLive({
    '/v1/auth/providers': { methods: [], brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions },
  });
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: missingLogin.fetchImpl,
  }), /LIVE customer login providers are incomplete/);

  const withPhone = fetchLive({
    '/v1/auth/providers': { methods: ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE'], brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions },
  });
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: withPhone.fetchImpl,
  }), /PHONE without DABBOBA_PHONE_LOGIN_READY=true/);
  await publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: withPhone.fetchImpl,
    requirePhoneLogin: true,
  });
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: valid.fetchImpl,
    requirePhoneLogin: true,
  }), /LIVE customer login providers are incomplete/);

  const unsellableGacha = fetchLive({
    '/v1/catalog/products?category=gacha&saleStatus=ON_SALE&excludeSoldOut=true&limit=1': {
      items: [{ ...product('gacha'), price: null, purchasable: false }], nextCursor: null,
    },
  });
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: unsellableGacha.fetchImpl,
  }), /LIVE gacha catalog has no purchasable product/);

  const missingKuji = fetchLive({
    '/v1/catalog/products?category=kuji&saleStatus=ON_SALE&excludeSoldOut=true&limit=1': { items: [], nextCursor: null },
  });
  await assert.rejects(publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net', expectedCommerceMode: 'LIVE', fetchImpl: missingKuji.fetchImpl,
  }), /LIVE kuji catalog has no purchasable product/);
});

test('every profile rejects a third-party login listed without Sign in with Apple', async () => {
  for (const methods of [['KAKAO'], ['PHONE', 'NAVER'], ['GOOGLE'], ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE']]) {
    const { fetchImpl } = fixtureFetch({ '/v1/auth/providers': { methods, brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions } });
    await assert.rejects(
      verifyPublicEdgeSurface({ fetchImpl }),
      /third-party login without Sign in with Apple/,
      `PRELAUNCH edge must reject ${methods.join(',')}`,
    );
    await assert.rejects(
      verifyPublicEdgeSurface({
        fetchImpl: fixtureFetch({
          '/v1/public/config': { ...responses['/v1/public/config'], commerceMode: 'LIVE' },
          '/v1/auth/providers': { methods, brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions },
        }).fetchImpl,
        expectedCommerceMode: 'LIVE',
      }),
      /third-party login without Sign in with Apple/,
      `LIVE edge must reject ${methods.join(',')}`,
    );
  }
  for (const methods of [[], ['PHONE'], ['PHONE', 'KAKAO', 'APPLE'], ['APPLE']]) {
    const { fetchImpl } = fixtureFetch({ '/v1/auth/providers': { methods, brokerExchangeConfigured: methods.length > 0, requiredPolicyVersions: policyVersions } });
    await verifyPublicEdgeSurface({ fetchImpl });
  }
  await assert.rejects(
    verifyPublicEdgeSurface({ fetchImpl: fixtureFetch({ '/v1/auth/providers': { brokerExchangeConfigured: false } }).fetchImpl }),
    /Auth providers contract is incomplete/,
  );
});

test('the release workflow checks the customer API after configuration and before bundling', () => {
  const workflow = readFileSync(new URL('../.github/workflows/mobile-release-readiness.yml', import.meta.url), 'utf8');
  const configuration = workflow.indexOf('run: pnpm run release:mobile:check');
  const publicApi = workflow.indexOf('run: pnpm run release:mobile:api:verify');
  const worker = workflow.indexOf('run: pnpm run release:edge:worker:verify');
  const bundle = workflow.indexOf('run: pnpm run release:mobile:bundle:check');
  assert.ok(configuration >= 0 && publicApi > configuration && worker > publicApi && bundle > worker);
});
