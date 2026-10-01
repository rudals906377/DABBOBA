#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
// The signed app accepts a Home response only through this validator, so the
// release smoke reuses it instead of keeping a weaker copy of the contract.
import { isCurrentHomeSectionList } from '../apps/mobile/src/features/home/home-catalog-contract.ts';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';

const BASE_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`;
const ROUTES = Object.freeze([
  ['/v1/public/config', 'Public config'],
  ['/v1/catalog/recent-draws', 'Recent draws'],
  ['/v1/catalog/home-sections', 'Home sections'],
  ['/v1/auth/providers', 'Auth providers'],
]);
const MOBILE_CATALOG_ROUTES = Object.freeze([
  ['/v1/catalog/products?category=gacha&limit=1', 'Products'],
  ['/v1/catalog/products?category=kuji&limit=1', 'Kuji catalog'],
  ['/v1/catalog/ips', 'IPs'],
]);
const DELETION_METHODS = new Set(['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE', 'EMAIL']);
const LIVE_MOBILE_ROUTES = Object.freeze([
  ['/v1/catalog/products?category=gacha&saleStatus=ON_SALE&excludeSoldOut=true&limit=1', 'Gacha products'],
]);
// PHONE (SMS OTP) is required in LIVE only when the build attests verified SMS
// delivery with DABBOBA_PHONE_LOGIN_READY=true; otherwise it must stay off.
const REQUIRED_LIVE_LOGIN_METHODS = Object.freeze(['KAKAO', 'NAVER', 'GOOGLE', 'APPLE']);
// App Store Review Guideline 4.8: offering a third-party social login requires
// Sign in with Apple as an equivalent option, in every commerce mode.
const THIRD_PARTY_LOGIN_METHODS = Object.freeze(['KAKAO', 'NAVER', 'GOOGLE']);
const POLICY_VERSION = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exposesPrelaunchInventory(product) {
  return !isRecord(product)
    || product.availableQuantity !== 0
    || product.totalQuantity !== null
    || (Array.isArray(product.remainingKujiTiers) && product.remainingKujiTiers.length > 0);
}

function assertBody(route, body, expectedCommerceMode, { requirePhoneLogin = false } = {}) {
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
    if (!isCurrentHomeSectionList(body)) {
      throw new Error('Home sections contract is incomplete.');
    }
    if (expectedCommerceMode === 'PRELAUNCH'
      && body.items.some((item) => item.products.some(exposesPrelaunchInventory))) {
      throw new Error('Home sections expose inventory during PRELAUNCH.');
    }
  } else if (route === 'Products' || route === 'Kuji catalog' || route === 'IPs') {
    if (!Array.isArray(body.items)
      || !(body.nextCursor === null || typeof body.nextCursor === 'string')) {
      throw new Error(`${route} catalog contract is incomplete.`);
    }
    if (route === 'Products' && body.items.length === 0) {
      throw new Error('Products catalog is empty; a catalog-only mobile release needs a public gacha product.');
    }
    // Each shop is filtered by category on the server; a wrong item would render in the wrong shop.
    const category = route === 'Products' ? 'gacha' : route === 'Kuji catalog' ? 'kuji' : null;
    if (category && body.items.some((product) => !isRecord(product) || product.category !== category)) {
      throw new Error(`${route} returned a product outside the ${category} category.`);
    }
    // First launch sells gacha only. Keep the Kuji shop contract checked, but
    // never require or accept a premature sellable Kuji to satisfy release.
    if (route === 'Kuji catalog' && expectedCommerceMode === 'LIVE'
      && body.items.some((product) => product.purchasable === true || product.saleStatus === 'ON_SALE')) {
      throw new Error('Kuji is deferred; its catalog must not expose an on-sale or purchasable product.');
    }
    if (category && expectedCommerceMode === 'PRELAUNCH'
      && body.items.some(exposesPrelaunchInventory)) {
      throw new Error(`${route} exposes inventory during PRELAUNCH.`);
    }
  } else if (route === 'Gacha products' || route === 'Kuji products') {
    const category = route === 'Gacha products' ? 'gacha' : 'kuji';
    if (!Array.isArray(body.items)
      || !(body.nextCursor === null || typeof body.nextCursor === 'string')
      || !body.items.some((product) => isLiveProduct(product, category))) {
      throw new Error(`LIVE ${category} catalog has no purchasable product.`);
    }
  } else if (route === 'Auth providers') {
    if (!Array.isArray(body.methods) || typeof body.brokerExchangeConfigured !== 'boolean'
      || !isRecord(body.requiredPolicyVersions)
      || !POLICY_VERSION.test(body.requiredPolicyVersions.terms)
      || !POLICY_VERSION.test(body.requiredPolicyVersions.privacy)
      || (body.deletionMethods !== undefined && (!Array.isArray(body.deletionMethods)
        || body.deletionMethods.some((method) => !DELETION_METHODS.has(method))))) {
      throw new Error('Auth providers contract is incomplete.');
    }
    if (THIRD_PARTY_LOGIN_METHODS.some((method) => body.methods.includes(method))
      && !body.methods.includes('APPLE')) {
      throw new Error('Auth providers list a third-party login without Sign in with Apple.');
    }
    const requiredLiveMethods = requirePhoneLogin
      ? ['PHONE', ...REQUIRED_LIVE_LOGIN_METHODS]
      : REQUIRED_LIVE_LOGIN_METHODS;
    if (expectedCommerceMode === 'LIVE' && (body.brokerExchangeConfigured !== true
      || requiredLiveMethods.some((method) => !body.methods.includes(method)))) {
      throw new Error('LIVE customer login providers are incomplete.');
    }
    if (expectedCommerceMode === 'LIVE' && !requirePhoneLogin && body.methods.includes('PHONE')) {
      throw new Error('LIVE customer login lists PHONE without DABBOBA_PHONE_LOGIN_READY=true.');
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

async function verifyRoutes(baseUrl, routes, fetchImpl, expectedCommerceMode, options = {}) {
  if (!['PRELAUNCH', 'LIVE'].includes(expectedCommerceMode)) {
    throw new Error('Expected commerce mode is invalid.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  const observed = {};
  const policyVersions = {};
  let catalogImageUrl = null;
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
    assertBody(label, body, expectedCommerceMode, options);
    if (label === 'Public config' || label === 'Auth providers') {
      policyVersions[label] = body.requiredPolicyVersions;
    }
    if (label === 'Products' && !catalogImageUrl) {
      catalogImageUrl = body.items
        .map((product) => (product.storefrontImageUrl || product.imageUrl || '').trim())
        .find(Boolean) ?? null;
    }
    if (label === 'Public config') {
      observed.commerceMode = body.commerceMode;
      // The public config currently exposes no payment provider. Record one
      // only when a future server contract adds it as a non-empty string.
      if (typeof body.paymentProvider === 'string' && body.paymentProvider.trim()) {
        observed.paymentProvider = body.paymentProvider.trim();
      }
    }
  }
  const configVersions = policyVersions['Public config'];
  const providerVersions = policyVersions['Auth providers'];
  if (configVersions && providerVersions && (configVersions.terms !== providerVersions.terms
    || configVersions.privacy !== providerVersions.privacy)) {
    throw new Error('Auth providers and public config require different policy versions.');
  }
  if (options.verifyCatalogImage) {
    if (!catalogImageUrl) throw new Error('Products catalog has no image to verify.');
    await verifyCatalogImage(catalogImageUrl, fetchImpl);
    observed.catalogImageVerified = true;
  }
  return {
    commerceMode: expectedCommerceMode,
    checkedRoutes: routes.map(([path]) => path),
    observed,
  };
}

// A product record can be served while its media route is broken (for example a
// missing delivery base or object). Follow one catalog image to its bytes.
async function verifyCatalogImage(imageUrl, fetchImpl) {
  let url;
  try { url = new URL(imageUrl); }
  catch { throw new Error('Catalog image URL is invalid.'); }
  if (url.protocol !== 'https:') throw new Error('Catalog image URL must use HTTPS.');
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('Catalog image could not be fetched.');
  }
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (response.status < 200 || response.status >= 300 || !/^image\//i.test(contentType)) {
    throw new Error(`Catalog image returned HTTP ${response.status} (${contentType || 'no content type'}); expected an image.`);
  }
  await response.body?.cancel?.().catch?.(() => undefined);
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
  requirePhoneLogin = false,
} = {}) {
  const baseUrl = assertMobileApiBaseUrl(apiBaseUrl);
  const routes = expectedCommerceMode === 'LIVE'
    ? [...ROUTES, ...MOBILE_CATALOG_ROUTES, ...LIVE_MOBILE_ROUTES]
    : [...ROUTES, ...MOBILE_CATALOG_ROUTES];
  return verifyRoutes(baseUrl, routes, fetchImpl, expectedCommerceMode, {
    requirePhoneLogin,
    verifyCatalogImage: true,
  });
}

export async function waitForPublicEdgeSurface({
  verify = verifyPublicEdgeSurface,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
  expectedCommerceMode = 'PRELAUNCH',
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new Error('Public Edge smoke attempt limit is invalid.');
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await verify({ expectedCommerceMode }); }
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
