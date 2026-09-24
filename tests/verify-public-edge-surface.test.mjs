import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyPublicEdgeSurface, waitForPublicEdgeSurface } from '../scripts/verify-public-edge-surface.mjs';
import * as publicApiSmoke from '../scripts/verify-public-edge-surface.mjs';

const responses = {
  '/v1/public/config': { commerceMode: 'PRELAUNCH', requiredPolicyVersions: { terms: '2026-09-24', privacy: '2026-09-24' } },
  '/v1/catalog/recent-draws': { serverNow: '2026-09-24T00:00:00.000Z', items: [] },
  '/v1/catalog/home-sections': { configured: false, items: [], bestProductId: null, evaluatedAt: '2026-09-24T00:00:00.000Z' },
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

test('public Edge smoke verifies the three mobile Home/config contracts with GET only', async () => {
  const { calls, fetchImpl } = fixtureFetch();
  const result = await verifyPublicEdgeSurface({ fetchImpl });
  assert.deepEqual(result, { commerceMode: 'PRELAUNCH', checkedRoutes: Object.keys(responses) });
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

test('mobile release smoke verifies the configured customer API, not only the Edge default URL', async () => {
  assert.equal(typeof publicApiSmoke.verifyMobilePublicApiSurface, 'function');
  const calls = [];
  const productPage = {
    items: [{ id: 'product-1', name: '가챠 상품', category: 'gacha', availableQuantity: 0, totalQuantity: null }],
    nextCursor: null,
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, signal: init.signal });
    const pathname = new URL(url).pathname;
    const body = pathname === '/v1/catalog/products' || pathname === '/v1/catalog/ips'
      ? productPage
      : responses[pathname];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await publicApiSmoke.verifyMobilePublicApiSurface({
    apiBaseUrl: 'https://api.dabboba.net',
    fetchImpl,
  });
  assert.equal(result.commerceMode, 'PRELAUNCH');
  assert.deepEqual(calls.map(({ url }) => new URL(url).hostname), Array(5).fill('api.dabboba.net'));
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/v1/public/config',
    '/v1/catalog/recent-draws',
    '/v1/catalog/home-sections',
    '/v1/catalog/products',
    '/v1/catalog/ips',
  ]);
  assert.equal(new URL(calls[3].url).search, '?category=gacha&limit=1');
  assert.equal(calls.every(({ method, signal }) => method === 'GET' && signal instanceof AbortSignal), true);
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
        ? { items: [{ id: 'product-1', availableQuantity: 100, totalQuantity: 100 }], nextCursor: null }
        : pathname === '/v1/catalog/ips'
          ? { items: [], nextCursor: null }
          : responses[pathname];
      return new Response(JSON.stringify(body), { status: 200 });
    },
  }), /Products expose inventory during PRELAUNCH/);
});

test('the release workflow checks the customer API after configuration and before bundling', () => {
  const workflow = readFileSync(new URL('../.github/workflows/mobile-release-readiness.yml', import.meta.url), 'utf8');
  const configuration = workflow.indexOf('run: pnpm run release:mobile:check');
  const publicApi = workflow.indexOf('run: pnpm run release:mobile:api:verify');
  const bundle = workflow.indexOf('run: pnpm run release:mobile:bundle:check');
  assert.ok(configuration >= 0 && publicApi > configuration && bundle > publicApi);
});
