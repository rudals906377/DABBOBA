#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';

const BASE_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`;
const ROUTES = Object.freeze([
  ['/v1/public/config', 'Public config'],
  ['/v1/catalog/recent-draws', 'Recent draws'],
  ['/v1/catalog/home-sections', 'Home sections'],
]);
const MOBILE_CATALOG_ROUTES = Object.freeze([
  ['/v1/catalog/products?category=gacha&limit=1', 'Products'],
  ['/v1/catalog/ips', 'IPs'],
]);
const LIVE_MOBILE_ROUTES = Object.freeze([
  ['/v1/auth/providers', 'Auth providers'],
  ['/v1/catalog/products?category=gacha&saleStatus=ON_SALE&excludeSoldOut=true&limit=1', 'Gacha products'],
  ['/v1/catalog/products?category=kuji&saleStatus=ON_SALE&excludeSoldOut=true&limit=1', 'Kuji products'],
]);
const REQUIRED_LIVE_LOGIN_METHODS = Object.freeze(['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE']);
const POLICY_VERSION = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_LAYOUTS = new Set(['gacha', 'kuji']);
const SECTION_SOURCES = new Set(['MANUAL', 'IP', 'NEW', 'POPULAR']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exposesPrelaunchInventory(product) {
  return !isRecord(product)
    || product.availableQuantity !== 0
    || product.totalQuantity !== null
    || (Array.isArray(product.remainingKujiTiers) && product.remainingKujiTiers.length > 0);
}

function assertBody(route, body, expectedCommerceMode) {
  if (!isRecord(body)) throw new Error(`${route} contract is incomplete.`);
  if (route === 'Public config') {
    if (body.commerceMode !== expectedCommerceMode) {
      throw new Error(`Public config commerceMode must be ${expectedCommerceMode}.`);
    }
    if (!isRecord(body.requiredPolicyVersions)
      || !POLICY_VERSION.test(body.requiredPolicyVersions.terms)
      || !POLICY_VERSION.test(body.requiredPolicyVersions.privacy)) {
      throw new Error('Public config policy version contract is incomplete.');
    }
  } else if (route === 'Recent draws') {
    if (typeof body.serverNow !== 'string' || !Number.isFinite(Date.parse(body.serverNow))
      || !Array.isArray(body.items) || body.items.length > 2) {
      throw new Error('Recent draws contract is incomplete.');
    }
  } else if (route === 'Home sections') {
    if (typeof body.configured !== 'boolean' || !Array.isArray(body.items)
      || body.items.some((item) => !isRecord(item)
        || !SECTION_LAYOUTS.has(item.layoutKind)
        || !SECTION_SOURCES.has(item.sourceKind)
        || !Array.isArray(item.products))) {
      throw new Error('Home sections contract is incomplete.');
    }
    if (expectedCommerceMode === 'PRELAUNCH'
      && body.items.some((item) => item.products.some(exposesPrelaunchInventory))) {
      throw new Error('Home sections expose inventory during PRELAUNCH.');
    }
  } else if (route === 'Products' || route === 'IPs') {
    if (!Array.isArray(body.items)
      || !(body.nextCursor === null || typeof body.nextCursor === 'string')) {
      throw new Error(`${route} catalog contract is incomplete.`);
    }
    if (route === 'Products' && body.items.length === 0) {
      throw new Error('Products catalog is empty; a catalog-only mobile release needs a public gacha product.');
    }
    if (route === 'Products' && expectedCommerceMode === 'PRELAUNCH'
      && body.items.some(exposesPrelaunchInventory)) {
      throw new Error('Products expose inventory during PRELAUNCH.');
    }
  } else if (route === 'Gacha products' || route === 'Kuji products') {
    const category = route === 'Gacha products' ? 'gacha' : 'kuji';
    if (!Array.isArray(body.items)
      || !(body.nextCursor === null || typeof body.nextCursor === 'string')
      || !body.items.some((product) => isLiveProduct(product, category))) {
      throw new Error(`LIVE ${category} catalog has no purchasable product.`);
    }
  } else if (route === 'Auth providers') {
    if (!Array.isArray(body.methods) || body.brokerExchangeConfigured !== true
      || REQUIRED_LIVE_LOGIN_METHODS.some((method) => !body.methods.includes(method))) {
      throw new Error('LIVE customer login providers are incomplete.');
    }
  }
}

function isLiveProduct(product, category) {
  return isRecord(product)
    && product.category === category
    && product.saleStatus === 'ON_SALE'
    && product.purchasable === true
    && Number.isSafeInteger(product.price)
    && product.price > 0
    && Number.isSafeInteger(product.availableQuantity)
    && product.availableQuantity > 0
    && typeof (product.storefrontImageUrl || product.imageUrl) === 'string'
    && Boolean((product.storefrontImageUrl || product.imageUrl).trim());
}

function assertMobileApiBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Mobile public API requires a valid HTTPS URL.'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !hostname || url.username || url.password
    || url.search || url.hash || /%2f|%5c/i.test(value)
    || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/.test(hostname)
    || hostname.endsWith('.local') || hostname.endsWith('.test')) {
    throw new Error('Mobile public API requires a credential-free public HTTPS URL.');
  }
  return url.toString().replace(/\/+$/, '');
}

async function verifyRoutes(baseUrl, routes, fetchImpl, expectedCommerceMode) {
  if (!['PRELAUNCH', 'LIVE'].includes(expectedCommerceMode)) {
    throw new Error('Expected commerce mode is invalid.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  for (const [path, label] of routes) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error(`${label} could not reach the configured public API.`);
    }
    if (response.status !== 200) throw new Error(`${label} returned HTTP ${response.status}; expected 200.`);
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`${label} did not return JSON.`); }
    assertBody(label, body, expectedCommerceMode);
  }
  return { commerceMode: expectedCommerceMode, checkedRoutes: routes.map(([path]) => path) };
}

export async function verifyPublicEdgeSurface({
  fetchImpl = globalThis.fetch,
  expectedCommerceMode = 'PRELAUNCH',
} = {}) {
  return verifyRoutes(BASE_URL, ROUTES, fetchImpl, expectedCommerceMode);
}

export async function verifyMobilePublicApiSurface({
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  expectedCommerceMode = 'PRELAUNCH',
} = {}) {
  const baseUrl = assertMobileApiBaseUrl(apiBaseUrl);
  const routes = expectedCommerceMode === 'LIVE'
    ? [...ROUTES, ...MOBILE_CATALOG_ROUTES, ...LIVE_MOBILE_ROUTES]
    : [...ROUTES, ...MOBILE_CATALOG_ROUTES];
  return verifyRoutes(baseUrl, routes, fetchImpl, expectedCommerceMode);
}

export async function waitForPublicEdgeSurface({
  verify = verifyPublicEdgeSurface,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new Error('Public Edge smoke attempt limit is invalid.');
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await verify(); }
    catch (error) { lastError = error; }
    if (attempt < attempts) await pause(2_000);
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicEdgeSurface().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`DABBOBA public Edge verification failed: ${error instanceof Error ? error.message : 'unknown response'}\n`);
    process.exitCode = 1;
  });
}
